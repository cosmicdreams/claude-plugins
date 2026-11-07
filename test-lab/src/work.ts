// A piece of work, its addendum, its scope log, and the journal Git can't rewrite (plan §2, §3).
//
// `.test-lab/work/<ticket>.json` is committed: the ticket, the branch it was declared on, the addendum it
// declares and its append-only scope log. The work journal lives outside the repository, in test-lab's
// data folder. Every scope change is written to the journal before the committed log, and before the
// command reports success. A verdict needs the committed log to hold every journal event, in order and
// with the same content, and the declared addendum to equal the log's replay. Events the log holds and the
// journal doesn't (another machine, a teammate) need `work import` first; a check never changes the
// journal, so running again can't make a gap acceptable.
//
// Which work a run judges is bound explicitly: `branch.<name>.test-lab-work` in the repository's local
// Git configuration (which `git branch -m` carries over), or `--work` / `--no-work` for one run.

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { canonicalJson, sha256 } from './canonical.ts';
import { git, repoTop } from './git.ts';
import type { RoleName } from './model.ts';

export type ScopeEvent = {
  id: string;
  kind: 'start' | 'add' | 'drop' | 'close';
  ticket: string;
  case?: string;
  by: string;
  role: RoleName;
  standIn: boolean;
  reason: string;
  at: string;
};

export type WorkFile = { schema: 1; ticket: string; branch: string; addendum: string[]; log: ScopeEvent[] };

export type JournalEntry = { origin: 'local' | 'imported' | 'seeded'; event: ScopeEvent };
export type Journal = { ticket: string; repoKey: string; seededAt: string | null; entries: JournalEntry[] };

export type WorkProblem =
  | { kind: 'no-journal' }
  | { kind: 'missing-event'; event: ScopeEvent }
  | { kind: 'altered-event'; event: ScopeEvent; logged: ScopeEvent }
  | { kind: 'out-of-order'; event: ScopeEvent }
  | { kind: 'needs-import'; events: ScopeEvent[] }
  | { kind: 'invalid-log'; detail: string }
  | { kind: 'declaration-mismatch'; declared: string[]; replayed: string[] };

export type WorkCheck = {
  ok: boolean;
  problems: WorkProblem[];
  addendum: string[];
  events: ScopeEvent[];
  /** Set when the journal was started from the committed log: history before it was not checked. */
  uncheckedBefore: string | null;
  closed: boolean;
};

const TICKET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function checkTicket(ticket: string): string {
  if (!TICKET.test(ticket)) throw new Error(`not a valid ticket: ${JSON.stringify(ticket)}`);
  return ticket;
}

const same = (a: ScopeEvent, b: ScopeEvent) => canonicalJson(a) === canonicalJson(b);

/** Replays a scope log into the addendum it declares. Throws on an event that can't apply. */
export function replay(log: ScopeEvent[]): { addendum: string[]; closed: boolean } {
  const addendum: string[] = [];
  let started = false;
  let closed = false;
  const ids = new Set<string>();
  for (const e of log) {
    if (ids.has(e.id)) throw new Error(`event ${e.id} appears twice`);
    ids.add(e.id);
    if (closed) throw new Error(`event ${e.id} comes after the work was closed`);
    switch (e.kind) {
      case 'start':
        if (started) throw new Error(`a second start event (${e.id})`);
        started = true;
        break;
      case 'add':
        if (!started) throw new Error(`event ${e.id} comes before the work started`);
        if (e.case === undefined || addendum.includes(e.case)) throw new Error(`event ${e.id} adds ${e.case ?? 'nothing'}, already in the addendum`);
        addendum.push(e.case);
        break;
      case 'drop': {
        const at = e.case === undefined ? -1 : addendum.indexOf(e.case);
        if (at === -1) throw new Error(`event ${e.id} drops ${e.case ?? 'nothing'}, not in the addendum`);
        addendum.splice(at, 1);
        break;
      }
      case 'close':
        closed = true;
        break;
    }
  }
  if (!started && log.length > 0) throw new Error('the log has no start event');
  return { addendum, closed };
}

/** Where the journal's events sit in the log, or the first difference. */
function alignment(journal: Journal, log: ScopeEvent[]): WorkProblem | null {
  const at = new Map(log.map((e, i) => [e.id, i]));
  let last = -1;
  for (const { event } of journal.entries) {
    const i = at.get(event.id);
    if (i === undefined) return { kind: 'missing-event', event };
    const logged = log[i] as ScopeEvent;
    if (!same(logged, event)) return { kind: 'altered-event', event, logged };
    if (i < last) return { kind: 'out-of-order', event };
    last = i;
  }
  return null;
}

/** The verdict's check: pure, and it never changes the journal. */
export function verifyWork(journal: Journal | null, file: WorkFile): WorkCheck {
  const problems: WorkProblem[] = [];
  let addendum: string[] = [];
  let closed = false;
  try {
    ({ addendum, closed } = replay(file.log));
  } catch (error) {
    problems.push({ kind: 'invalid-log', detail: (error as Error).message });
  }
  if (problems.length === 0) {
    const declared = [...file.addendum].sort();
    const replayed = [...addendum].sort();
    if (canonicalJson(declared) !== canonicalJson(replayed)) problems.push({ kind: 'declaration-mismatch', declared: file.addendum, replayed: addendum });
  }
  if (journal === null) problems.push({ kind: 'no-journal' });
  else {
    const gap = alignment(journal, file.log);
    if (gap !== null) problems.push(gap);
    else {
      const known = new Set(journal.entries.map((e) => e.event.id));
      const extra = file.log.filter((e) => !known.has(e.id));
      if (extra.length > 0) problems.push({ kind: 'needs-import', events: extra });
    }
  }
  return { ok: problems.length === 0, problems, addendum, events: file.log, uncheckedBefore: journal?.seededAt ?? null, closed };
}

export function describeProblem(p: WorkProblem): string {
  switch (p.kind) {
    case 'no-journal':
      return 'this machine has no journal for this work: run `test-lab work import`';
    case 'missing-event':
      return `the committed log is missing event ${p.event.id} (${p.event.kind}${p.event.case === undefined ? '' : ` ${p.event.case}`} by ${p.event.by} at ${p.event.at})`;
    case 'altered-event':
      return `event ${p.event.id} in the committed log differs from the journal`;
    case 'out-of-order':
      return `event ${p.event.id} is out of order in the committed log`;
    case 'needs-import':
      return `the committed log holds ${p.events.length} event(s) this machine's journal lacks (${p.events.map((e) => e.id).join(', ')}): run \`test-lab work import\``;
    case 'invalid-log':
      return `the committed log is invalid: ${p.detail}`;
    case 'declaration-mismatch':
      return `the declared addendum [${p.declared.join(', ')}] is not the log's replay [${p.replayed.join(', ')}]`;
  }
}

/**
 * `work import`: brings the journal level with the committed log, in the log's order. It refuses, before
 * changing anything, when the two have diverged; with no journal it starts one from the log, and every
 * later verdict says the history before then was not checked.
 */
export function importWork(journal: Journal | null, file: WorkFile, repoKey: string, now: Date): { journal: Journal } | { refused: string } {
  try {
    replay(file.log);
  } catch (error) {
    return { refused: `the committed log is invalid: ${(error as Error).message}` };
  }
  if (journal === null) {
    return { journal: { ticket: file.ticket, repoKey, seededAt: now.toISOString(), entries: file.log.map((event) => ({ origin: 'seeded', event })) } };
  }
  const gap = alignment(journal, file.log);
  if (gap !== null) return { refused: describeProblem(gap) };
  const origin = new Map(journal.entries.map((e) => [e.event.id, e.origin]));
  return { journal: { ...journal, entries: file.log.map((event) => ({ origin: origin.get(event.id) ?? 'imported', event })) } };
}

// --- Storage ---

/** test-lab's data folder: TEST_LAB_DATA, else the platform's per-user application data folder. */
export function dataDir(): string {
  const override = process.env['TEST_LAB_DATA'];
  if (override !== undefined && override !== '') return override;
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'test-lab');
  return join(process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'), 'test-lab');
}

/** The journal's key: the suite repository's root commits and the suite's place in it, so clones share it. */
export async function repoKeyOf(suiteRoot: string): Promise<string> {
  const top = await repoTop(suiteRoot);
  if (top === null) throw new Error(`${suiteRoot} is not in a Git repository`);
  const roots = (await git(top, ['rev-list', '--max-parents=0', 'HEAD'], { allowFail: true })).stdout.trim().split('\n').filter(Boolean).sort();
  if (roots.length === 0) throw new Error(`${top} has no commits`);
  return sha256(canonicalJson({ roots, suite: relative(top, suiteRoot) || '.' })).slice(0, 24);
}

export function journalPath(repoKey: string, ticket: string): string {
  return join(dataDir(), 'journals', repoKey, `${checkTicket(ticket)}.jsonl`);
}

export function readJournal(path: string): Journal | null {
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l !== '');
  const head = JSON.parse(lines[0] ?? 'null') as { type?: string; ticket?: string; repoKey?: string; seededAt?: string | null } | null;
  if (head?.type !== 'journal' || typeof head.ticket !== 'string' || typeof head.repoKey !== 'string') throw new Error(`${path} is not a test-lab journal`);
  const entries = lines.slice(1).map((l) => JSON.parse(l) as JournalEntry);
  for (const e of entries)
    if (!['local', 'imported', 'seeded'].includes(e.origin) || !isScopeEvent(e.event)) throw new Error(`${path} holds an invalid journal entry`);
  return { ticket: head.ticket, repoKey: head.repoKey, seededAt: head.seededAt ?? null, entries };
}

function syncWrite(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  const dir = openSync(dirname(path), 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}

export function writeJournal(path: string, journal: Journal): void {
  const head = { type: 'journal', schema: 1, ticket: journal.ticket, repoKey: journal.repoKey, seededAt: journal.seededAt };
  syncWrite(path, [head, ...journal.entries].map((r) => JSON.stringify(r)).join('\n') + '\n');
}

export function workFilePath(suiteRoot: string, ticket: string): string {
  return join(suiteRoot, '.test-lab', 'work', `${checkTicket(ticket)}.json`);
}

const KINDS = new Set(['start', 'add', 'drop', 'close']);

/** Whether a value is a well-formed scope event: every field present with its type, nothing assumed. */
export function isScopeEvent(v: unknown): v is ScopeEvent {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const e = v as Record<string, unknown>;
  const s = (x: unknown) => typeof x === 'string' && x !== '';
  return (
    s(e['id']) &&
    KINDS.has(e['kind'] as string) &&
    s(e['ticket']) &&
    (e['case'] === undefined || s(e['case'])) &&
    ((e['kind'] !== 'add' && e['kind'] !== 'drop') || s(e['case'])) &&
    s(e['by']) &&
    (e['role'] === 'qa' || e['role'] === 'developer') &&
    typeof e['standIn'] === 'boolean' &&
    typeof e['reason'] === 'string' &&
    s(e['at']) &&
    Number.isFinite(Date.parse(e['at'] as string))
  );
}

export function readWorkFile(path: string): WorkFile | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const log = parsed['log'];
  const addendum = parsed['addendum'];
  if (
    parsed['schema'] !== 1 ||
    typeof parsed['ticket'] !== 'string' ||
    typeof parsed['branch'] !== 'string' ||
    !Array.isArray(addendum) ||
    !addendum.every((c) => typeof c === 'string') ||
    !Array.isArray(log) ||
    !log.every(isScopeEvent)
  )
    throw new Error(`${path} is not a valid test-lab work file`);
  if (log.some((e) => e.ticket !== parsed['ticket'])) throw new Error(`${path} holds an event for another ticket`);
  return parsed as unknown as WorkFile;
}

export function writeWorkFile(path: string, file: WorkFile): void {
  syncWrite(path, `${JSON.stringify(file, null, 2)}\n`);
}

/**
 * Records one scope change: imports first (so a local change is never journaled ahead of an earlier event
 * pulled from elsewhere), checks the event applies, appends it to the journal and syncs it, and only then
 * writes the committed log.
 */
export function recordScopeChange(suiteRoot: string, repoKey: string, event: ScopeEvent, branch: string, now = new Date()): WorkFile {
  const filePath = workFilePath(suiteRoot, event.ticket);
  const jPath = journalPath(repoKey, event.ticket);
  const existing = readWorkFile(filePath);
  if (existing === null && event.kind !== 'start') throw new Error(`no work ${event.ticket} is declared; start it first`);
  const file: WorkFile = existing ?? { schema: 1, ticket: event.ticket, branch, addendum: [], log: [] };
  let journal = readJournal(jPath);
  if (existing !== null || journal !== null) {
    const imported = importWork(journal, file, repoKey, now);
    if ('refused' in imported) throw new Error(`refused before changing anything: ${imported.refused}`);
    journal = imported.journal;
  } else journal = { ticket: event.ticket, repoKey, seededAt: null, entries: [] };
  const log = [...file.log, event];
  const { addendum } = replay(log);
  writeJournal(jPath, { ...journal, entries: [...journal.entries, { origin: 'local', event }] });
  const next: WorkFile = { ...file, addendum, log };
  writeWorkFile(filePath, next);
  return next;
}

// --- Binding ---

export const BINDING_KEY = 'test-lab-work';

export async function currentBranch(repo: string): Promise<string | null> {
  const r = await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true });
  return r.ok ? r.stdout.trim() : null;
}

export async function bindBranch(repo: string, branch: string, ticket: string): Promise<void> {
  await git(repo, ['config', '--local', `branch.${branch}.${BINDING_KEY}`, checkTicket(ticket)]);
}

export async function unbindBranch(repo: string, branch: string): Promise<void> {
  await git(repo, ['config', '--local', '--unset', `branch.${branch}.${BINDING_KEY}`], { allowFail: true });
}

export async function boundTicket(repo: string, branch: string): Promise<string | null> {
  const r = await git(repo, ['config', '--local', '--get', `branch.${branch}.${BINDING_KEY}`], { allowFail: true });
  return r.ok ? r.stdout.trim() : null;
}

export type WorkResolution =
  | { status: 'bound'; ticket: string; via: 'git-config' | 'flag' }
  | { status: 'none'; via: 'flag' }
  | { status: 'unresolved'; reason: string; suggestion: string | null };

export type Declaration = { ticket: string; branch: string; closed: boolean };

/** Which work a run judges. Anything short of an explicit answer is unresolved, never an empty addendum. */
export function resolveWork(input: { work?: string; noWork?: boolean; branch: string | null; bound: string | null; declarations: Declaration[] }): WorkResolution {
  const find = (t: string) => input.declarations.find((d) => d.ticket === t);
  if (input.work !== undefined && input.noWork === true) return { status: 'unresolved', reason: '--work and --no-work were both given', suggestion: null };
  if (input.noWork === true) return { status: 'none', via: 'flag' };
  const ticket = input.work ?? input.bound;
  if (ticket !== undefined && ticket !== null) {
    const d = find(ticket);
    if (d === undefined) return { status: 'unresolved', reason: `no work ${ticket} is declared`, suggestion: null };
    if (d.closed) return { status: 'unresolved', reason: `work ${ticket} is closed`, suggestion: null };
    return { status: 'bound', ticket, via: input.work !== undefined ? 'flag' : 'git-config' };
  }
  if (input.branch === null) return { status: 'unresolved', reason: 'a detached checkout needs --work or --no-work', suggestion: null };
  const hint = input.declarations.find((d) => d.branch === input.branch && !d.closed);
  return {
    status: 'unresolved',
    reason: `branch ${input.branch} is bound to no work: bind it, or run with --work or --no-work`,
    suggestion: hint?.ticket ?? null,
  };
}
