// Reads the regression set's inputs from Git (plan §3): the base's approved set and roles from the
// remote-tracking ref (never the local base branch, which may be stale), the branch's own declared set
// from the working tree, and the QA transitions the branch added since its merge-base with that ref.
//
// Case records are JSON files under `.test-lab/cases/<track>/<id>.json` in phase 0; the Markdown corpus
// with front matter (§3 "The local corpus") is phase 1 and will feed the same records.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { approvalProblem } from './cases.ts';
import { git } from './git.ts';
import type { CaseRecord, Profile } from './model.ts';
import type { ApprovedSet, Transition } from './regression.ts';

const PROFILE = '.test-lab/profile.json';
const TRANSITIONS = '.test-lab/transitions';

async function show(repo: string, ref: string, path: string): Promise<string | null> {
  const r = await git(repo, ['show', `${ref}:${path}`], { allowFail: true });
  return r.ok ? r.stdout : null;
}

/** The approved set a profile and its case files define. A listed case that isn't approved is a problem, not a member. */
export function approvedSetOf(profile: Profile, cases: Map<string, CaseRecord>): { set: ApprovedSet; problems: string[] } {
  const set: ApprovedSet = new Map();
  const problems: string[] = [];
  for (const id of profile.regression) {
    const record = cases.get(id);
    if (record === undefined) {
      problems.push(`regression case ${id} has no case file`);
      continue;
    }
    if (record.track !== 'regression') problems.push(`case ${id} is in the regression set but its track is ${record.track}`);
    const why = approvalProblem(record, profile.roles);
    if (why !== null || record.approval === null) problems.push(`regression case ${id} is not approved as it stands: ${why ?? 'unapproved'}`);
    else set.set(id, record.approval.hash);
  }
  return { set, problems };
}

export type BaseState = { ref: string; commit: string | null; fetchedAt: Date | null; profile: Profile | null; cases: Map<string, CaseRecord> };
export async function readBaseRef(repo: string, remote: string, branch: string): Promise<Pick<BaseState,'ref'|'commit'|'fetchedAt'>> {
  const ref=`refs/remotes/${remote}/${branch}`;
  const head=await git(repo,['rev-parse','--verify','--quiet',`${ref}^{commit}`],{allowFail:true});
  const commit=head.ok?head.stdout.trim():null;
  return {ref,commit,fetchedAt:commit===null?null:await fetchedAt(repo,ref,branch)};
}

/** The base as the remote-tracking ref has it, with when that ref was last updated by a fetch. */
export type GitDecoders = { profile: (value: unknown) => Profile; case: (value: unknown) => CaseRecord; transition: (value: unknown) => Transition };
export async function readBase(repo: string, remote: string, branch: string, decoders?: GitDecoders): Promise<BaseState> {
  const ref = `refs/remotes/${remote}/${branch}`;
  const head = await git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true });
  const commit = head.ok ? head.stdout.trim() : null;
  const cases = new Map<string, CaseRecord>();
  if (commit === null) return { ref, commit, fetchedAt: null, profile: null, cases };
  const text = await show(repo, commit, PROFILE);
  const profile = text === null ? null : decoders === undefined ? (JSON.parse(text) as Profile) : decoders.profile(JSON.parse(text) as unknown);
  for (const id of profile?.regression ?? []) {
    const body = await show(repo, commit, `.test-lab/cases/regression/${id}.json`);
    if (body !== null) cases.set(id, decoders === undefined ? JSON.parse(body) as CaseRecord : decoders.case(JSON.parse(body) as unknown));
  }
  return { ref, commit, fetchedAt: await fetchedAt(repo, ref, branch), profile, cases };
}

/**
 * When the base was last fetched: the newer of the ref's newest reflog entry (a fetch that moved it) and
 * FETCH_HEAD's modification time when FETCH_HEAD names that branch (a fetch that found nothing new).
 */
async function fetchedAt(repo: string, ref: string, branch: string): Promise<Date | null> {
  const times: number[] = [];
  const log = await git(repo, ['reflog', 'show', '--date=iso-strict', '--format=%gd', '-n', '1', ref], { allowFail: true });
  const m = /\{(.+)\}/.exec(log.stdout.trim());
  if (log.ok && m !== null && Number.isFinite(Date.parse(m[1] as string))) times.push(Date.parse(m[1] as string));
  const fetchHead = resolve(repo, (await git(repo, ['rev-parse', '--git-path', 'FETCH_HEAD'])).stdout.trim());
  if (existsSync(fetchHead) && readFileSync(fetchHead, 'utf8').includes(`branch '${branch}' of `)) times.push(statSync(fetchHead).mtime.getTime());
  return times.length === 0 ? null : new Date(Math.max(...times));
}

/** The QA transitions the branch added since its merge-base with the base ref, in the order they were made. */
export async function branchTransitions(repo: string, baseRef: string, decoders?: GitDecoders): Promise<{ transitions: Transition[]; problems: string[] }> {
  const problems: string[] = [];
  const mb = await git(repo, ['merge-base', 'HEAD', baseRef], { allowFail: true });
  if (!mb.ok) return { transitions: [], problems: [`no merge-base between HEAD and ${baseRef}`] };
  const added = await git(repo, ['diff', '--name-only', '--no-renames', '--diff-filter=AMD', mb.stdout.trim(), '--', TRANSITIONS]);
  const transitions: Transition[] = [];
  const untracked = await git(repo, ['ls-files', '--others', '--exclude-standard', '--', TRANSITIONS]);
  for (const path of [...new Set([...added.stdout.split('\n'), ...untracked.stdout.split('\n')])].filter((p) => p.endsWith('.json'))) {
    const file = join(repo, path);
    if (!existsSync(file)) {
      problems.push(`${path} was removed on this branch: transitions are append-only`);
      continue;
    }
    const base = await show(repo, mb.stdout.trim(), path);
    if (base !== null && base !== readFileSync(file, 'utf8')) problems.push(`${path} was edited on this branch: transitions are append-only`);
    if (base !== null) continue;
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    transitions.push(decoders === undefined ? parsed as Transition : decoders.transition(parsed));
  }
  transitions.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return { transitions, problems };
}

/** Original signed bases, read as immutable commits in the current upstream history. */
export async function readTransitionBases(repo: string, baseRef: string, transitions: Transition[], decoders?: GitDecoders): Promise<{ historicalBases: Map<string, ApprovedSet>; problems: string[] }> {
  const historicalBases = new Map<string, ApprovedSet>();
  const problems: string[] = [];
  for (const ref of new Set(transitions.map((t) => t.baseCommit))) {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(ref)) { problems.push(`original base commit ${ref} is not an immutable commit ID`); continue; }
    const commit = await git(repo, ['rev-parse', '--verify', `${ref}^{commit}`], {allowFail:true});
    const ancestor = commit.ok ? await git(repo, ['merge-base', '--is-ancestor', commit.stdout.trim(), baseRef], {allowFail:true}) : null;
    if (!commit.ok || !ancestor?.ok) { problems.push(`original base commit ${ref} is not in the trusted upstream history`); continue; }
    const body = await show(repo, commit.stdout.trim(), PROFILE);
    if (body === null) { problems.push(`original base commit ${ref} has no profile`); continue; }
    try {
      const profile = decoders === undefined ? JSON.parse(body) as Profile : decoders.profile(JSON.parse(body) as unknown);
      const cases = new Map<string, CaseRecord>();
      for (const id of profile.regression) {
        const text = await show(repo, commit.stdout.trim(), `.test-lab/cases/regression/${id}.json`);
        if (text !== null) cases.set(id, decoders === undefined ? JSON.parse(text) as CaseRecord : decoders.case(JSON.parse(text) as unknown));
      }
      const original = approvedSetOf(profile, cases);
      if (original.problems.length > 0) problems.push(...original.problems.map((p) => `${ref}: ${p}`));
      else historicalBases.set(ref, original.set);
    } catch (error) { problems.push(`${ref}: invalid historical regression set: ${String(error)}`); }
  }
  return {historicalBases, problems};
}
