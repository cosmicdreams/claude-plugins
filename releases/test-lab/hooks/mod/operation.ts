import { identityOf, parseIdentity, sameIdentity, type RequestIdentity } from './request-identity.ts';

// A run the mod starts: what the tool accepts, the request and argv it hands the runner
// (src/mod-entry.ts), the strict reading of what comes back, and how the result is bound to the
// operation that asked for it. Pure, so the hooks module and its tests share it. Every file read here
// is untrusted: a status that doesn't parse, names another operation, or points at a run folder
// outside the suite's own runs is shown as unreadable, never followed.

export type Operation = 'run' | 'preflight' | 'verify';
export type InputValue = { state: 'set'; value: string } | { state: 'unset' };

export type RunInput = {
  operation: Operation;
  appRoot: string;
  suiteRoot: string;
  environment: string;
  work: string | null;
  noWork: boolean;
  adapter: string | null;
  inputs: Record<string, InputValue> | null;
  timeoutMs: number;
};

export const OPERATION_LABEL: Record<Operation, string> = { run: 'Fast run', preflight: 'Preflight', verify: 'Policy check' };
/** Below the runner's own ceiling (src/mod-entry.ts MAX_DEADLINE_MS), which is below the host's ten minutes. */
export const DEFAULT_TIMEOUT_MS = 540_000;
export const MAX_TIMEOUT_MS = 570_000;
/** How long the host waits past the runner's deadline for it to finish its verdict and exit. */
export const HOST_GRACE_MS = 25_000;
/** A running status not rewritten for this long has an unresponsive runner (not necessarily a gone one). */
export const STALE_MS = 15_000;
/** How long a launched runner may take to write its first status before the pane calls it unresponsive. */
export const STARTUP_MS = 20_000;
/** A verdict may start this much before the mod recorded the operation (clock granularity), no more. */
export const CLOCK_SKEW_MS = 5_000;
export const STATUS_SCHEMA = 3;

export const RUN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    operation: { type: 'string', enum: ['run', 'preflight', 'verify'], description: 'run: the fast tier on a local candidate and its verdict (ready means ready to deploy for QA; human QA owns sign-off). preflight: configuration and discovery only, never login or tests. verify: persisted policy and QA history, headless; success is not readiness.' },
    appRoot: { type: 'string', description: 'The application worktree the site serves, absolute.' },
    suiteRoot: { type: 'string', description: 'The suite checkout that holds .test-lab/, absolute. May be the application worktree.' },
    environment: { type: 'string', description: 'The profile environment id, for example local.' },
    work: { type: 'string', description: 'The ticket this work is bound to. Leave out to use the branch binding.' },
    noWork: { type: 'boolean', description: 'True to judge the regression set alone, with no work addendum.' },
    adapter: { type: 'string', description: 'The local site adapter: an absolute Node script answering identity, fixture and configuration.' },
    inputs: { type: 'object', description: 'Nonsecret declared environment inputs, each {"state":"set","value":"..."} or {"state":"unset"}. Never secrets.', additionalProperties: { type: 'object' } },
    timeoutMs: { type: 'integer', minimum: 10_000, maximum: MAX_TIMEOUT_MS, description: 'How long the whole operation may take; it stops itself and reports Inconclusive after that.' },
  },
  required: ['operation', 'appRoot', 'suiteRoot', 'environment'],
} as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const absolute = (v: unknown): v is string => typeof v === 'string' && v.startsWith('/') && !v.includes('\0') && !v.split('/').includes('..');
const KEYS = new Set(['operation', 'appRoot', 'suiteRoot', 'environment', 'work', 'noWork', 'adapter', 'inputs', 'timeoutMs']);

/** The tool's arguments, refused with a reason the model can act on. The core validates the rest. */
export function parseRunInput(e: Record<string, unknown>, envelope: ReadonlySet<string> = new Set()): RunInput | { error: string } {
  for (const key of Object.keys(e)) if (!KEYS.has(key) && !envelope.has(key)) return { error: `${key} is not an argument of this tool` };
  const op = e['operation'];
  if (op !== 'run' && op !== 'preflight' && op !== 'verify') return { error: 'operation must be run, preflight or verify' };
  for (const key of ['appRoot', 'suiteRoot'] as const) if (!absolute(e[key])) return { error: `${key} must be an absolute path` };
  if (e['adapter'] !== undefined && !absolute(e['adapter'])) return { error: 'adapter must be an absolute path to a Node script' };
  const env = e['environment'];
  if (typeof env !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(env)) return { error: 'environment must be a profile environment id' };
  const work = e['work'];
  if (work !== undefined && (typeof work !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(work))) return { error: 'work must be a ticket id' };
  const noWork = e['noWork'];
  if (noWork !== undefined && typeof noWork !== 'boolean') return { error: 'noWork must be true or false' };
  if (noWork === true && work !== undefined) return { error: 'give work or noWork, not both' };
  let inputs: Record<string, InputValue> | null = null;
  if (e['inputs'] !== undefined) {
    if (!isObject(e['inputs'])) return { error: 'inputs must be an object of named values' };
    inputs = {};
    for (const [name, raw] of Object.entries(e['inputs'])) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { error: `input name ${name} is not an environment variable name` };
      if (isObject(raw) && raw['state'] === 'unset' && Object.keys(raw).length === 1) inputs[name] = { state: 'unset' };
      else if (isObject(raw) && raw['state'] === 'set' && typeof raw['value'] === 'string' && Object.keys(raw).length === 2) inputs[name] = { state: 'set', value: raw['value'] };
      else return { error: `input ${name} must be {"state":"set","value":"..."} or {"state":"unset"}` };
    }
  }
  const timeout = e['timeoutMs'] ?? DEFAULT_TIMEOUT_MS;
  if (typeof timeout !== 'number' || !Number.isSafeInteger(timeout) || timeout < 10_000 || timeout > MAX_TIMEOUT_MS) return { error: `timeoutMs must be a whole number from 10000 to ${MAX_TIMEOUT_MS}` };
  if (op === 'verify' && (e['adapter'] !== undefined || inputs !== null || e['timeoutMs'] !== undefined)) return { error: 'verify reads persisted policy only: it takes no adapter, inputs or timeoutMs' };
  return { operation: op, appRoot: e['appRoot'] as string, suiteRoot: e['suiteRoot'] as string, environment: env, work: typeof work === 'string' ? work : null, noWork: noWork === true, adapter: (e['adapter'] as string | undefined) ?? null, inputs, timeoutMs: timeout };
}

/** The CLI's arguments for a request: every value its own element. */
export function cliArgs(input: RunInput, inputsFile: string | null): string[] {
  const cli = [input.operation, '--app-root', input.appRoot, '--suite-root', input.suiteRoot, '--env', input.environment];
  if (input.work !== null) cli.push('--work', input.work);
  if (input.noWork) cli.push('--no-work');
  if (input.operation !== 'verify') {
    if (input.adapter !== null) cli.push('--adapter', input.adapter);
    if (inputsFile !== null) cli.push('--inputs', inputsFile);
    cli.push('--timeout-ms', String(input.timeoutMs));
  }
  return cli;
}

/** The runner's argv: no shell, the CLI's arguments after `--`. */
export function entryArgv(node: string, pluginRoot: string, operationDir: string, input: RunInput, inputsFile: string | null): string[] {
  return [node, `${pluginRoot}/src/mod-entry.ts`, '--operation-dir', operationDir, '--deadline-ms', String(input.timeoutMs), '--', ...cliArgs(input, inputsFile)];
}

/**
 * request.json: the operation's identity and its explicit, nonsecret arguments. The runner refuses to
 * start unless its folder is named for `id` and its argv is exactly `cli` with `deadlineMs`, and stamps
 * every status with `id`, so a status can only describe the request this folder holds. Input values stay
 * in inputs.json; the request says only whether there are any.
 */
export type RequestFile = { schema: 2; id: string; operation: Operation; deadlineMs: number; cli: string[]; hasInputs: boolean; requestIdentity: RequestIdentity };

export async function requestOf(id: string, dir: string, input: RunInput, real: { app: string; suite: string }): Promise<RequestFile> {
  const cli = cliArgs(input, input.inputs === null ? null : `${dir}/inputs.json`);
  const context = { operation: input.operation, appRoot: real.app, suiteRoot: real.suite, environment: input.environment, work: input.work, noWork: input.noWork };
  return { schema: 2, id, operation: input.operation, deadlineMs: input.timeoutMs, cli, hasInputs: input.inputs !== null, requestIdentity: await identityOf(id, cli, input.timeoutMs, context, input.inputs) };
}

export type Verdict = 'ready' | 'not-ready' | 'inconclusive' | 'not-evaluable';
export type RunStatus = {
  requestIdentity: RequestIdentity | null;
  operationId: string;
  operation: Operation;
  state: 'running' | 'finished' | 'failed' | 'cancelled';
  startedAt: string;
  updatedAt: string;
  runDir: string | null;
  step: string | null;
  stopping: 'requested' | 'deadline' | 'signal' | null;
  result: { exitCode: number; verdict: Verdict; rule: number; summary: string } | null;
  /** Why the runner could not produce a verdict (the file's `error`). */
  failure: string | null;
};

const time = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const nullable = <T>(v: unknown, is: (x: unknown) => x is T): v is T | null => v === null || is(v);
const str = (v: unknown): v is string => typeof v === 'string';
const VERDICTS = new Set(['ready', 'not-ready', 'inconclusive', 'not-evaluable']);
/** The exit code the CLI gives each verdict (src/coordinator.ts EXIT_CODES); 0 also for a passed policy check. */
const EXIT: Record<string, number> = { ready: 0, 'not-ready': 2, inconclusive: 3, 'not-evaluable': 4 };
const STATUS_KEYS = ['schema', 'requestIdentity', 'operationId', 'operation', 'state', 'startedAt', 'updatedAt', 'runDir', 'step', 'stopping', 'result', 'error'];

/** status.json, read strictly, for the operation `expected` names. Anything else is unreadable. */
export function parseStatus(text: string | undefined, expected: { id: string; operation: Operation }): RunStatus | { error: string } {
  if (text === undefined) return { error: 'the runner wrote no status' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'the runner status is not JSON' };
  }
  if (!isObject(raw) || raw['schema'] !== STATUS_SCHEMA) return { error: 'the runner status is not a test-lab status from this version' };
  const s = raw;
  if (Object.keys(s).length !== STATUS_KEYS.length || !STATUS_KEYS.every((k) => k in s)) return { error: 'the runner status has unexpected fields' };
  if (s['operationId'] !== expected.id) return { error: 'the runner status belongs to another operation' };
  if (s['operation'] !== expected.operation) return { error: 'the runner status is for another kind of operation' };
  const requestIdentity = parseIdentity(s['requestIdentity']);
  if (s['requestIdentity'] !== null && requestIdentity === null) return { error: 'the runner status has an invalid request identity' };
  const state = s['state'];
  if (state !== 'running' && state !== 'finished' && state !== 'failed' && state !== 'cancelled') return { error: 'the runner status has no state' };
  if (!time(s['startedAt']) || !time(s['updatedAt'])) return { error: 'the runner status has no times' };
  if (!nullable(s['runDir'], absolute) || !nullable(s['step'], str) || !nullable(s['error'], str)) return { error: 'the runner status is malformed' };
  const stopping = s['stopping'];
  if (stopping !== null && stopping !== 'requested' && stopping !== 'deadline' && stopping !== 'signal') return { error: 'the runner status is malformed' };
  let result: RunStatus['result'] = null;
  if (s['result'] !== null) {
    const r = s['result'];
    if (!isObject(r) || !VERDICTS.has(String(r['verdict'])) || typeof r['rule'] !== 'number' || typeof r['summary'] !== 'string' || typeof r['exitCode'] !== 'number') return { error: 'the runner result is malformed' };
    // A verdict carries its own exit code; a passed policy check exits 0 whatever the readiness verdict.
    if (r['exitCode'] !== EXIT[String(r['verdict'])] && !(expected.operation === 'verify' && r['exitCode'] === 0)) return { error: 'the runner result exit code does not match its verdict' };
    result = { exitCode: r['exitCode'], verdict: r['verdict'] as Verdict, rule: r['rule'], summary: r['summary'] };
  }
  if ((state === 'finished') !== (result !== null) || (state === 'finished' && s['runDir'] === null)) return { error: 'the runner status is inconsistent' };
  if ((state === 'failed' || state === 'cancelled') && s['error'] === null) return { error: 'the runner status is inconsistent' };
  if (state === 'cancelled' && (s['runDir'] !== null || stopping === null)) return { error: 'the runner status is inconsistent' };
  return { requestIdentity, operationId: expected.id, operation: expected.operation, state, startedAt: s['startedAt'], updatedAt: s['updatedAt'], runDir: s['runDir'], step: s['step'], stopping, result, failure: s['error'] };
}

/** A run folder the coordinator made under this suite: `<suite>/.test-lab/runs/<one name>`, nothing else. */
export function runFolderOf(runDir: string, suiteRoot: string): string | null {
  const root = `${suiteRoot.replace(/\/+$/, '')}/.test-lab/runs/`;
  if (!runDir.startsWith(root)) return null;
  const name = runDir.slice(root.length);
  return /^[A-Za-z0-9-]+$/.test(name) ? runDir : null;
}

/** What a finished operation's verdict must agree with: its status and the operation the mod recorded. */
export type VerdictClaim = { requestIdentity: RequestIdentity | null; runDir: string; environment: string; startedAt: string; finishedAt: string; verdict: Verdict; rule: number; context: { appRoot: string; suiteRoot: string; environmentId: string } | null };

/**
 * Why a verdict file is not this operation's result, or null when it is. Only fields the core wrote
 * and the mod recorded are compared; nothing missing is filled in.
 */
export function bindingProblem(op: OperationRecord, status: RunStatus, v: VerdictClaim): string | null {
  const result = status.result!;
  if (v.runDir !== status.runDir) return `verdict.json names another run folder (${v.runDir})`;
  if (v.verdict !== result.verdict || v.rule !== result.rule) return `the runner reported ${result.verdict} (rule ${result.rule}) but verdict.json says ${v.verdict} (rule ${v.rule})`;
  if (Number.isNaN(Date.parse(v.startedAt)) || Date.parse(v.startedAt) < op.startedAt - CLOCK_SKEW_MS) return 'verdict.json is from a run that started before this operation, so it is not this operation\'s result';
  if (Number.isNaN(Date.parse(v.finishedAt)) || Date.parse(v.finishedAt) < Date.parse(v.startedAt)) return 'verdict.json has no consistent run times';
  if (v.environment !== op.input.environment) return `verdict.json is for environment ${v.environment}, not ${op.input.environment}`;
  if (v.context === null && v.verdict === 'ready') return 'verdict.json records no context, so a Ready verdict is not shown';
  if (v.context !== null && v.context.suiteRoot !== op.suiteReal) return `verdict.json is for suite ${v.context?.suiteRoot}, not ${op.suiteReal}`;
  if (v.context !== null && op.appReal !== null && v.context?.appRoot !== op.appReal) return `verdict.json is for application ${v.context?.appRoot}, not ${op.appReal}`;
  if (v.context !== null && v.context.environmentId !== op.input.environment) return `verdict.json is for environment ${v.context?.environmentId}, not ${op.input.environment}`;
  if (!sameIdentity(op.requestIdentity, status.requestIdentity) || !sameIdentity(op.requestIdentity, v.requestIdentity)) return 'the status/artifact request identity does not match this operation; its result is not shown';
  return null;
}

// --- The store: one key per operation, so concurrent operations never overwrite each other ---

/**
 * One operation this session started, as the mod recorded it, under its own store key. Only the call
 * that started it writes it. Inputs stay in the operation folder.
 *  - preparing: recorded, runner not yet started;
 *  - launched: handed to the host's `$.process.run`;
 *  - ended: that call returned (exit code, or why it failed);
 *  - not-started: interrupted before the runner was started, so nothing ran.
 */
export type OperationRecord = {
  schema: 2;
  session: string;
  id: string;
  dir: string;
  input: Omit<RunInput, 'inputs'> & { hasInputs: boolean };
  suiteReal: string;
  appReal: string | null;
  startedAt: number;
  launchedAt: number | null;
  requestIdentity: RequestIdentity | null;
  phase: 'preparing' | 'launched' | 'ended' | 'not-started';
  exit: { code: number | null; failure: string | null } | null;
};
export type Shown = { kind: 'operation'; id: string } | { kind: 'verdict'; runDir: string } | null;

/** Completed operations kept per session; an operation still preparing or running is never evicted. */
export const KEEP_OPERATIONS = 10;
export const KEEP_SESSION_MS = 14 * 24 * 3600_000;

const sessionPart = (session: string): string => session.replace(/[^A-Za-z0-9._-]/g, '_');
export const operationKey = (session: string, id: string): string => `op:${sessionPart(session)}:${id}`;
export const operationPrefix = (session: string): string => `op:${sessionPart(session)}:`;
export const shownKey = (session: string): string => `shown:${sessionPart(session)}`;

/** An operation record from the store, or null when it doesn't parse or belongs to another session. */
export function parseRecord(value: unknown, session: string): OperationRecord | null {
  if (!isObject(value) || value['schema'] !== 2 || value['session'] !== session) return null;
  const o = value
  if (typeof o['id'] !== 'string' || !/^[A-Za-z0-9-]+$/.test(o['id']) || !absolute(o['dir']) || !o['dir'].endsWith(`/${o['id']}`) || !absolute(o['suiteReal']) || !nullable(o['appReal'], absolute) || typeof o['startedAt'] !== 'number' || !isObject(o['input'])) return null;
  if ('error' in parseRunInput(stripRecord(o['input']))) return null;
  const phase = o['phase'];
  if (phase !== 'preparing' && phase !== 'launched' && phase !== 'ended' && phase !== 'not-started') return null;
  const exit = o['exit'];
  if (exit !== null && !(isObject(exit) && nullable(exit['code'], (x): x is number => typeof x === 'number') && nullable(exit['failure'], str))) return null;
  if (o['launchedAt'] !== undefined && o['launchedAt'] !== null && (typeof o['launchedAt'] !== 'number' || !Number.isFinite(o['launchedAt']))) return null;
  return { ...o, launchedAt: o['launchedAt'] ?? null, requestIdentity: parseIdentity(o['requestIdentity']) } as unknown as OperationRecord;
}

export function parseShown(value: unknown): Shown {
  if (isObject(value) && value['kind'] === 'operation' && typeof value['id'] === 'string') return { kind: 'operation', id: value['id'] };
  if (isObject(value) && value['kind'] === 'verdict' && absolute(value['runDir'])) return { kind: 'verdict', runDir: value['runDir'] };
  return null;
}

/** A recorded input back in the tool's own shape, so the same validation re-reads it. */
export function stripRecord(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (k !== 'hasInputs' && v !== null && !(k === 'noWork' && v === false) && !(k === 'timeoutMs' && input['operation'] === 'verify')) out[k] = v;
  return out;
}

export function recordOf(session: string, id: string, dir: string, input: RunInput, real: { suite: string; app: string | null }, startedAt: number): OperationRecord {
  const { inputs, ...rest } = input;
  return { schema: 2, session, id, dir, input: { ...rest, hasInputs: inputs !== null }, suiteReal: real.suite, appReal: real.app, startedAt, launchedAt: null, requestIdentity: null, phase: 'preparing', exit: null };
}

/** Completed records past the history cap, oldest first: the ones to delete. Active ones are kept. */
export function evictable(records: readonly OperationRecord[]): OperationRecord[] {
  const done = records.filter((r) => r.phase === 'ended' || r.phase === 'not-started').sort((a, b) => a.startedAt - b.startedAt);
  return done.slice(0, Math.max(0, done.length - KEEP_OPERATIONS));
}

// --- How the pane describes an operation that has no verdict yet, or never will ---

export type ProgressState = 'starting' | 'running' | 'unresponsive' | 'unknown' | 'stopped' | 'failed' | 'unreadable';
/** States in which the runner may still be alive: the pane keeps polling and keeps Stop. */
export const LIVE_STATES: ReadonlySet<ProgressState> = new Set(['starting', 'running', 'unresponsive', 'unknown']);

const seconds = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

/** An observation budget, never proof of death. Preparation has no launch deadline. */
export const hardEnd = (record: OperationRecord): number | null => record.launchedAt === null ? null : record.launchedAt + record.input.timeoutMs + HOST_GRACE_MS;
export const shouldPoll = (record: OperationRecord, now: number): boolean => record.phase !== 'ended' && record.phase !== 'not-started' && now <= (hardEnd(record) ?? record.startedAt + KEEP_SESSION_MS);

export function progressText(record: OperationRecord, status: RunStatus | { error: string }, now: number, missing: boolean): { state: ProgressState; text: string } {
  const label = OPERATION_LABEL[record.input.operation];
  const ended = record.phase === 'ended';
  const end = hardEnd(record);
  const expired = end !== null && now > end;
  if (record.phase === 'not-started') return { state: 'stopped', text: `${label} was interrupted before it started; nothing ran.` };
  if (missing) {
    if (ended) return { state: 'unreadable', text: `${label}: the runner wrote no status${record.exit?.failure ? `; the host reported: ${record.exit.failure}` : ''}.` };
    if (record.phase === 'preparing') return { state: 'starting', text: `${label} preparing (${seconds(now - record.startedAt)}); the runner has not launched. Stop asks it to cancel.` };
    if (expired) return { state: 'unknown', text: `${label}: the launch budget elapsed with no status; completion and cleanup are unknown. Stop makes a best-effort cancellation request.` };
    const waited = now - (record.launchedAt ?? record.startedAt);
    if (waited <= STARTUP_MS) return { state: 'starting', text: `${label} starting (${seconds(waited)})` };
    return { state: 'unresponsive', text: `${label} has not reported for ${seconds(waited)} since it was started; it may still be starting, or be stuck.` };
  }
  if ('error' in status) return { state: ended ? 'unreadable' : 'unknown', text: `${label}: ${status.error}.${ended ? '' : ' Completion and cleanup are unknown; Stop makes a best-effort cancellation request.'}` };
  if (status.state === 'failed') return { state: 'failed', text: `${label} could not run: ${status.failure ?? 'no reason given'}` };
  if (status.state === 'cancelled') {
    const why = status.stopping === 'requested' ? 'a stop was asked for' : status.stopping === 'deadline' ? 'it ran out of time' : 'its runner was signalled';
    return { state: 'stopped', text: `${label} was stopped before the run started (${why}); nothing ran.` };
  }
  if (ended) return { state: 'unknown', text: `${label}: the host call ended without a final status. Completion and descendant cleanup are unknown. Stop makes a best-effort cancellation request.` };
  if (expired) return { state: 'unknown', text: `${label} stopped reporting a final verdict before its launch budget elapsed. Completion and cleanup are unknown. Stop makes a best-effort cancellation request.` };
  const elapsed = seconds(now - Date.parse(status.startedAt));
  const quiet = now - Date.parse(status.updatedAt);
  if (quiet > STALE_MS) {
    return { state: 'unresponsive', text: `${label} has not reported for ${seconds(quiet)} (running for ${elapsed}); it may be busy or stuck. Stop asks it to end; its deadline ends it otherwise.` };
  }
  const stopping = status.stopping === null ? '' : status.stopping === 'deadline' ? ' · out of time, stopping' : ' · stopping';
  return { state: 'running', text: `${label} running for ${elapsed}${status.step === null ? '' : ` · now ${status.step}`}${stopping}` };
}
