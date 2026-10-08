import type { Handshake } from './protocol.ts';
import { isEntrypoint } from './entrypoint.ts';
/**
 * Serve build steps to the design-lab runner plugin from one process, so no model relays a build.
 * Port of scripts/figma_runner.ts (the migration oracle): the same routes, token and origin lock,
 * handshake, dump steps, progress heartbeat and start/status/stop/serve commands, with the build
 * driver called in process instead of once per request in a subprocess.
 *
 *   figma-runner.ts serve  --project W   serve one run in the foreground
 *   figma-runner.ts start  --project W   reuse this run's live server, or start one detached
 *   figma-runner.ts status --project W   whether this run's server is alive
 *   figma-runner.ts stop   --project W   stop this run's server
 *
 * It listens on 127.0.0.1:8765, the one address the plugin's manifest allows. Every request carries
 * `token=T` (the person's runner token in DESIGN_LAB_HOME/runner-token, mode 600) and the runner's
 * `version`; cross-origin reads are allowed only for the `null` origin of a plugin iframe.
 *
 *   GET  /health?token=T                         the projects this server serves, and its process id
 *   GET  /next?fileKey=K&token=T                 next step; use_figma steps carry their code inline
 *   GET  /file?fileKey=K&step=S&i=N&token=T      bytes of the Nth file of an upload step
 *   POST /record?fileKey=K&step=S&token=T        the step's result (a screenshot arrives as base64 PNG)
 *   POST /error?fileKey=K&token=T                a failed step, logged to W/figma/runner.log
 *
 * Runner payloads are not size limited: the plugin fetches code over its own connection, and the
 * 50,000-character use_figma limit applies only when a model relays the payload.
 */
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuildDriver } from './figma-build.ts';
import type { DriverOptions } from './figma-build.ts';
import type { BuildResult } from './build-artifacts.ts';
import { ascii, sorted } from './json.ts';
import { callPayload, stripTemplate, Renderer } from './render-payload.ts';
import { pluginRoot, sharedRequire } from './runtime.ts';
import { designLabHome, TOKEN_FILE } from './design-lab-home.ts';
import { validateRunnerRecord } from './contracts.ts';
import type { DumpKind } from './contracts.ts';
import type { RunnerStep } from './generated/runner-step.ts';

const sharp = sharedRequire()('sharp') as typeof import('sharp').default;

import { PORT, WAIT_MS, HEARTBEAT_SECONDS } from './protocol.ts';
import type { ProgressState, StepKind } from './protocol.ts';
import type { Progress as ProgressDocument } from './generated/progress.ts';
import type { RunnerRecordResponse } from './generated/runner-record-response.ts';
import type { CoverArgs, TemplateArgs } from './figma/payload-types.ts';
export { PORT, WAIT_MS, HEARTBEAT_SECONDS } from './protocol.ts';
export const ORIGIN = 'null'; // a Figma plugin's fetch comes from a sandboxed iframe with an opaque origin
export { TOKEN_FILE };
export const PID_FILE = 'runner.pid';
export const SEEN_FILE = 'runner-seen';
export const PROGRESS_FILE = 'progress.json';
export const SERVER_LOG = 'runner-server.log';
export const HANDSHAKE_REQUEST = 'handshake-request.json';
export const HANDSHAKE = 'handshake.json';
export const CHECK_STEP = 'preflight:check';
export const PAGE_STEP = 'preflight:page';
export const COVER_STEP = 'preflight:cover';
export const HANDSHAKE_STEPS: readonly string[] = [CHECK_STEP, PAGE_STEP, COVER_STEP];
export const FIGMA_IMAGE_LIMIT = 4096; // figma.createImage refuses an image larger than this on either side

/** First, which file is open and whether it is empty or holds only this run's initial Cover. Writes nothing. */
export const CHECK_CODE = `
const expected = __EXPECTED__;
const pages = figma.root.children;
let empty = false, preflightCover = false;
if (pages.length === 1) {
  await pages[0].loadAsync();
  const kids = pages[0].children;
  empty = kids.length === 0;
  preflightCover = !empty && pages[0].id === expected
    && kids.every((n) => n.getSharedPluginData('designlab', 'role') === 'cover');
}
// What Figma can draw with here: the font picker's own list (local, shared and Google fonts).
const fonts = {};
for (const f of await figma.listAvailableFontsAsync()) (fonts[f.fontName.family] ||= []).push(f.fontName.style);
return { fileKey: figma.fileKey, fileName: figma.root.name, pages: pages.length, empty, preflightCover, fonts };
`;
/** Second, the file's first page becomes the Cover page, keyed as pages.js keys it. */
export const PAGE_CODE = `
const page = figma.root.children[0];
await page.loadAsync();
page.name = 'Cover';
page.setSharedPluginData('designlab', 'page', 'Cover');
return { pageId: page.id };
`;

/** The person's own design-lab folder and the port to serve; tests point both somewhere private. */
export interface RunnerContext {
  home: string;
  port: number;
}
export { designLabHome };
export const defaultContext = (): RunnerContext => ({ home: designLabHome(), port: PORT });
/** What the command line reports and exits with (baseline's SystemExit). */
export class RunnerExit extends Error {}

type Json = Record<string, unknown>;
type Step = RunnerStep;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const repr = (value: unknown): string =>
  typeof value === 'string'
    ? `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
    : value === undefined || value === null
      ? 'None'
      : String(value);
export const utcNow = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
const localNow = (): string => {
  const d = new Date(),
    p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
/** baseline's json.dumps(value, indent=1/2, sort_keys=?) for the files its readers already parse. */
const pyJson = (value: unknown, indent: number, sortKeys = false): string =>
  ascii(JSON.stringify(sortKeys ? sorted(value) : value, null, indent));
const readJson = (path: string): Json => JSON.parse(readFileSync(path, 'utf8')) as Json;
const byName = ([a]: [string, unknown], [b]: [string, unknown]): number => (a < b ? -1 : a > b ? 1 : 0);

export function figmaDir(project: string): string {
  const folder = resolve(project, 'figma');
  mkdirSync(folder, { recursive: true });
  return folder;
}
let tempCounter = 0;
/** Replace a file whole so a reader polling it never sees half of it; an unchanged file is left alone. */
export function writeAtomic(path: string, content: string): void {
  try {
    if (readFileSync(path, 'utf8') === content) return;
  } catch {
    /* not there yet */
  }
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${tempCounter++}`);
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

/** The person's runner token, created once (folder mode 700, file mode 600), never printed or logged. */
export function personToken(ctx: RunnerContext = defaultContext()): string {
  mkdirSync(ctx.home, { recursive: true, mode: 0o700 });
  chmodSync(ctx.home, 0o700);
  const path = resolve(ctx.home, TOKEN_FILE);
  if (!existsSync(path) || !readFileSync(path, 'utf8').trim())
    writeFileSync(path, randomBytes(16).toString('base64url') + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
  return readFileSync(path, 'utf8').trim();
}
const tokenMatches = (given: string, token: string): boolean =>
  timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(token).digest());

export function pluginVersion(): string {
  const manifest = resolve(pluginRoot, '.claude-plugin/plugin.json');
  return existsSync(manifest) ? (text(readJson(manifest)['version']) ?? '0') : '0';
}
export function versionTuple(value: string | null | undefined): number[] {
  const parts = String(value).split('.');
  return parts.every((part) => /^\s*[+-]?\d+\s*$/.test(part)) ? parts.map(Number) : [];
}
/** baseline's tuple ordering: a shorter prefix is the lesser. */
function tupleLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return a.length < b.length;
}
export const outdated = (runnerVersion: string | null | undefined, current = pluginVersion()): boolean =>
  tupleLess(versionTuple(runnerVersion), versionTuple(current));
export const outdatedMessage = (version: string): string =>
  `Close the design-lab runner in Figma and start it again; it was updated to ${version} and Figma loads the new code when it starts. If it still says this after a restart, Figma is loading the runner from another folder: import ~/.design-lab/runner/manifest.json again (Plugins, Development, Import plugin from manifest).`;

/**
 * Copy the runner into DESIGN_LAB_HOME/runner/, the stable folder Figma desktop imports it from
 * once. `code.js` is stripped from runner/code.ts and carries this plugin's version, which it sends
 * with every request.
 */
export function installRunner(ctx: RunnerContext = defaultContext()): {
  folder: string;
  manifest: string;
  version: string;
  firstInstall: boolean;
  updated: boolean;
} {
  const target = resolve(ctx.home, 'runner'),
    source = resolve(pluginRoot, 'runner'),
    first = !existsSync(resolve(target, 'manifest.json'));
  mkdirSync(target, { recursive: true });
  const version = pluginVersion(),
    files = readdirSync(source).sort();
  let changed = false;
  for (const name of files) {
    const out = name === 'code.ts' ? 'code.js' : name;
    if (!/\.(json|js|html|ts)$/.test(name) || (name.endsWith('.ts') && name !== 'code.ts')) continue;
    let content = readFileSync(resolve(source, name), 'utf8');
    if (name === 'code.ts') content = stripTemplate(content);
    if (out === 'code.js')
      content = content
        .replace("const RUNNER_VERSION = 'source';", () => `const RUNNER_VERSION = '${version}';`)
        .replace(
          "const TOKEN_PATH = '~/.design-lab/runner-token';",
          () => `const TOKEN_PATH = ${JSON.stringify(resolve(ctx.home, TOKEN_FILE))};`,
        );
    const path = resolve(target, out);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
      writeFileSync(path, content);
      changed = true;
    }
  }
  return {
    folder: target,
    manifest: resolve(target, 'manifest.json'),
    version,
    firstInstall: first,
    updated: changed && !first,
  };
}

export function writeHandshake(project: string, result: Json): void {
  const folder = figmaDir(project);
  writeFileSync(resolve(folder, HANDSHAKE), pyJson({ at: utcNow(), ...result }, 1) + '\n');
  try {
    unlinkSync(resolve(folder, HANDSHAKE_REQUEST));
  } catch {
    /* already withdrawn */
  }
}
/** Judge the check step: the target file, and empty or holding only this run's initial Cover. */
export function checkOutcome(target: string | null, result: Json): Json {
  const outcome: Json = {
    runnerConnected: true,
    fileKey: result['fileKey'] ?? null,
    fileName: result['fileName'] ?? null,
    fonts: result['fonts'] ?? null,
    fileKeyMatches: (result['fileKey'] ?? null) === target,
    empty: !!(result['empty'] || result['preflightCover']),
    onlyPreflightCover: !!result['preflightCover'],
  };
  let failure: string | null = null;
  if (!outcome['fileKeyMatches'])
    failure = `the runner is open in a different file (${repr(result['fileName'])}, key ${repr(result['fileKey'])}); open the target file (key ${target}) in Figma desktop and start the runner there`;
  else if (!outcome['empty'])
    failure = `the target file ${repr(result['fileName'])} is not empty (${result['pages']} page(s), or content on its first page that this run's connection check did not draw); give the run a new, empty Figma file`;
  return { ...outcome, ok: failure === null, ...(failure ? { failure } : {}) };
}
export function handshakeRequest(project: string): Json {
  const path = resolve(project, 'figma', HANDSHAKE_REQUEST);
  return existsSync(path) ? readJson(path) : {};
}
/** The name-only Cover's arguments when the workflow did not provide them. */
export const defaultCover = (): Omit<CoverArgs, 'pageId'> => ({
  ground: '#001B67',
  headline: 'Library',
  subtitle: 'Component Library',
  provenance: { stage: 'connect' },
  version: '',
});
/** Ask the server to run the handshake the next time the runner asks for a step. */
export function requestHandshake(
  project: string,
  cover: Omit<CoverArgs, 'pageId'> | null = null,
  expectedCoverPage: string | null = null,
  connectionOnly = false,
): void {
  const folder = figmaDir(project);
  try {
    unlinkSync(resolve(folder, HANDSHAKE));
  } catch {
    /* none yet */
  }
  writeFileSync(
    resolve(folder, HANDSHAKE_REQUEST),
    JSON.stringify({
      requestedAt: utcNow(),
      stage: 'check',
      expectedCoverPageId: expectedCoverPage,
      connectionOnly,
      cover: cover ?? defaultCover(),
    }) + '\n',
  );
}
/** The handshake's outcome, or a timeout failure; the request is withdrawn either way. */
export async function waitForHandshake(project: string, timeoutSeconds: number, pollSeconds = 1): Promise<Handshake> {
  const folder = figmaDir(project),
    deadline = performance.now() + timeoutSeconds * 1000;
  for (;;) {
    if (existsSync(resolve(folder, HANDSHAKE)))
      return JSON.parse(readFileSync(resolve(folder, HANDSHAKE), 'utf8')) as Handshake;
    if (performance.now() >= deadline) {
      try {
        unlinkSync(resolve(folder, HANDSHAKE_REQUEST));
      } catch {
        /* already gone */
      }
      return {
        at: utcNow(),
        runnerConnected: false,
        ok: false,
        failure: `no runner connected within ${timeoutSeconds} seconds; open the target file in Figma desktop, start the design-lab runner (Plugins, Development, design-lab runner), and run connect again`,
      };
    }
    await new Promise((done) => setTimeout(done, pollSeconds * 1000));
  }
}

/** A full-page capture is often taller than Figma accepts, so it is scaled down; the node it fills keeps its size. */
export async function fitFigmaImage(path: string): Promise<Buffer> {
  const data = readFileSync(path);
  if (!/\.(png|jpe?g|webp)$/i.test(path)) return data;
  const meta = await sharp(data).metadata(),
    width = meta.width ?? 0,
    height = meta.height ?? 0;
  if (Math.max(width, height) <= FIGMA_IMAGE_LIMIT) return data;
  const scale = FIGMA_IMAGE_LIMIT / Math.max(width, height);
  return sharp(data)
    .resize(Math.max(1, Math.trunc(width * scale)), Math.max(1, Math.trunc(height * scale)), {
      fit: 'fill',
      kernel: 'lanczos3',
    })
    .toFormat((meta.format ?? 'png') as 'png' | 'jpeg' | 'webp')
    .toBuffer();
}

/** The Figma-side snippets: the TypeScript templates, stripped to plain JavaScript with the shared cache prepended. */
const snippets = new Map<string, { source: string; body: string }>();
export function snippet(name: Extract<keyof TemplateArgs, `figma_dump_${string}`>): string {
  const path = resolve(pluginRoot, 'templates/figma', name + '.ts'),
    source = readFileSync(path, 'utf8');
  const cache = new Renderer().units.get('_cache') ?? '',
    key = source + cache,
    cached = snippets.get(path);
  if (cached?.source === key) return cached.body;
  const body = cache + '\n' + stripTemplate(source);
  snippets.set(path, { source: key, body });
  return body;
}
const fill = (code: string, placeholder: string, value: string): string => code.split(placeholder).join(value);

/** One run's server-side work is serial: a file is driven by one request at a time. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export interface DriverLike {
  next(): Promise<RunnerStep>;
  record(step: string, data?: BuildResult): Promise<{ recorded: string; remaining: number }>;
  recordScreenshot(step: string, data: unknown): Promise<{ recorded: string; remaining: number }>;
}
export interface BuildOptions {
  /** Replace the in-process driver (tests). */
  driver?: DriverLike;
  driverOptions?: DriverOptions;
  /** Print each log line to stdout as well as runner.log; the foreground server does. */
  echo?: boolean;
}
interface WorkIdentity {
  step: string;
  generation: string;
  stepToken: string;
  client: string;
}
type RecordResponse = RunnerRecordResponse;
interface WorkAck {
  digest: string;
  out: RecordResponse;
  client: string;
  step: string;
}
interface WorkLedger {
  generation: string;
  active?: {
    step: Step;
    token: string;
    client: string;
    intent?: { digest: string; result: Json; out?: RecordResponse };
  };
  completed: Record<string, WorkAck>;
}
class WorkConflict extends Error {
  status = 409;
}
interface Progress {
  state: ProgressState;
  stepsDone: number | null;
  stepsTotal: number | null;
  step: string | null;
  stepKind: StepKind | null;
  message: string | null;
}
const wait = (message: string): Step => ({ kind: 'wait', step: 'wait', retryMs: WAIT_MS, message });

/** One workspace: its current step, its failure latch and its progress. Requests are serialized by `lock`. */
export class Build {
  readonly project: string;
  readonly lock = new Mutex();
  current: Step | null = null;
  /** The step that last failed and the state it failed under: not served again until a new init rewrites state.json. */
  failed: { step: string; stamp: number } | null = null;
  progress: Progress = {
    state: 'waiting',
    stepsDone: null,
    stepsTotal: null,
    step: null,
    stepKind: null,
    message: null,
  };
  /** The build state when a connection check last succeeded: a build already complete then is not the one being planned. */
  connectedStamp: number | null = null;
  private readonly options: BuildOptions;
  private live: BuildDriver | undefined;
  private liveRuntime: unknown;
  private stateCache: { stamp: string; state: Json } | undefined;
  constructor(project: string, options: BuildOptions = {}) {
    this.project = resolve(project);
    this.options = options;
  }

  private get statePath(): string {
    return resolve(this.project, 'figma/state.json');
  }
  stateExists(): boolean {
    return existsSync(this.statePath);
  }
  stateStamp(): number {
    return this.stateExists() ? statSync(this.statePath).mtimeMs : 0;
  }
  get state(): Json {
    const s = statSync(this.statePath),
      stamp = `${s.mtimeMs}:${s.size}:${s.ino}`;
    if (this.stateCache?.stamp !== stamp) this.stateCache = { stamp, state: readJson(this.statePath) };
    return this.stateCache.state;
  }
  private get workPath(): string {
    return resolve(figmaDir(this.project), 'runner-work.json');
  }
  private generation(): string {
    const state = this.stateExists() ? this.state : {};
    const handshake = this.handshakePending() ? handshakeRequest(this.project)['requestedAt'] : null;
    return createHash('sha256')
      .update(JSON.stringify([this.key, state['buildId'] ?? [state['runtime'], state['steps']], handshake]))
      .digest('hex');
  }
  private work(): WorkLedger {
    const generation = this.generation();
    const saved = existsSync(this.workPath) ? (readJson(this.workPath) as unknown as WorkLedger) : undefined;
    if (saved?.generation === generation) return saved;
    this.current = null;
    this.failed = null;
    const ledger: WorkLedger = { generation, completed: {} };
    this.saveWork(ledger);
    return ledger;
  }
  private saveWork(ledger: WorkLedger): void {
    writeAtomic(this.workPath, JSON.stringify(ledger) + '\n');
  }
  validateWork(identity: WorkIdentity, allowCompleted = false): WorkLedger {
    const ledger = this.work(),
      active = ledger.active,
      ack = ledger.completed[identity.stepToken];
    if (
      identity.generation !== ledger.generation ||
      !identity.stepToken ||
      !(
        (active?.token === identity.stepToken &&
          active.client === identity.client &&
          active.step.step === identity.step) ||
        (allowCompleted && ack?.client === identity.client && ack.step === identity.step)
      )
    )
      throw new WorkConflict('stale or unissued generation/session/step token');
    if (active?.token === identity.stepToken) this.current = active.step;
    return ledger;
  }
  async issue(client: string): Promise<Step> {
    const ledger = this.work();
    if (ledger.active) return wait('A runner is executing the issued step.');
    const step = await this.next();
    if (ledger.generation !== this.generation()) throw new WorkConflict('build changed while issuing work');
    if (['done', 'wait'].includes(step.kind)) return step;
    const token = randomBytes(24).toString('base64url');
    ledger.active = { step: this.current!, token, client };
    this.saveWork(ledger);
    return { ...step, generation: ledger.generation, stepToken: token };
  }
  async recordWork(identity: WorkIdentity, result: Json): Promise<RecordResponse> {
    const ledger = this.validateWork(identity, true);
    const timing = result['__designLabTiming'];
    if (
      timing !== undefined &&
      (!isObject(timing) ||
        typeof timing['durationMs'] !== 'number' ||
        !Number.isFinite(timing['durationMs']) ||
        timing['durationMs'] < 0)
    )
      throw new Error('invalid step durationMs');
    if (timing !== undefined && !isObject(result['result'])) throw new Error('the timed result must be a JSON object');
    // Timing is transport metadata. A retry of the same result may report a different duration.
    const actual = result['__designLabTiming'] === undefined ? result : result['result'];
    const digest = createHash('sha256')
      .update(JSON.stringify(sorted(actual)))
      .digest('hex');
    const ack = ledger.completed[identity.stepToken];
    if (ack) {
      if (ack.digest !== digest) throw new WorkConflict('record retry has a different result digest');
      return ack.out;
    }
    const active = ledger.active!;
    if (active.intent && active.intent.digest !== digest)
      throw new WorkConflict('record retry has a different result digest');
    // Journal before commit. A restart after state commit recovers the acknowledgement.
    const committed =
      active.intent &&
      this.stateExists() &&
      Array.isArray(this.state['done']) &&
      this.state['done'].includes(identity.step);
    let out: RecordResponse;
    if (committed)
      out = active.intent!.out ?? {
        recorded: identity.step,
        remaining: (this.state['steps'] as unknown[]).length - (this.state['done'] as unknown[]).length,
      };
    else {
      active.intent = { digest, result };
      this.saveWork(ledger);
      try {
        out = await this.record(identity.step, result);
      } catch (error) {
        // Validation failed before commit: the client may correct its result under this token.
        if (!this.stateExists() || !(this.state['done'] as string[] | undefined)?.includes(identity.step)) {
          delete active.intent;
          this.saveWork(ledger);
        }
        throw error;
      }
      if (ledger.generation !== this.generation() && active.step.kind !== 'check')
        throw new WorkConflict('build changed while recording work');
    }
    ledger.completed[identity.stepToken] = { digest, out, client: identity.client, step: identity.step };
    delete ledger.active;
    this.current = null;
    this.saveWork(ledger);
    return out;
  }
  releaseWork(identity: WorkIdentity): void {
    const ledger = this.validateWork(identity);
    delete ledger.active;
    this.saveWork(ledger);
  }

  /** The target file: the build's, once init has run, else the run's target. */
  get key(): string | null {
    if (this.stateExists()) return text(this.state['fileKey']);
    const manifest = resolve(this.project, 'project.json');
    return existsSync(manifest) ? text((readJson(manifest)['target'] as Json | undefined)?.['figmaFileKey']) : null;
  }
  /** A state file that names its file but has no steps yet: nothing to build. */
  private unplanned(): boolean {
    return !this.stateExists() || (!!this.state['fileKey'] && !('steps' in this.state));
  }
  handshakePending(): boolean {
    return existsSync(resolve(this.project, 'figma', HANDSHAKE_REQUEST));
  }

  /** The driver follows a new init (a changed runtime) by rebuilding its renderer. */
  private driver(): DriverLike {
    if (this.options.driver) return this.options.driver;
    const runtime = this.stateExists() ? this.state['runtime'] : null;
    if (!this.live || runtime !== this.liveRuntime) {
      this.live = new BuildDriver(this.project, { runner: true, ...this.options.driverOptions });
      this.liveRuntime = runtime;
    }
    return this.live;
  }
  log(line: string): void {
    appendFileSync(resolve(figmaDir(this.project), 'runner.log'), `${localNow()} ${line}\n`);
    if (this.options.echo !== false) console.log(`[${basename(this.project)}] ${line}`);
  }
  private timing(step: string, ms: number): void {
    if (this.options.driverOptions?.timings === false) return;
    appendFileSync(
      resolve(figmaDir(this.project), 'timings.jsonl'),
      JSON.stringify({ step, phase: 'figma', ms }) + '\n',
    );
  }

  /** Keep what the runner was just told: waiting, a preflight check, a build step with its count, a dump, or done. */
  note(step: Json): void {
    const kind = text(step['kind']),
      p = this.progress;
    if (kind === 'wait')
      Object.assign(p, {
        state: this.failed ? 'failed' : 'waiting',
        step: null,
        stepKind: null,
        message: text(step['message']),
      });
    else if (kind === 'done')
      Object.assign(p, { state: 'done', step: null, stepKind: null, message: null, stepsDone: p.stepsTotal });
    else if (kind === 'check' || kind === 'dump')
      Object.assign(p, {
        state: kind === 'check' ? 'preflight' : 'building',
        step: text(step['step']),
        stepKind: kind,
        message: null,
      });
    else
      Object.assign(p, {
        state: 'building',
        step: text(step['step']),
        stepKind: kind,
        message: null,
        stepsDone: typeof step['done'] === 'number' ? step['done'] : null,
        stepsTotal: typeof step['total'] === 'number' ? step['total'] : null,
      });
  }
  noteRecorded(out: RecordResponse): void {
    const p = this.progress;
    if (p.state === 'failed')
      Object.assign(p, { state: p.stepKind === 'check' ? 'preflight' : 'building', message: null });
    if (typeof out['remaining'] === 'number' && p.stepsTotal !== null) p.stepsDone = p.stepsTotal - out['remaining'];
  }
  writeProgress(inflight: boolean): void {
    const folder = figmaDir(this.project);
    let lastSeen: string | null = null;
    try {
      lastSeen = readFileSync(resolve(folder, SEEN_FILE), 'utf8').trim() || null;
    } catch {
      /* never asked */
    }
    const document: ProgressDocument = { ...this.progress, inflight, lastSeen, at: utcNow(), serverPid: process.pid };
    writeAtomic(resolve(folder, PROGRESS_FILE), pyJson(document, 1) + '\n');
  }

  async next(): Promise<Step> {
    if (this.handshakePending()) {
      this.current = this.handshakeStep();
      this.log(`serving ${this.current.step}`);
      return this.current;
    }
    if (this.failed && this.failed.stamp === this.stateStamp()) {
      this.current = null;
      return wait(`Stopped at ${this.failed.step}. Waiting for a fix.`);
    }
    this.failed = null;
    // Nothing to build yet: the plugin stays open, shows it is connected, and asks again.
    if (this.unplanned()) return wait('Connected. Waiting for the build to start.');
    let step: Step;
    for (;;) {
      try {
        step = await this.driver().next();
      } catch (error) {
        if (!/renderer changed/.test(String((error as Error).message)) || !this.state['iterate']) throw error;
        // Templates edited mid-build: an iterating run waits for the next init rather than closing the runner.
        this.current = null;
        return wait('The templates changed during the build. Waiting for the next build.');
      }
      if (step.kind !== 'skip') break;
      await this.driver().record(step.step!);
      this.log(`skipped ${step.step}: ${text(step['reason']) ?? ''}`);
    }
    if (step.kind === 'done' && this.connectedStamp === this.stateStamp()) {
      this.current = null;
      return wait('Connected. Waiting for the build to start.');
    }
    if (step.kind === 'done') {
      step = this.dumpStep() ?? step;
      if (step.kind === 'done' && this.state['iterate']) {
        this.current = null;
        return wait('Build complete. Waiting for the next build.');
      }
      const buildId = text(this.state['buildId']) || text(this.state['runtime']);
      if (step.kind === 'dump' && buildId !== null) step.buildId = buildId;
      this.current = step;
      if (step.kind === 'dump') this.log(`serving ${step.step}`);
      return step;
    }
    const state = this.state;
    Object.assign(step, {
      done: (state['done'] as unknown[]).length,
      total: (state['steps'] as unknown[]).length,
      buildId: state['buildId'] || state['runtime'],
    });
    this.current = step;
    this.log(`serving ${step.step} (${(step['done'] as number) + 1}/${step['total']})`);
    if (step.kind === 'use_figma') {
      const { payload, ...rest } = step;
      return { ...rest, code: readFileSync(String(payload), 'utf8') };
    }
    if (step.kind === 'upload') {
      const { files: _files, ...rest } = step;
      return rest;
    }
    return step;
  }

  /** After the build, export each page's node tree for run-to-run comparison, then the read-only state verification needs. */
  dumpStep(): Extract<Step, { kind: 'dump' }> | null {
    const results = resolve(this.project, 'figma/results');
    if (!existsSync(resolve(results, 'pages.json'))) return null; // nothing was built, so there is nothing to dump
    const pages = Object.entries(readJson(resolve(results, 'pages.json'))['pages'] as Record<string, string>).sort(
      byName,
    );
    // Mutating executions advance revision even when write-on-change preserves result mtimes.
    // Older builds without revisions retain the original freshness rule until their next mutation.
    const built = Math.max(
      0,
      ...readdirSync(results)
        .filter((n) => n.endsWith('.json'))
        .map((n) => statSync(resolve(results, n)).mtimeMs),
    );
    const revision = this.state['executionRevision'];
    const stale = (target: string): boolean =>
      !existsSync(target) ||
      (revision
        ? !existsSync(target + '.revision') || readJson(target + '.revision')['revision'] !== revision
        : statSync(target).mtimeMs < built);
    const out = resolve(this.project, 'figma/dump'),
      safe = (name: string) => name.replaceAll('/', '-');
    // Full tree dumps take minutes on large tier pages; an iterating build keeps only the light verification dumps.
    for (const [name, id] of this.state['iterate'] ? [] : pages) {
      const target = resolve(out, `${safe(name)}.json`);
      if (stale(target))
        return {
          kind: 'dump',
          step: `dump:${name}`,
          code: fill(snippet('figma_dump_tree'), '__PAGE_ID__', id),
          out: target,
        };
    }
    const verify = resolve(this.project, 'figma/verify'),
      wanted: [string, string, () => string][] = [
        ['verify:root', resolve(verify, 'root.json'), () => snippet('figma_dump_root')],
      ];
    for (const [name, id] of pages)
      wanted.push([
        `verify:page:${name}`,
        resolve(verify, `page-${safe(name)}.json`),
        () => fill(snippet('figma_dump_page'), 'PAGE_ID', id),
      ]);
    const started = pages.find(([name]) => name === 'Getting Started')?.[1];
    if (started)
      wanted.push([
        'verify:getting-started',
        resolve(verify, 'getting-started.json'),
        () => fill(snippet('figma_dump_getting_started'), 'PAGE_ID', started),
      ]);
    for (const [step, target, code] of wanted)
      if (stale(target)) return { kind: 'dump', step, code: code(), out: target };
    return null;
  }

  /** The next connection step: check the file, claim its first page as the Cover page, draw the name-only Cover. */
  handshakeStep(): Step {
    const request = handshakeRequest(this.project),
      stage = text(request['stage']) ?? 'check';
    if (stage === 'check')
      return {
        kind: 'check',
        step: CHECK_STEP,
        code: fill(CHECK_CODE, '__EXPECTED__', JSON.stringify(request['expectedCoverPageId'] ?? null)),
      };
    if (stage === 'page') return { kind: 'check', step: PAGE_STEP, code: PAGE_CODE };
    const cover = isObject(request['cover']) ? request['cover'] : defaultCover();
    const pageId = text(request['pageId']),
      ground = text(cover.ground),
      headline = text(cover.headline);
    if (pageId === null || ground === null || headline === null)
      throw new Error('invalid handshake cover: pageId, ground and headline must be strings');
    const total = cover.total;
    const isCoverTotal = (value: unknown): value is { label: string; value: string | number } =>
      isObject(value) &&
      typeof value['label'] === 'string' &&
      (typeof value['value'] === 'string' || typeof value['value'] === 'number');
    if (total !== undefined && !isCoverTotal(total))
      throw new Error('invalid handshake cover: total needs a string label and string or numeric value');
    const args: CoverArgs = {
      pageId,
      ground,
      headline,
      tiers: [],
      ...(isCoverTotal(total) ? { total: { label: total.label, value: total.value } } : {}),
      ...(typeof cover.subtitle === 'string' ? { subtitle: cover.subtitle } : {}),
      ...(typeof cover.version === 'string' ? { version: cover.version } : {}),
      ...(isObject(cover.provenance) ? { provenance: cover.provenance } : {}),
    };

    return { kind: 'check', step: COVER_STEP, code: callPayload('cover', args) };
  }

  handshakeRecord(step: string, result: Json): RecordResponse {
    const request = handshakeRequest(this.project),
      path = resolve(this.project, 'figma', HANDSHAKE_REQUEST);
    if (!existsSync(path)) {
      // Preflight stopped waiting and withdrew its request; nobody wants this answer now.
      this.current = null;
      this.log(`ignored ${step}: preflight is no longer waiting for it`);
      return { recorded: step, ignored: true };
    }
    let outcome: Json;
    if (step === CHECK_STEP) {
      const errors = validateRunnerRecord('check', result);
      if (errors.length) throw new Error(`${step}: invalid check result:\n${errors.join('\n')}`);
      outcome = checkOutcome(this.key, result);
      if (request['connectionOnly'] && outcome['fileKeyMatches']) {
        // The build has begun in this file, so it is no longer empty: prove only that the runner is connected to it.
        outcome = { ...outcome, ok: true, connectionOnly: true };
        delete outcome['failure'];
        writeHandshake(this.project, outcome);
      } else if (!outcome['ok']) writeHandshake(this.project, outcome);
      else writeFileSync(path, JSON.stringify({ ...request, stage: 'page', check: outcome }) + '\n');
    } else if (step === PAGE_STEP) {
      if (typeof result['pageId'] !== 'string') throw new Error(`${step}: the result has no pageId`);
      writeFileSync(path, JSON.stringify({ ...request, stage: 'cover', pageId: result['pageId'] }) + '\n');
      outcome = { ok: true };
    } else {
      outcome = {
        ...(isObject(request['check']) ? request['check'] : {}),
        ok: !!result['coverId'] && !!result['pluginData'],
        writable: !!result['coverId'],
        coverPageId: result['pageId'] || request['pageId'],
        coverId: result['coverId'],
        font: result['font'],
        fontLoaded: !!result['fontLoaded'],
        pluginData: !!result['pluginData'],
      };
      if (!outcome['ok'])
        outcome['failure'] =
          "the name-only Cover was drawn but its plugin data did not read back; the file may not accept design-lab's data";
      writeHandshake(this.project, outcome);
    }
    this.current = null;
    if (outcome['ok'] && !this.handshakePending()) this.connectedStamp = this.stateStamp();
    this.log(`recorded ${step}: ${outcome['ok'] ? 'ok' : outcome['failure']}`);
    return { recorded: step };
  }
  /** A connection step failed in Figma: stop the handshake with the exact cause. */
  handshakeError(message: string): void {
    const what: Record<string, string> = {
      [CHECK_STEP]: 'the target file could not be inspected',
      [PAGE_STEP]: 'the Cover page could not be created',
      [COVER_STEP]: 'the name-only Cover could not be drawn',
    };
    writeHandshake(this.project, {
      runnerConnected: true,
      ok: false,
      writable: false,
      failure: `${what[this.current?.step ?? ''] ?? 'the preflight check failed'}: ${message}`,
    });
    this.current = null;
  }

  /** After a server restart, the step the plugin is finishing is still the build's next one. */
  async resume(step: string): Promise<Step | null> {
    if (this.unplanned()) return null;
    let pending: Step;
    try {
      pending = await this.driver().next();
    } catch {
      return null;
    }
    if (pending.step === step && pending.kind !== 'skip' && pending.kind !== 'done') this.current = pending;
    else if (pending.kind === 'done') {
      const dump = this.dumpStep();
      if (dump?.step === step) this.current = dump;
    }
    return this.current;
  }
  async file(step: string, i: number): Promise<{ data: Buffer; contentType: string }> {
    const cur = this.current;
    if (!cur || cur.step !== step || cur.kind !== 'upload') throw new Error(`${step} is not the current upload step`);
    const f = (cur['files'] as { file: string; contentType: string }[] | undefined)?.at(i);
    if (!f) throw new Error(`${step} has no file ${i}`);
    return { data: await fitFigmaImage(f.file), contentType: f.contentType };
  }

  async record(step: string, result: Json): Promise<RecordResponse> {
    const timing = result['__designLabTiming'];
    if (timing === undefined) return this.recordStep(step, result);
    const duration = isObject(timing) ? timing['durationMs'] : undefined;
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)
      throw new Error('invalid step durationMs');
    if (!isObject(result['result'])) throw new Error('the timed result must be a JSON object');
    const out = await this.recordStep(step, result['result']);
    this.timing(step, duration);
    return out;
  }
  private async recordStep(step: string, result: Json): Promise<RecordResponse> {
    let cur = this.current;
    if ((!cur || cur.step !== step) && !HANDSHAKE_STEPS.includes(step)) cur = await this.resume(step); // a restarted server lost the step it served
    if (!cur || cur.step !== step) throw new Error(`${step} is not the current step`);
    if (cur.kind === 'check') return this.handshakeRecord(step, result);
    if (cur.kind === 'dump') {
      const kind: DumpKind =
        step === 'verify:root'
          ? 'root'
          : step === 'verify:getting-started'
            ? 'getting-started'
            : step.startsWith('verify:page:')
              ? 'page'
              : 'tree';
      const errors = validateRunnerRecord('dump', result, kind);
      if (errors.length) throw new Error(`${step}: invalid ${kind} dump:\n${errors.join('\n')}`);
      const target = String(cur['out']);
      mkdirSync(dirname(target), { recursive: true });
      writeAtomic(target, pyJson(result, 1, true) + '\n');
      writeAtomic(target + '.revision', JSON.stringify({ revision: this.state['executionRevision'] }) + '\n');
      this.current = null;
      this.log(`recorded ${step}`); // revision tracks execution even when result JSON stays identical
      return { recorded: step };
    }
    const out: RecordResponse =
      cur.kind === 'screenshot'
        ? await this.driver().recordScreenshot(step, result)
        : await this.driver().record(step, result as BuildResult);
    this.current = null;
    this.log(`recorded ${step} (${out['remaining']} remaining)`);
    return out;
  }
}

export function findBuild(builds: Map<string, Build>, key: string): Build | undefined {
  return [...builds.values()].find((b) => b.key === key);
}
/** The one run this server serves, by its target file key; a second run is refused. */
export function loadBuilds(projects: string[], options: BuildOptions = {}): Map<string, Build> {
  const runs = [...new Set(projects.map((p) => resolve(p)))].sort();
  if (runs.length !== 1)
    throw new RunnerExit(
      `one run at a time: a runner server serves exactly one run; finish or stop the other before starting it (${runs.join(', ')})`,
    );
  const build = new Build(runs[0]!, options);
  if (!build.key)
    throw new RunnerExit(`${build.project} has no target Figma file yet; record it with workflow.ts preflight`);
  return new Map([[build.key, build]]);
}

export interface RunnerServer {
  server: http.Server;
  /** The heartbeat: rewrite every run's progress, requests or not. */
  pulse(): void;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}
export interface ServerOptions {
  ctx?: RunnerContext;
  version?: string;
}
export function makeServer(builds: Map<string, Build>, token: string, options: ServerOptions = {}): RunnerServer {
  const ctx = options.ctx ?? defaultContext(),
    current = options.version ?? pluginVersion();
  // A slow step (an image fetch can take minutes) is the runner working, not absent, so /health reports it.
  const activity = { inflight: 0 };
  const seen = (build: Build): void => {
    writeAtomic(resolve(figmaDir(build.project), SEEN_FILE), utcNow() + '\n');
    build.writeProgress(activity.inflight > 0);
  };
  const pulse = (): void => {
    for (const build of builds.values()) build.writeProgress(activity.inflight > 0);
  };
  const reply = (res: http.ServerResponse, status: number, body: Buffer | string, type = 'application/json'): void => {
    const data = typeof body === 'string' ? Buffer.from(body) : body;
    res.writeHead(status, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Access-Control-Allow-Origin': ORIGIN,
    });
    res.end(data);
  };
  const rejectHandshakes = (failure: (b: Build) => Json, only?: (b: Build) => boolean): void => {
    for (const b of builds.values())
      if (b.handshakePending() && (only?.(b) ?? true))
        writeHandshake(b.project, { runnerConnected: true, ok: false, ...failure(b) });
  };
  const readBody = async (req: http.IncomingMessage): Promise<Json> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8'),
      body: unknown = raw === '' ? {} : JSON.parse(raw);
    if (!isObject(body)) throw new Error('the request body must be a JSON object');
    return body;
  };
  async function serve(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    build: Build,
    path: string,
    q: Record<string, string>,
  ): Promise<void> {
    try {
      const need = (name: string): string => {
        const v = q[name];
        if (v === undefined) throw new Error(`missing query parameter ${name}`);
        return v;
      };
      if (build.key !== q['fileKey']) {
        req.resume();
        return reply(res, 404, 'build retargeted', 'text/plain');
      }
      const body = req.method === 'POST' ? await readBody(req) : null;
      const identity = (): WorkIdentity => ({
        step: need('step'),
        generation: need('generation'),
        stepToken: need('stepToken'),
        client: need('client'),
      });
      if (req.method === 'GET' && path === '/next') {
        seen(build);
        const step = await build.issue(need('client'));
        build.note(step);
        return reply(res, 200, JSON.stringify(step));
      }
      if (req.method === 'GET' && path === '/file') {
        build.validateWork(identity());
        seen(build);
        const index = need('i').trim();
        if (!/^[+-]?\d+$/.test(index)) throw new Error('invalid file index');
        const f = await build.file(need('step'), Number(index));
        return reply(res, 200, f.data, f.contentType);
      }
      if (req.method === 'POST' && path === '/record') {
        const out = await build.recordWork(identity(), body!);
        seen(build);
        build.noteRecorded(out);
        return reply(res, 200, JSON.stringify(out));
      }
      if (req.method === 'GET' && path === '/heartbeat') {
        build.validateWork(identity());
        seen(build);
        return reply(res, 200, '{}');
      }
      if (req.method === 'POST' && path === '/error') {
        const work = identity();
        build.validateWork(work);
        seen(build);
        if (body!['step'] !== work.step) throw new WorkConflict('error step does not match issued work');
        const message = String(body!['message'] ?? JSON.stringify(body)),
          step = text(body!['step']);
        build.log(`FAILED ${message}`);
        build.progress.state = 'failed';
        build.progress.message = message;
        if (step && !step.startsWith('preflight')) build.failed = { step, stamp: build.stateStamp() };
        build.releaseWork(work);
        if (build.current?.kind === 'check' && build.handshakePending()) build.handshakeError(message);
        build.current = null;
        return reply(res, 200, '{}');
      }
      return reply(res, 404, 'unknown route', 'text/plain');
    } catch (error) {
      // reported to the plugin, which stops without recording
      if (error instanceof WorkConflict) return reply(res, 409, error.message, 'text/plain');
      const message = (error as Error).message;
      build.log(`error: ${message}`);
      Object.assign(build.progress, { state: 'failed', message });
      return reply(res, 500, message, 'text/plain');
    }
  }
  async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1'),
      q: Record<string, string> = {};
    for (const [k, v] of url.searchParams) if (v !== '' && !(k in q)) q[k] = v; // first value, blanks dropped, as parse_qs does
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== ORIGIN) {
      req.resume();
      return reply(res, 403, `origin ${origin} is not a Figma plugin`, 'text/plain');
    }
    if (!tokenMatches(q['token'] ?? '', token)) {
      req.resume(); // a handshake in progress reports the rejected token
      rejectHandshakes(
        () => ({
          fileKey: q['fileKey'],
          failure: `Paste your runner token into the runner when it asks (copy it with: pbcopy < ${resolve(ctx.home, TOKEN_FILE)}), then run connect again; the runner's saved token was rejected`,
        }),
        (b) => [b.key, undefined, ''].includes(q['fileKey']),
      );
      return reply(
        res,
        401,
        `the runner token was rejected; paste the one in ${resolve(ctx.home, TOKEN_FILE)}`,
        'text/plain',
      );
    }
    if (url.pathname !== '/health' && outdated(q['version'], current)) {
      req.resume();
      const message = outdatedMessage(current);
      rejectHandshakes(() => ({ outdated: true, runnerVersion: q['version'], failure: message }));
      return reply(res, 426, JSON.stringify({ outdated: true, version: current, message }));
    }
    if (url.pathname === '/health') {
      return reply(
        res,
        200,
        JSON.stringify({
          pid: process.pid,
          projects: [...builds.values()].map((b) => b.project),
          files: [...builds.values()].map((b) => b.key),
          inflight: activity.inflight > 0,
        }),
      );
    }
    const build = findBuild(builds, q['fileKey'] ?? '');
    if (!build) {
      // the runner was started in a file that is not the target
      req.resume();
      rejectHandshakes((b) => ({
        fileKey: q['fileKey'],
        fileKeyMatches: false,
        failure: `the runner is open in a different file (key ${q['fileKey']}); open the target file (key ${b.key}) in Figma desktop and start the runner there`,
      }));
      return reply(
        res,
        404,
        `no build for file ${repr(q['fileKey'] ?? '')}; serving [${[...builds.values()]
          .map((b) => b.key ?? '?')
          .sort()
          .map(repr)
          .join(', ')}]`,
        'text/plain',
      );
    }
    activity.inflight++; // slow server-side work is visible while valid clients renew lastSeen
    try {
      await build.lock.run(() => serve(req, res, build, url.pathname, q));
    } finally {
      activity.inflight--;
      build.writeProgress(activity.inflight > 0);
    }
  }
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      // preflight, in case a client sends a non-simple request
      res.writeHead(204, {
        'Access-Control-Allow-Origin': ORIGIN,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      req.resume();
      return reply(res, 501, 'unsupported method', 'text/plain');
    }
    route(req, res).catch((error) => {
      if (!res.headersSent) reply(res, 500, (error as Error).message, 'text/plain');
      else res.destroy();
    });
  });
  let timer: NodeJS.Timeout | undefined;
  return {
    server,
    pulse,
    listen: (port) =>
      new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(port ?? ctx.port, '127.0.0.1', () => {
          timer = setInterval(pulse, HEARTBEAT_SECONDS * 1000);
          done((server.address() as net.AddressInfo).port);
        });
      }),
    close: () =>
      new Promise((done) => {
        clearInterval(timer);
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}

/** What the server on 127.0.0.1 answers to /health with this token, if one does. */
export async function health(
  token: string,
  ctx: RunnerContext = defaultContext(),
  timeoutMs = 2000,
): Promise<Json | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${ctx.port}/health?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? ((await res.json()) as Json) : null;
  } catch {
    return null;
  }
}
export function portInUse(ctx: RunnerContext = defaultContext()): Promise<boolean> {
  return new Promise((done) => {
    const socket = net.connect({ port: ctx.port, host: '127.0.0.1' });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
  });
}
export interface ServerStatus {
  alive: boolean;
  pid: number | null;
  portInUse: boolean;
  inflight: boolean;
  otherRun: string | null;
  otherPid: number | null;
  log: string;
}
/** Whether a server is alive and serving this run, from its answer; and if another run's server holds the port, which. */
export async function serverStatus(project: string, ctx: RunnerContext = defaultContext()): Promise<ServerStatus> {
  project = resolve(project);
  const folder = resolve(project, 'figma'),
    pidFile = resolve(folder, PID_FILE),
    tokenFile = resolve(ctx.home, TOKEN_FILE);
  const pid = existsSync(pidFile) ? Number.parseInt(readFileSync(pidFile, 'utf8'), 10) : null,
    answer = existsSync(tokenFile) ? await health(readFileSync(tokenFile, 'utf8').trim(), ctx) : null;
  const projects = (answer?.['projects'] as string[] | undefined) ?? [],
    serving = !!answer && projects.includes(project),
    other = projects.filter((p) => p !== project);
  return {
    alive: serving,
    pid: (answer?.['pid'] as number | undefined) ?? pid,
    portInUse: serving || !!answer || (await portInUse(ctx)),
    inflight: serving && !!answer?.['inflight'],
    otherRun: other.length && !serving ? other[0]! : null,
    otherPid: other.length ? ((answer?.['pid'] as number | undefined) ?? null) : null,
    log: resolve(folder, SERVER_LOG),
  };
}
/** Whether a run's build has every step recorded. */
export function runFinished(project: string): boolean {
  try {
    const state = readJson(resolve(project, 'figma/state.json')),
      done = new Set((state['done'] as string[]) ?? []);
    return ((state['steps'] as { id: string }[] | undefined) ?? []).every((s) => done.has(s.id));
  } catch {
    return false;
  }
}
export async function stopServer(
  project: string,
  ctx: RunnerContext = defaultContext(),
): Promise<{ stopped: boolean; pid: number | null }> {
  const status = await serverStatus(project, ctx);
  if (status.alive && status.pid) process.kill(Number(status.pid), 'SIGTERM');
  return { stopped: status.alive, pid: status.pid };
}

const scriptPath = fileURLToPath(import.meta.url);
export interface EnsureDeps {
  serverStatus: typeof serverStatus;
  stopServer: typeof stopServer;
  portInUse: typeof portInUse;
  /** Start the detached server; returns its process id and whether it already exited. */
  spawnServer(project: string, log: number): { pid: number; exited(): boolean };
}
const realDeps: EnsureDeps = {
  serverStatus,
  stopServer,
  portInUse,
  spawnServer(project, log) {
    let done = false;
    const child = spawn(process.execPath, [scriptPath, 'serve', '--project', project], {
      stdio: ['ignore', log, log],
      detached: true,
    });
    child.once('exit', () => {
      done = true;
    });
    child.unref();
    return { pid: child.pid!, exited: () => done };
  },
};
/** Reuse the server serving this run, or start one detached; its pid is in figma/runner.pid and its output in figma/runner-server.log. */
export async function ensureServer(
  project: string,
  waitSeconds = 10,
  ctx: RunnerContext = defaultContext(),
  deps: Partial<EnsureDeps> = {},
): Promise<ServerStatus & { install: ReturnType<typeof installRunner>; started: boolean }> {
  const d = { ...realDeps, ...deps };
  project = resolve(project);
  personToken(ctx);
  // The runner Figma loads must match this plugin's version, or it is told to restart and closes.
  const install = installRunner(ctx);
  if (install.updated)
    console.error(
      `the runner was updated to ${install.version}: close the design-lab runner in Figma and start it again`,
    );
  let status = await d.serverStatus(project, ctx);
  if (status.alive) return { ...status, install, started: false };
  if (status.otherRun && runFinished(status.otherRun)) {
    // that run's build has every step recorded: its server was only left behind
    await d.stopServer(status.otherRun, ctx);
    console.error(`stopped the runner server of a finished run: ${status.otherRun}`);
    for (let i = 0; i < 50 && (await d.portInUse(ctx)); i++) await new Promise((done) => setTimeout(done, 100));
    status = await d.serverStatus(project, ctx);
    if (status.alive) return { ...status, install, started: false };
  }
  if (status.otherRun)
    throw new Error(
      `another run is active: ${status.otherRun} (server process ${status.otherPid}). design-lab builds one library at a time, for the best results in Figma desktop; stop it first with: node ${scriptPath} stop --project ${status.otherRun}`,
    );
  if (status.portInUse)
    throw new Error(`127.0.0.1:${ctx.port} is in use by another program; stop it, then run connect again`);
  const folder = figmaDir(project),
    logPath = resolve(folder, SERVER_LOG),
    log = openSync(logPath, 'a', 0o600);
  chmodSync(logPath, 0o600);
  let child: ReturnType<EnsureDeps['spawnServer']>;
  try {
    child = d.spawnServer(project, log);
  } finally {
    closeSync(log);
  }
  writeFileSync(resolve(folder, PID_FILE), `${child.pid}\n`);
  const deadline = performance.now() + waitSeconds * 1000;
  while (performance.now() < deadline) {
    if (child.exited()) throw new Error(`the runner server exited at once; see ${logPath}`);
    const now = await d.serverStatus(project, ctx);
    if (now.alive) return { ...now, install, started: true };
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`the runner server did not answer within ${waitSeconds} seconds; see ${logPath}`);
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const usage = 'usage: figma-runner.ts {serve --project W [--project W ...] | start|status|stop --project W}';
  const cmd = args[0],
    projects: string[] = [],
    extra: string[] = [];
  let servePort = PORT;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1] !== undefined) projects.push(args[++i]!);
    else if (cmd === 'serve' && args[i] === '--port' && args[i + 1] !== undefined) {
      servePort = Number(args[++i]);
      if (servePort !== 0) {
        console.error(usage + '\nerror: unrecognized port; --port 0 is reserved for an isolated smoke');
        return 2;
      }
    } else extra.push(args[i]!);
  }
  if (
    !['serve', 'start', 'status', 'stop'].includes(cmd ?? '') ||
    !projects.length ||
    extra.length ||
    (cmd !== 'serve' && projects.length > 1)
  ) {
    console.error(extra.length ? `${usage}\nerror: unrecognized arguments: ${extra.join(' ')}` : usage);
    return 2;
  }
  const ctx = { ...defaultContext(), ...(cmd === 'serve' ? { port: servePort } : {}) },
    print = (value: unknown): void => console.log(pyJson(value, 2));
  try {
    if (cmd === 'stop') {
      print(await stopServer(projects[0]!, ctx));
      return 0;
    }
    if (cmd === 'status') {
      print(await serverStatus(projects[0]!, ctx));
      return 0;
    }
    if (cmd === 'start') {
      try {
        print(await ensureServer(projects[0]!, 10, ctx));
      } catch (error) {
        console.error(`error: ${(error as Error).message}`);
        return 1;
      }
      return 0;
    }
    const builds = loadBuilds(projects, { echo: true });
    for (const [key, b] of builds) console.log(`serving ${b.project} for file ${key}`);
    const token = personToken(ctx); // never printed: the person copies it from the file once per machine
    console.log(`runner token: in ${resolve(ctx.home, TOKEN_FILE)}`);
    const runner = makeServer(builds, token, { ctx });
    const port = await runner.listen();
    console.log(`runner listening on 127.0.0.1:${port}`);
    runner.pulse();
    await new Promise(() => undefined); // serve until killed
  } catch (error) {
    if (error instanceof RunnerExit) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
  return 0;
}
if (isEntrypoint(import.meta.url)) process.exitCode = await main();
