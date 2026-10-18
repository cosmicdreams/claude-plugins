#!/usr/bin/env node
import { identityOf, parseIdentity, sameIdentity, type RequestIdentity } from '../hooks/mod/request-identity.ts';
// The mod's only way into the core. A hooks module has no Node, so the mod starts this file with the
// host's `$.process.run` and a typed argv (hooks/mod/operation.ts builds it). The CLI's own parser
// validates the operation; the coordinator computes the verdict. This file adds what a one-shot host
// process can't: a status file the pane reads while the run goes on, a stop request, and a deadline
// that ends the run (reaping its owned process groups) before the host's own timeout kills this file
// and strands them.
//
//   node src/mod-entry.ts --data-dir
//   node src/mod-entry.ts --operation-dir DIR --deadline-ms N -- run|preflight|verify ...CLI arguments
//
// DIR is <data folder>/mod/sessions/<session>/<operation id>, made by the mod and holding its
// request.json (the operation's id, its exact CLI arguments and deadline), perhaps inputs.json, and
// perhaps already a `cancel`. The runner starts only when its folder, argv and deadline are exactly the
// request's, and stamps every status with the request's id. status.json is rewritten whole on every
// change; `cancel` asks the operation to stop, before or during its run. events.jsonl records what
// happened when, for diagnosis.
import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, sep } from 'node:path';
import { dataDir } from './work.ts';
import type { CoordinatorProgress } from './coordinator.ts';

export const STATUS = 'status.json';
export const CANCEL = 'cancel';
export const REQUEST = 'request.json';
export const EVENTS = 'events.jsonl';
/** The host's `$.process.run` kills its child at ten minutes; the run must end itself before then. */
export const MAX_DEADLINE_MS = 570_000;
/** What may be in the folder before the runner starts: the mod's request, inputs, and a stop request. */
const MOD_FILES = new Set([REQUEST, 'inputs.json', CANCEL]);
const HEARTBEAT_MS = 2_000;
const POLL_MS = 250;
const PLUGIN_ROOT = dirname(import.meta.dirname);

export type EntryStatus = {
  schema: 3;
  requestIdentity: RequestIdentity | null;
  operationId: string;
  operation: 'run' | 'preflight' | 'verify';
  state: 'running' | 'finished' | 'failed' | 'cancelled';
  startedAt: string;
  updatedAt: string;
  runDir: string | null;
  step: string | null;
  stopping: 'requested' | 'deadline' | 'signal' | null;
  result: { exitCode: number; verdict: string; rule: number; summary: string } | null;
  error: string | null;
};

/** The sessions folder, resolved; the mod's operation folders must sit exactly two levels under it. */
export function sessionsRoot(): string {
  return join(dataDir(), 'mod', 'sessions');
}

export function operationDirProblem(dir: string, root = sessionsRoot()): string | null {
  if (!existsSync(dir) || !existsSync(root)) return 'the operation folder does not exist';
  const real = realpathSync(dir);
  const parts = relative(realpathSync(root), real).split(sep);
  if (parts.length !== 2 || parts.some((p) => p === '' || p === '..' || !/^[A-Za-z0-9._-]+$/.test(p))) return 'the operation folder is not a mod session folder';
  if (existsSync(join(real, STATUS))) return 'the operation folder was already used';
  if (readdirSync(real).some((f) => !MOD_FILES.has(f))) return 'the operation folder holds unexpected files';
  return null;
}

/** The request this folder holds, checked against the argv the runner was given; or why it doesn't match. */
export function requestProblem(dir: string, cli: readonly string[], deadline: number): { id: string; identity: RequestIdentity } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, REQUEST), 'utf8'));
  } catch {
    return { error: 'the operation folder holds no readable request' };
  }
  const r = raw as Record<string, unknown> | null;
  if (r === null || typeof r !== 'object' || r['schema'] !== 2 || typeof r['id'] !== 'string' || !Array.isArray(r['cli']) || typeof r['deadlineMs'] !== 'number' || typeof r['hasInputs'] !== 'boolean') return { error: 'the operation request is not a test-lab request from this version' };
  if (r['id'] !== basename(realpathSync(dir))) return { error: 'the operation request is for another operation folder' };
  if (r['cli'].length !== cli.length || r['cli'].some((a, i) => a !== cli[i]) || r['deadlineMs'] !== deadline || r['operation'] !== cli[0]) return { error: 'the runner\'s arguments are not the ones the operation requested' };
  if (r['hasInputs'] !== existsSync(join(dir, 'inputs.json'))) return { error: 'the operation request and its inputs file disagree' };
  const identity = parseIdentity(r['requestIdentity']);
  if (identity === null || identity.operationId !== r['id']) return { error: 'the operation request holds no valid request identity' };
  return { id: r['id'], identity };
}

/**
 * Why this copy of test-lab cannot run the core, or null. The CLI needs the pinned source parser
 * (kit/package.json's typescript) inside this plugin copy. No copy ships it: an installed release gets
 * it from `node scripts/install-runtime.ts` (npm ci in its own kit folder), a development checkout from
 * `npm ci`. A parser reached through a link out of the copy doesn't count.
 */
export const installStep = (root = PLUGIN_ROOT): string => {
  const script = join(root, 'scripts', 'install-runtime.ts');
  return `node ${/[\s'"$`\\]/.test(script) ? JSON.stringify(script) : script}`;
};
export function runtimeProblem(root = PLUGIN_ROOT): string | null {
  const missing = `test-lab's runtime parser is not installed in this plugin copy (${root}). Install it once with: ${installStep(root)} (npm ci in the copy's kit folder). Nothing was installed.`;
  let pinned: unknown;
  try {
    pinned = (JSON.parse(readFileSync(join(root, 'kit', 'package.json'), 'utf8')) as { dependencies?: Record<string, unknown> }).dependencies?.['typescript'];
  } catch {
    return `this copy of test-lab has no kit/package.json (${root})`;
  }
  try {
    let manifest = createRequire(join(root, 'kit', 'package.json')).resolve('typescript/package.json');
    let pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name: string; version: string };
    if (pkg.name === '@typescript/typescript6') {
      manifest = createRequire(manifest).resolve('@typescript/old/package.json');
      pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name: string; version: string };
    }
    if (pkg.name !== 'typescript' || pkg.version !== pinned) return `test-lab's runtime parser must be typescript ${String(pinned)}; this copy has ${pkg.name} ${pkg.version}. Reinstall it with: ${installStep(root)}. Nothing was installed.`;
    if (!realpathSync(manifest).startsWith(`${realpathSync(root)}${sep}`)) return missing;
    return null;
  } catch {
    return missing;
  }
}

function write(dir: string, status: EntryStatus): void {
  const tmp = join(dir, `.${STATUS}.${process.pid}`);
  writeFileSync(tmp, `${JSON.stringify(status)}\n`);
  renameSync(tmp, join(dir, STATUS));
}

const missingDependency = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
};

export async function entry(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === '--data-dir') {
    const problem = runtimeProblem();
    process.stdout.write(`${JSON.stringify({ sessions: sessionsRoot(), node: process.versions.node, runtime: problem === null ? { ok: true } : { problem } })}\n`);
    return 0;
  }
  const split = args.indexOf('--');
  const head = split < 0 ? args : args.slice(0, split);
  const cli = split < 0 ? [] : args.slice(split + 1);
  if (head.length !== 4 || head[0] !== '--operation-dir' || head[2] !== '--deadline-ms') {
    process.stderr.write('usage: mod-entry.ts --operation-dir DIR --deadline-ms N -- run|preflight|verify ...\n');
    return 4;
  }
  const dir = head[1]!;
  const deadline = Number(head[3]);
  const problem = operationDirProblem(dir);
  if (problem !== null) {
    process.stderr.write(`${problem}\n`);
    return 4;
  }
  const operation = cli[0];
  if (operation !== 'run' && operation !== 'preflight' && operation !== 'verify') {
    process.stderr.write('expected run, preflight or verify\n');
    return 4;
  }
  // A folder whose request doesn't match gets no status: nothing may speak for an operation it isn't.
  const request = requestProblem(dir, cli, deadline);
  if ('error' in request) {
    process.stderr.write(`${request.error}\n`);
    return 4;
  }
  const event = (kind: string, detail: Record<string, unknown> = {}) => {
    try {
      appendFileSync(join(dir, EVENTS), `${JSON.stringify({ at: new Date().toISOString(), kind, ...detail })}\n`);
    } catch {
      // Diagnosis only.
    }
  };
  const status: EntryStatus = { schema: 3, requestIdentity: null, operationId: request.id, operation, state: 'running', startedAt: new Date().toISOString(), updatedAt: '', runDir: null, step: null, stopping: null, result: null, error: null };
  const save = () => {
    status.updatedAt = new Date().toISOString();
    write(dir, status);
  };
  // A stop asked for before the core started: nothing runs, and nothing is claimed about the site.
  const cancelled = (why: string): number => {
    status.state = 'cancelled';
    status.error = why;
    save();
    event('cancelled', { why });
    return 4;
  };
  event('start', { pid: process.pid, deadline });
  if (existsSync(join(dir, CANCEL))) {
    status.stopping = 'requested';
    return cancelled('stopped before the run started; nothing ran');
  }
  save();
  const controller = new AbortController();
  const stop = (why: NonNullable<EntryStatus['stopping']>) => {
    if (status.stopping !== null) return;
    status.stopping = why;
    save();
    event('stopping', { why, step: status.step, runDir: status.runDir });
    controller.abort(new Error(why === 'deadline' ? `stopped at the ${deadline} ms deadline` : `stopped: ${why}`));
  };
  const onSignal = () => stop('signal');
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const timers: ReturnType<typeof setInterval>[] = [];
  timers.push(setInterval(() => existsSync(join(dir, CANCEL)) && stop('requested'), POLL_MS));
  timers.push(setInterval(save, HEARTBEAT_MS));
  try {
    if (!Number.isSafeInteger(deadline) || deadline < 1_000 || deadline > MAX_DEADLINE_MS) throw new Error(`the deadline must be 1000 to ${MAX_DEADLINE_MS} ms`);
    timers.push(setTimeout(() => stop('deadline'), deadline));
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error(`test-lab needs Node.js 24 or newer; this is ${process.versions.node}`);
    const runtime = runtimeProblem();
    if (runtime !== null) throw new Error(runtime);
    let modules: [typeof import('./cli.ts'), typeof import('./coordinator.ts')];
    try {
      modules = await Promise.all([import('./cli.ts'), import('./coordinator.ts')]);
    } catch (error) {
      if (missingDependency(error)) throw new Error(`test-lab's runtime dependencies are not in this plugin copy (${PLUGIN_ROOT}): ${error instanceof Error ? firstLineOf(error.message) : String(error)}. Install them with: ${installStep()}. Nothing was installed.`);
      throw error;
    }
    const [{ parseArguments }, { coordinate }] = modules;
    const parsed = parseArguments(cli);
    const context = { operation: parsed.operation, appRoot: realpathSync(parsed.appRoot), suiteRoot: realpathSync(parsed.suiteRoot), environment: parsed.environment, work: parsed.work ?? null, noWork: parsed.noWork === true };
    const identity = await identityOf(request.id, cli, deadline, context, parsed.environmentValues ?? null);
    if (!sameIdentity(identity, request.identity)) throw new Error('the validated request identity does not match its arguments/context/work/inputs');
    status.requestIdentity = identity;
    save();
    if (controller.signal.aborted) return cancelled(`stopped before the run started (${status.stopping}); nothing ran`);
    let reported: string | null = null;
    const onProgress = (e: CoordinatorProgress) => {
      if (e.kind === 'run-dir') status.runDir = reported = e.runDir;
      else status.step = `${e.suite}: ${e.purpose}`;
      event(e.kind, e.kind === 'run-dir' ? { runDir: e.runDir } : { suite: e.suite, purpose: e.purpose, id: e.id });
      save();
    };
    const result = await coordinate({ ...parsed, requestIdentity: identity, signal: controller.signal, onProgress });
    // The run folder is the one the core announced when it made it, in this process; never another.
    if (reported !== null && result.runDir !== reported) throw new Error(`the core reported run folder ${result.runDir} after announcing ${reported}`);
    status.state = 'finished';
    status.runDir = result.runDir;
    status.result = { exitCode: result.exitCode, verdict: result.verdict.verdict, rule: result.verdict.rule, summary: result.summary };
    save();
    event('finished', { exitCode: result.exitCode, verdict: result.verdict.verdict, rule: result.verdict.rule, stopping: status.stopping, reasons: result.verdict.reasons });
    return result.exitCode;
  } catch (error) {
    status.state = 'failed';
    status.error = error instanceof Error ? error.message : String(error);
    save();
    event('failed', { error: status.error, stopping: status.stopping });
    process.stderr.write(`${status.error}\n`);
    return 4;
  } finally {
    for (const t of timers) clearInterval(t);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

const firstLineOf = (text: string): string => text.split('\n')[0] ?? text;

if (import.meta.main) process.exitCode = await entry(process.argv.slice(2));
