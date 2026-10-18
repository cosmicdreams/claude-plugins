// QA's regression set on a branch (plan §3). The approved set is never taken from the branch's own say-so:
// the core takes the **current** base's approved set (from the remote-tracking ref, so a stale local base
// can't shrink it) and replays, in order, only the QA transitions recorded on this branch since its
// merge-base. Each delta entry carries the case's hash before the change; a mismatch against the set as
// replayed so far is a conflict, not evaluable until someone in the QA role records a reconciled
// transition that supersedes the conflicting ones. The roles are always the base's, never the branch's
// own profile, so a branch can't grant itself the QA role.

import { canonicalJson, hashOf } from './canonical.ts';
import { roleHolds } from './dispositions.ts';
import type { RoleName, Roles } from './model.ts';

/** The approved regression set: case ID to the canonical hash QA approved. */
export type ApprovedSet = Map<string, string>;

export const ABSENT = 'absent';

/** One case's change: its hash before (or `absent` for an addition) and after (or `absent` for a removal). */
export type DeltaEntry = { case: string; before: string; after: string };

export type Transition = {
  id: string;
  kind: 'approval' | 'scope' | 'graduation' | 'reconcile';
  /** The base commit the transition was made against, and the set hashes before and after it there. */
  baseCommit: string;
  setBefore: string;
  setAfter: string;
  delta: DeltaEntry[];
  /** Transitions a reconcile replaces: they stay in history, marked superseded, and are not replayed. */
  supersedes: string[];
  by: string;
  role: RoleName;
  standIn: boolean;
  at: string;
  reason: string;
};

export type ReplayProblem =
  | { kind: 'refused'; transition: string; reason: string }
  | { kind: 'conflict'; transition: string; case: string; expected: string; found: string }
  | { kind: 'mismatch'; case: string; replayed: string; declared: string }
  | { kind: 'invalid'; transition: string; reason: string };

export type ReplayResult = { set: ApprovedSet; applied: string[]; superseded: string[]; problems: ReplayProblem[] };

export function setHash(set: ApprovedSet): string {
  return hashOf([...set].sort(([a], [b]) => a.localeCompare(b)));
}

function validTransition(t: Transition): string | null {
  if (t.delta.length === 0 && t.kind !== 'reconcile') return 'an empty delta';
  const seen = new Set<string>();
  for (const d of t.delta) {
    if (seen.has(d.case)) return `case ${d.case} appears twice in the delta`;
    seen.add(d.case);
    if (d.before === ABSENT && d.after === ABSENT) return `case ${d.case} goes from absent to absent`;
    if (d.before === d.after) return `case ${d.case} does not change`;
  }
  return null;
}

/**
 * Replays the branch's QA transitions onto the current base's approved set. A transition by anyone outside
 * the base's QA list is refused (and so is everything after it, since later transitions were made on top
 * of it). A conflict stops the replay: nothing after it is trustworthy until QA reconciles.
 */
export function replayTransitions(base: ApprovedSet, transitions: Transition[], baseRoles: Roles, historicalBases: Map<string, ApprovedSet> = new Map()): ReplayResult {
  const set: ApprovedSet = new Map(base);
  const problems: ReplayProblem[] = [];
  const applied: string[] = [];
  const valid = transitions.filter((t) => {
    const refused = t.role !== 'qa' ? 'a regression transition needs the QA role' : roleHolds(baseRoles, t);
    if (refused !== null) problems.push({ kind: 'refused', transition: t.id, reason: refused });
    const invalid = validTransition(t);
    if (invalid !== null) problems.push({ kind: 'invalid', transition: t.id, reason: invalid });
    return refused === null && invalid === null;
  });
  if (problems.length > 0) return { set, applied, superseded: [], problems };
  // First validate each original binding against immutable Git history, then replay on today's base.
  const prior: Transition[] = [];
  const ids = new Set<string>();
  for (const t of valid) {
    if (ids.has(t.id)) problems.push({kind:'invalid', transition:t.id, reason:'duplicate transition ID'});
    if (t.supersedes.length > 0 && t.kind !== 'reconcile') problems.push({kind:'invalid',transition:t.id,reason:'only reconciliation can supersede transitions'});
    if (t.supersedes.some((id) => !ids.has(id))) problems.push({kind:'invalid',transition:t.id,reason:'supersedes an unknown or later transition'});
    ids.add(t.id);
    const original = historicalBases.get(t.baseCommit);
    if (original === undefined) {
      problems.push({kind:'invalid',transition:t.id,reason:`original binding has no trusted historical base commit ${t.baseCommit}`});
      prior.push(t);
      continue;
    }
    const state = new Map(original);
    const omitted = new Set([...prior.filter((p) => p.kind === 'reconcile').flatMap((p) => p.supersedes), ...t.supersedes]);
    let invalid: string | null = null;
    for (const p of [...prior.filter((p) => !omitted.has(p.id)), t]) {
      if (p === t && setHash(state) !== t.setBefore) { invalid = 'original binding setBefore does not match historical base plus preceding branch transitions'; break; }
      for (const d of p.delta) if ((state.get(d.case) ?? ABSENT) !== d.before) invalid = `original binding conflicts on ${d.case}`;
      if (invalid !== null) break;
      for (const d of p.delta) if (d.after === ABSENT) state.delete(d.case); else state.set(d.case, d.after);
    }
    if (invalid === null && setHash(state) !== t.setAfter) invalid = 'original binding setAfter does not match the delta';
    if (invalid !== null) problems.push({kind:'invalid',transition:t.id,reason:invalid});
    prior.push(t);
  }
  if (problems.length > 0) return {set, applied, superseded:[], problems};
  const superseded = new Set(valid.flatMap((t) => (t.kind === 'reconcile' ? t.supersedes : [])));
  for (const t of valid) {
    if (superseded.has(t.id)) continue;
    for (const d of t.delta) {
      const found = set.get(d.case) ?? ABSENT;
      if (found !== d.before) {
        problems.push({ kind: 'conflict', transition: t.id, case: d.case, expected: d.before, found });
        return { set, applied, superseded: [...superseded], problems };
      }
    }
    for (const d of t.delta) {
      if (d.after === ABSENT) set.delete(d.case);
      else set.set(d.case, d.after);
    }
    applied.push(t.id);
  }
  return { set, applied, superseded: [...superseded], problems };
}

/** The branch's declared approved set must equal the replay. Each difference is named. */
export function compareDeclared(replayed: ApprovedSet, declared: ApprovedSet): ReplayProblem[] {
  const problems: ReplayProblem[] = [];
  for (const id of [...new Set([...replayed.keys(), ...declared.keys()])].sort()) {
    const a = replayed.get(id) ?? ABSENT;
    const b = declared.get(id) ?? ABSENT;
    if (a !== b) problems.push({ kind: 'mismatch', case: id, replayed: a, declared: b });
  }
  return problems;
}

export function describeReplayProblem(p: ReplayProblem): string {
  switch (p.kind) {
    case 'refused':
      return `regression transition ${p.transition} refused: ${p.reason}`;
    case 'invalid':
      return `regression transition ${p.transition} is invalid: ${p.reason}`;
    case 'conflict':
      return `regression transition ${p.transition} conflicts with the base on ${p.case} (it expected ${p.expected}, the base now has ${p.found}); someone in the QA role must record a reconciled transition`;
    case 'mismatch':
      return `the branch's approved regression set has ${p.case} as ${p.declared}, but replaying QA's transitions on the current base gives ${p.replayed}`;
  }
}

/** Whether the remote-tracking base ref is fresh enough to stand for the current base. */
export function baseFreshness(input: { ref: string; commit: string | null; fetchedAt: Date | null; now: Date; maxAgeHours: number }): string | null {
  if (input.commit === null) return `the remote-tracking ref ${input.ref} does not exist: fetch it`;
  if (input.fetchedAt === null) return `when ${input.ref} was last fetched is unknown: fetch it`;
  const ageHours = (input.now.getTime() - input.fetchedAt.getTime()) / 3_600_000;
  if (ageHours > input.maxAgeHours) return `${input.ref} was last fetched ${ageHours.toFixed(1)} hours ago, more than the profile's ${input.maxAgeHours}`;
  return null;
}

export type RegressionCheck = {
  ok: boolean;
  set: string[];
  base: { ref: string; commit: string | null; fetchedAt: string | null };
  problems: string[];
};

/** The whole check: freshness, replay, comparison with the branch's declared set. */
export function checkRegression(input: {
  ref: string;
  commit: string | null;
  fetchedAt: Date | null;
  now: Date;
  maxAgeHours: number;
  base: ApprovedSet;
  baseRoles: Roles;
  transitions: Transition[];
  declared: ApprovedSet;
  historicalBases?: Map<string, ApprovedSet>;
}): RegressionCheck {
  const problems: string[] = [];
  const stale = baseFreshness(input);
  if (stale !== null) problems.push(stale);
  const replay = replayTransitions(input.base, input.transitions, input.baseRoles, input.historicalBases);
  problems.push(...replay.problems.map(describeReplayProblem));
  if (replay.problems.length === 0) problems.push(...compareDeclared(replay.set, input.declared).map(describeReplayProblem));
  return {
    ok: problems.length === 0,
    set: [...replay.set.keys()].sort(),
    base: { ref: input.ref, commit: input.commit, fetchedAt: input.fetchedAt?.toISOString() ?? null },
    problems,
  };
}

export const sameSet = (a: ApprovedSet, b: ApprovedSet): boolean => canonicalJson([...a].sort()) === canonicalJson([...b].sort());
