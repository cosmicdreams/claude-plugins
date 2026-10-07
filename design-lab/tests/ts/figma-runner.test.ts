import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Build, CHECK_STEP, COVER_STEP, HANDSHAKE, HANDSHAKE_REQUEST, PAGE_STEP, PORT, PROGRESS_FILE, SEEN_FILE, TOKEN_FILE,
  RunnerExit, ensureServer, fitFigmaImage, installRunner, loadBuilds, makeServer, outdated, outdatedMessage, personToken,
  pluginVersion, requestHandshake, waitForHandshake, writeAtomic,
} from '../../src/figma-runner.ts';
import type { DriverLike, EnsureDeps, RunnerContext, ServerStatus } from '../../src/figma-runner.ts';
import { BuildDriver } from '../../src/figma-build.ts';
import { writeOnChange } from '../../src/build-artifacts.ts';
import * as c from '../../src/build-content.ts';
import { spec, node } from './p2-fixtures.ts';
import { sharedRequire } from '../../src/runtime.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
const TOKEN = 'test-token', VERSION = pluginVersion();
type Json = Record<string, unknown>;
type Step = Json & { kind: string; step?: string };
const quiet = { echo: false };

interface Harness { root: string; ctx: RunnerContext; workspace: string; build: Build; port: number; runner: ReturnType<typeof makeServer>; call: Call }
interface Reply { status: number; headers: http.IncomingHttpHeaders; text: string; buffer: Buffer; json(): Json }
type Call = (path: string, options?: { token?: string | null; origin?: string | null; body?: string | Json; key?: string; version?: string | null }) => Promise<Reply>;
/** Everything lives under /tmp; the person's real ~/.design-lab is never read or written. */
const scratch = (t: { after(fn: () => void): void }): string => { const root = mkdtempSync('/tmp/design-lab-runner-'); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const request = (port: number): Call => (path, options = {}) => new Promise((done, fail) => {
  const { token = TOKEN, origin = 'null', body, key = 'KEY', version = VERSION } = options;
  const query = `fileKey=${key}${token === null ? '' : `&token=${token}`}${version === null ? '' : `&version=${version}`}`;
  const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port, path: `${path}${path.includes('?') ? '&' : '?'}${query}`, method: data === undefined ? 'GET' : 'POST', headers: origin === null ? {} : { Origin: origin } }, res => {
    const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => { const buffer = Buffer.concat(chunks), text = buffer.toString('utf8'); done({ status: res.statusCode!, headers: res.headers, text, buffer, json: () => JSON.parse(text) as Json }); });
  });
  req.on('error', fail); req.end(data);
});
function listen(t: { after(fn: () => void): void }, root: string, workspace: string, build: Build, version = VERSION): Promise<Harness> {
  const ctx: RunnerContext = { home: resolve(root, '.design-lab'), port: 0 }, runner = makeServer(new Map([[build.key ?? 'KEY', build]]), TOKEN, { ctx, version });
  return runner.listen(0).then(port => { t.after(() => { void runner.close(); }); return { root, ctx, workspace, build, port, runner, call: request(port) }; });
}
const workspace = (root: string, key: string, state: Json = { fileKey: key }): string => { mkdirSync(resolve(root, 'figma'), { recursive: true }); writeFileSync(resolve(root, 'figma/state.json'), JSON.stringify(state)); return root; };
const preflight = (root: string, key: string): string => { mkdirSync(root, { recursive: true }); writeFileSync(resolve(root, 'project.json'), JSON.stringify({ target: { figmaFileKey: key } })); return root; };
const progress = (ws: string): Json => JSON.parse(readFileSync(resolve(ws, 'figma', PROGRESS_FILE), 'utf8')) as Json;
async function serverFor(t: { after(fn: () => void): void }, make: (root: string) => string, options: { driver?: DriverLike } = {}): Promise<Harness> {
  const root = scratch(t), ws = make(resolve(root, 'w')); return listen(t, root, ws, new Build(ws, { ...quiet, ...options }));
}
/** A scripted stand-in for the in-process driver, for the semantics that do not need real build artifacts. */
function fakeDriver(steps: Json[], recorded: [string, unknown][] = []): DriverLike & { recorded: [string, unknown][] } {
  return { recorded,
    async next() { return (steps.shift() ?? { kind: 'done' }) as never; },
    async record(step, data) { recorded.push([step, data]); return { recorded: step, remaining: 3 }; },
    async recordScreenshot(step, data) { recorded.push([step, data]); return { recorded: step, remaining: 2 }; } };
}
const check = { fileKey: 'KEY', fileName: 'Library', pages: 1, empty: true, preflightCover: false, fonts: {} };

test('requests without the token are refused before touching build state', async t => {
  const h = await serverFor(t, root => workspace(root, 'KEY'));
  for (const token of [null, 'wrong']) { const r = await h.call('/next', { token }); assert.equal(r.status, 401, String(token)); assert.match(r.text, /token/); }
  assert.equal((await h.call('/record?step=pages', { token: null, body: '{}' })).status, 401);
  assert.equal(existsSync(resolve(h.workspace, 'figma/results')), false);
});
test('only the plugin origin is allowed, and the build rejects a step it did not serve', async t => {
  const h = await serverFor(t, root => workspace(root, 'KEY'));
  const bad = await h.call('/next', { origin: 'https://attacker.example' });
  assert.equal(bad.status, 403); assert.equal(bad.headers['access-control-allow-origin'], 'null');
  const ok = await h.call('/record?step=pages', { body: '{}' }); // there is no current step: refused by the build, not the gate
  assert.equal(ok.status, 500); assert.match(ok.text, /not the current step/); assert.equal(ok.headers['access-control-allow-origin'], 'null');
  assert.equal((await h.call('/next', { origin: null })).status, 200); // no Origin header at all (not a browser) is allowed
});
test('malformed or non-object bodies get an error reply and corrupt nothing', async t => {
  const h = await serverFor(t, root => workspace(root, 'KEY'));
  const malformed = await h.call('/record?step=pages', { body: '{not json' }); assert.equal(malformed.status, 500); assert.match(malformed.text, /JSON/);
  for (const body of ['[1, 2]', 'null', '7']) { const r = await h.call('/error', { body }); assert.equal(r.status, 500, body); assert.match(r.text, /JSON object/); }
  assert.equal(progress(h.workspace)['state'], 'failed');
});
test('OPTIONS preflight answers for the plugin origin and other methods are refused', async t => {
  const h = await serverFor(t, root => workspace(root, 'KEY'));
  const res = await new Promise<http.IncomingMessage>(done => http.request({ host: '127.0.0.1', port: h.port, method: 'OPTIONS', path: '/next' }, done).end());
  assert.equal(res.statusCode, 204); assert.equal(res.headers['access-control-allow-origin'], 'null'); assert.match(String(res.headers['access-control-allow-methods']), /POST/); res.resume();
  const put = await new Promise<http.IncomingMessage>(done => http.request({ host: '127.0.0.1', port: h.port, method: 'PUT', path: '/next' }, done).end()); assert.equal(put.statusCode, 501); put.resume();
});
test('a server serves exactly one run', t => {
  const root = scratch(t), a = workspace(resolve(root, 'a'), 'KEYA'), b = workspace(resolve(root, 'b'), 'KEYB');
  assert.throws(() => loadBuilds([a, b]), (e: unknown) => e instanceof RunnerExit && /one run at a time/.test(e.message));
  assert.deepEqual([...loadBuilds([a, a]).keys()], ['KEYA']);
  assert.throws(() => loadBuilds([resolve(root, 'none')]), /no target Figma file/);
});
test('an outdated runner is told to restart, and /health needs no version', async t => {
  const h = await serverFor(t, root => workspace(root, 'KEY'));
  for (const version of [null, '0.1.0', 'source', '']) {
    const r = await h.call('/next', { version }); assert.equal(r.status, 426, String(version));
    assert.deepEqual(r.json(), { outdated: true, version: VERSION, message: outdatedMessage(VERSION) });
  }
  assert.equal(outdated(VERSION), false); assert.equal(outdated('999.0'), false); assert.equal(outdated('0'), true);
  assert.equal((await h.call('/health', { version: null })).status, 200);
});
test('each request notes when the runner last asked, and a request and the heartbeat both write progress', async t => {
  const h = await serverFor(t, root => workspace(root, 'KEY'));
  await h.call('/next'); const folder = resolve(h.workspace, 'figma');
  assert.ok(existsSync(resolve(folder, SEEN_FILE)));
  const deadline = Date.now() + 5000; while (progress(h.workspace)['inflight'] && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  const first = progress(h.workspace); assert.notEqual(first['lastSeen'], null); assert.equal(first['inflight'], false); assert.equal(first['serverPid'], process.pid);
  rmSync(resolve(folder, PROGRESS_FILE)); h.runner.pulse(); assert.equal(progress(h.workspace)['serverPid'], process.pid);
});
test('an unchanged file is not rewritten', t => {
  const root = scratch(t), file = resolve(root, 'f.json'); writeAtomic(file, 'a\n'); const before = statSync(file, { bigint: true });
  writeAtomic(file, 'a\n'); const same = statSync(file, { bigint: true }); assert.equal(same.ino, before.ino); assert.equal(same.mtimeNs, before.mtimeNs);
  writeAtomic(file, 'b\n'); assert.equal(readFileSync(file, 'utf8'), 'b\n');
});

/** The runner waits before the build, and preflight's check proves the target can be written. */
async function handshake(t: { after(fn: () => void): void }) {
  const h = await serverFor(t, root => preflight(root, 'KEY'));
  const step = async (kind = 'check'): Promise<Step> => { const r = await h.call('/next'); const s = r.json() as Step; assert.deepEqual([r.status, s.kind], [200, kind], r.text); return s; };
  const record = async (name: string, result: unknown): Promise<void> => { const r = await h.call(`/record?step=${name}`, { body: result as Json }); assert.equal(r.status, 200, r.text); };
  const run = async (probe: Json = {}, cover: Json | 'error' | null = null, expected: string | null = null): Promise<Json> => {
    requestHandshake(h.workspace, { ground: '#001B67', headline: 'Example', subtitle: 'Component Library', provenance: { stage: 'preflight' }, version: '4.1.0' }, expected);
    const first = await step(); assert.equal(first.step, CHECK_STEP); assert.ok(!String(first['code']).includes('createRectangle'));
    await record(first.step!, { ...check, ...probe });
    if (!existsSync(resolve(h.workspace, 'figma', HANDSHAKE))) {
      const page = await step(); assert.equal(page.step, PAGE_STEP); await record(page.step!, { pageId: '0:1' });
      const draw = await step(); assert.equal(draw.step, COVER_STEP);
      // The real cover template, in its name-only form: the run's name and nothing computed.
      assert.ok(String(draw['code']).includes('"pageId":"0:1"')); assert.ok(String(draw['code']).includes('"tiers":[]')); assert.ok(!String(draw['code']).includes('"total"'));
      assert.match(String(draw['code']), /const nameOnly = !ARGS\.total;/);
      if (cover === 'error') assert.equal((await h.call('/error', { body: { step: draw.step, message: 'IBM Plex Sans could not load and the fallback failed to load: x' } })).status, 200);
      else await record(draw.step!, cover ?? { coverId: '1:2', pageId: '0:1', font: 'IBM Plex Sans', fontLoaded: true, pluginData: true, nameOnly: true });
    }
    return waitForHandshake(h.workspace, 1, 0.05);
  };
  return { ...h, step, record, run };
}
test('the runner waits before there are build steps', async t => {
  const h = await handshake(t), r = await h.call('/next'), step = r.json();
  assert.deepEqual([r.status, step['kind'], step['retryMs'], step['message']], [200, 'wait', 5000, 'Connected. Waiting for the build to start.']);
});
test('the handshake draws a name-only Cover and the runner stays open', async t => {
  const h = await handshake(t), outcome = await h.run();
  assert.equal(outcome['ok'], true); for (const k of ['runnerConnected', 'fileKeyMatches', 'empty', 'writable', 'pluginData']) assert.equal(outcome[k], true, k);
  assert.deepEqual([outcome['coverPageId'], outcome['font'], outcome['fontLoaded']], ['0:1', 'IBM Plex Sans', true]);
  assert.equal(existsSync(resolve(h.workspace, 'figma', HANDSHAKE_REQUEST)), false); assert.equal((await h.step('wait')).kind, 'wait');
});
test('a file holding only this run\'s preflight Cover counts as empty', async t => {
  const outcome = await (await handshake(t)).run({ empty: false, preflightCover: true }, null, '0:1');
  assert.equal(outcome['ok'], true); assert.equal(outcome['onlyPreflightCover'], true);
});
test('a file that is not empty fails', async t => {
  const outcome = await (await handshake(t)).run({ empty: false, pages: 3 }); assert.equal(outcome['ok'], false); assert.match(String(outcome['failure']), /not empty/);
});
test('a Cover that cannot be drawn fails with its cause', async t => {
  const outcome = await (await handshake(t)).run({}, 'error'); assert.equal(outcome['ok'], false);
  assert.ok(String(outcome['failure']).includes('the name-only Cover could not be drawn: IBM Plex Sans could not load and the fallback failed'));
});
test('a page that cannot be created fails', async t => {
  const h = await handshake(t); requestHandshake(h.workspace); await h.record((await h.step()).step!, check);
  const page = await h.step(); await h.call('/error', { body: { step: page.step, message: 'read-only file' } });
  assert.match(String((await waitForHandshake(h.workspace, 1, 0.05))['failure']), /the Cover page could not be created: read-only file/);
});
test('a Cover whose plugin data does not read back fails', async t => {
  const outcome = await (await handshake(t)).run({}, { coverId: '1:2', pageId: '0:1', fontLoaded: false, font: 'Inter', pluginData: false });
  assert.equal(outcome['ok'], false); assert.match(String(outcome['failure']), /plugin data/);
});
test('a different open file fails and the handshake says which', async t => {
  const h = await handshake(t); requestHandshake(h.workspace);
  assert.equal((await h.call('/next', { key: 'OTHER' })).status, 404);
  const outcome = await waitForHandshake(h.workspace, 1, 0.05); assert.equal(outcome['ok'], false); assert.match(String(outcome['failure']), /different file \(key OTHER\)/);
});
test('a rejected token and an outdated runner both fail an open handshake', async t => {
  const h = await handshake(t); requestHandshake(h.workspace); assert.equal((await h.call('/next', { token: 'stale' })).status, 401);
  const rejected = await waitForHandshake(h.workspace, 1, 0.05); assert.equal(rejected['ok'], false); assert.match(String(rejected['failure']), /token was rejected/);
  requestHandshake(h.workspace); assert.equal((await h.call('/next', { version: '0.1.0' })).status, 426);
  const old = await waitForHandshake(h.workspace, 1, 0.05); assert.equal(old['ok'], false); assert.ok(String(old['failure']).startsWith('Close the design-lab runner in Figma and start it again'));
});
test('no runner within the timeout fails and clears its pending request', async t => {
  const h = await handshake(t); requestHandshake(h.workspace);
  const outcome = await waitForHandshake(h.workspace, 0.2, 0.05);
  assert.deepEqual([outcome['ok'], outcome['runnerConnected']], [false, false]); assert.match(String(outcome['failure']), /no runner connected within/);
  assert.equal(existsSync(resolve(h.workspace, 'figma', HANDSHAKE_REQUEST)), false); assert.equal((await h.step('wait')).kind, 'wait');
});
test('the token belongs to the person, not the run', async t => {
  const h = await handshake(t), first = personToken(h.ctx), path = resolve(h.ctx.home, TOKEN_FILE);
  assert.deepEqual([statSync(path).mode & 0o777, statSync(h.ctx.home).mode & 0o777], [0o600, 0o700]);
  assert.equal(personToken(h.ctx), first); assert.equal(existsSync(resolve(h.workspace, 'figma', TOKEN_FILE)), false);
  chmodSync(h.ctx.home, 0o755); writeFileSync(path, '\n'); const fresh = personToken(h.ctx); assert.notEqual(fresh, ''); assert.equal(statSync(h.ctx.home).mode & 0o777, 0o700);
});
test('a check recorded after preflight gave up is ignored', async t => {
  const h = await handshake(t); requestHandshake(h.workspace); const step = await h.step();
  rmSync(resolve(h.workspace, 'figma', HANDSHAKE_REQUEST)); // preflight timed out and withdrew
  await h.record(step.step!, check);
  assert.equal(existsSync(resolve(h.workspace, 'figma', HANDSHAKE_REQUEST)), false); assert.equal((await h.step('wait')).kind, 'wait');
});
test('a resumed build proves only the connection, and still rejects the wrong file', async t => {
  const h = await handshake(t);
  requestHandshake(h.workspace, null, null, true); await h.record((await h.step()).step!, { ...check, fileName: 'F', pages: 9, empty: false });
  const outcome = await waitForHandshake(h.workspace, 1, 0.05); assert.deepEqual([outcome['ok'], outcome['connectionOnly'], outcome['fileKeyMatches']], [true, true, true]);
  requestHandshake(h.workspace, null, null, true); await h.record((await h.step()).step!, { ...check, fileKey: 'OTHER', fileName: 'F' });
  assert.equal((await waitForHandshake(h.workspace, 1, 0.05))['ok'], false);
});
test('a malformed check result is rejected instead of trusted', async t => {
  const h = await handshake(t); requestHandshake(h.workspace); await h.step();
  const r = await h.call(`/record?step=${CHECK_STEP}`, { body: { fileKey: 'KEY' } }); assert.equal(r.status, 500); assert.match(r.text, /invalid check result/);
});

test('an iterating build keeps the runner waiting when done; a plain one is told done', async t => {
  const ws = workspace(resolve(scratch(t), 'w'), 'KEY', { fileKey: 'KEY', steps: [{ id: 'pages' }], done: ['pages'], iterate: true });
  const build = new Build(ws, { ...quiet, driver: fakeDriver([{ kind: 'done' }, { kind: 'done' }]) });
  assert.equal((await build.next()).kind, 'wait');
  writeFileSync(resolve(ws, 'figma/state.json'), JSON.stringify({ fileKey: 'KEY', steps: [{ id: 'pages' }], done: ['pages'] }));
  assert.equal((await build.next()).kind, 'done');
});
test('a renderer edited mid-build makes an iterating run wait instead of closing', async t => {
  const ws = workspace(resolve(scratch(t), 'w'), 'KEY', { fileKey: 'KEY', steps: [{ id: 'pages' }], done: [], iterate: true });
  const driver: DriverLike = { next: () => Promise.reject(new Error('the renderer changed since init')), record: () => Promise.reject(new Error('unused')), recordScreenshot: () => Promise.reject(new Error('unused')) };
  const build = new Build(ws, { ...quiet, driver }); assert.match(String((await build.next())['message']), /templates changed/);
  writeFileSync(resolve(ws, 'figma/state.json'), JSON.stringify({ fileKey: 'KEY', steps: [{ id: 'pages' }], done: [] })); // not iterating: the error surfaces
  await assert.rejects(build.next(), /renderer changed/);
});
test('a slow step is reported in flight, and a skip step is recorded without asking the plugin', async t => {
  const release = Promise.withResolvers<void>(), recorded: [string, unknown][] = [];
  const driver = fakeDriver([], recorded); let calls = 0;
  driver.next = async () => { if (calls++ === 0) return { kind: 'skip', step: 'images:a', reason: 'no images' } as never; await release.promise; return { kind: 'done' } as never; };
  const h = await serverFor(t, root => workspace(root, 'KEY', { fileKey: 'KEY', steps: [{ id: 'images:a' }], done: [] }), { driver });
  const slow = h.call('/next'); let inflight = false;
  for (let i = 0; i < 100 && !inflight; i++) { inflight = !!(await h.call('/health', { version: null })).json()['inflight']; if (!inflight) await new Promise(r => setTimeout(r, 20)); }
  assert.equal(inflight, true); release.resolve(); assert.equal((await slow).status, 200);
  assert.deepEqual(recorded, [['images:a', undefined]]); assert.equal((await h.call('/health', { version: null })).json()['inflight'], false);
});
test('a connection to a finished build waits for the new plan', async t => {
  const ws = workspace(resolve(scratch(t), 'w'), 'KEY'), state = resolve(ws, 'figma/state.json');
  writeFileSync(state, JSON.stringify({ steps: [{ id: 'a' }], done: ['a'] }));
  const build = new Build(ws, { ...quiet, driver: fakeDriver([{ kind: 'done' }, { kind: 'done' }]) }); build.connectedStamp = build.stateStamp(); // the connection check just succeeded
  assert.equal((await build.next()).kind, 'wait', 'an old, finished build must not close the runner');
  writeFileSync(state, JSON.stringify({ steps: [{ id: 'b' }], done: ['b'] })); const later = Date.now() / 1000 + 5; utimesSync(state, later, later);
  assert.equal((await build.next()).kind, 'done', 'a build planned after the connection finishes normally');
});
test('a Figma error publishes the latch and a new server resumes the failed step', async t => {
  const root = scratch(t), ws = workspace(resolve(root, 'w'), 'NEW', { fileKey: 'NEW', steps: [{ id: 'pages' }, { id: 'variables' }], done: ['pages'] });
  const h = await listen(t, root, ws, new Build(ws, { ...quiet, driver: fakeDriver([]) }));
  assert.equal((await h.call('/error', { key: 'NEW', body: { step: 'variables', message: 'font missing' } })).status, 200);
  assert.deepEqual([h.build.progress.state, h.build.progress.message, h.build.failed?.step], ['failed', 'font missing', 'variables']);
  const waiting = await h.call('/next', { key: 'NEW' }); assert.equal(waiting.json()['kind'], 'wait'); assert.match(String(waiting.json()['message']), /Stopped at variables/);
  assert.equal(progress(ws)['state'], 'failed');
  const payload = resolve(ws, 'figma/variables.js'); writeFileSync(payload, '// variables payload'); // a new server starts without the latch
  const resumed = new Build(ws, { ...quiet, driver: fakeDriver([{ kind: 'use_figma', step: 'variables', payload }]) }), step = await resumed.next();
  assert.deepEqual([step.step, step['done'], step['total'], step['code'], 'payload' in step], ['variables', 1, 2, '// variables payload', false]); assert.equal(resumed.failed, null);
});
test('a fix (a new init rewriting state) clears the latch for the same server', async t => {
  const ws = workspace(resolve(scratch(t), 'w'), 'K', { fileKey: 'K', steps: [{ id: 'a' }], done: [] }), payload = resolve(ws, 'figma/a.js'); writeFileSync(payload, 'x');
  const build = new Build(ws, { ...quiet, driver: fakeDriver([{ kind: 'use_figma', step: 'a', payload }]) });
  build.failed = { step: 'a', stamp: build.stateStamp() }; assert.equal((await build.next()).kind, 'wait');
  const later = Date.now() / 1000 + 5; utimesSync(resolve(ws, 'figma/state.json'), later, later); assert.equal((await build.next()).kind, 'use_figma');
});
test('a server exception is structured and recovery clears it', async t => {
  const driver = fakeDriver([]); driver.next = () => Promise.reject(new Error('server exception'));
  const h = await serverFor(t, root => workspace(root, 'KEY', { fileKey: 'KEY', steps: [{ id: 'a' }], done: [] }), { driver });
  const r = await h.call('/next'); assert.deepEqual([r.status, r.text], [500, 'server exception']);
  assert.deepEqual([h.build.progress.state, h.build.progress.message], ['failed', 'server exception']);
  h.build.note({ kind: 'use_figma', step: 'variables', done: 1, total: 2 }); assert.deepEqual([h.build.progress.state, h.build.progress.message], ['building', null]);
});
test('progress counts what the runner was told, keeps the count through dumps and done, and clears failure', t => {
  const ws = workspace(resolve(scratch(t), 'w'), 'KEY'), build = new Build(ws, quiet);
  build.note({ kind: 'use_figma', step: 'component:card', done: 4, total: 10 }); build.noteRecorded({ recorded: 'component:card', remaining: 5 }); build.writeProgress(false);
  const written = progress(ws); assert.deepEqual([written['state'], written['stepsDone'], written['stepsTotal'], written['stepKind'], written['serverPid']], ['building', 5, 10, 'use_figma', process.pid]); assert.ok(written['at']);
  build.note({ kind: 'dump', step: 'dump:Cover' }); assert.deepEqual([build.progress.state, build.progress.stepsTotal], ['building', 10]);
  build.note({ kind: 'done', step: 'done' }); assert.deepEqual([build.progress.state, build.progress.stepsDone], ['done', 10]);
  build.note({ kind: 'wait', step: 'wait', message: 'Build complete. Waiting for the next build.' }); assert.deepEqual([build.progress.state, build.progress.message], ['waiting', 'Build complete. Waiting for the next build.']);
  build.note({ kind: 'check', step: CHECK_STEP }); assert.equal(build.progress.state, 'preflight');
  build.failed = { step: 'v', stamp: 0 }; build.note({ kind: 'wait', message: 'Stopped' }); assert.equal(build.progress.state, 'failed');
  build.failed = null; build.progress.state = 'failed'; build.noteRecorded({ remaining: 8 }); assert.deepEqual([build.progress.state, build.progress.message], ['building', null]);
  writeAtomic(resolve(ws, 'figma', SEEN_FILE), '2026-10-02T09:00:00+00:00\n'); build.writeProgress(true); assert.deepEqual([progress(ws)['lastSeen'], progress(ws)['inflight']], ['2026-10-02T09:00:00+00:00', true]);
});

test('dump steps follow the pages: full trees first, none when iterating, then the verification dumps', async t => {
  const ws = workspace(resolve(scratch(t), 'w'), 'K', { fileKey: 'K', steps: [], done: [] });
  mkdirSync(resolve(ws, 'figma/results'), { recursive: true }); writeFileSync(resolve(ws, 'figma/results/pages.json'), JSON.stringify({ pages: { 'Getting Started': '0:9', Cover: '0:1', 'A/B': '0:2' } }));
  const build = new Build(ws, quiet), first = build.dumpStep()!; assert.deepEqual([first.step, first['out']], ['dump:A/B', resolve(ws, 'figma/dump/A-B.json')]); assert.ok(String(first['code']).includes('0:2'));
  writeFileSync(resolve(ws, 'figma/state.json'), JSON.stringify({ fileKey: 'K', steps: [], done: [], iterate: true }));
  const light = new Build(ws, quiet); assert.equal(light.dumpStep()!.step, 'verify:root');
  const order: string[] = []; for (let i = 0; i < 6; i++) { const s = light.dumpStep(); if (!s) break; order.push(s.step!); mkdirSync(resolve(ws, 'figma/verify'), { recursive: true }); writeFileSync(String(s['out']), '{}'); }
  assert.deepEqual(order, ['verify:root', 'verify:page:A/B', 'verify:page:Cover', 'verify:page:Getting Started', 'verify:getting-started']);
  assert.equal(light.dumpStep(), null); // all current: a dump newer than the newest result is not redone
  const older = Date.now() / 1000 - 3600; utimesSync(resolve(ws, 'figma/verify/root.json'), older, older); assert.equal(light.dumpStep()!.step, 'verify:root'); // an older dump describes a changed file
});
test('a dump is validated by its kind, written sorted, and a restarted server resumes it', async t => {
  const ws = workspace(resolve(scratch(t), 'w'), 'K', { fileKey: 'K', steps: [{ id: 'a' }], done: ['a'], iterate: true }), root = resolve(ws, 'figma/results'); mkdirSync(root, { recursive: true });
  writeFileSync(resolve(root, 'pages.json'), JSON.stringify({ pages: { Cover: '0:1' } }));
  const build = new Build(ws, { ...quiet, driver: fakeDriver([{ kind: 'done' }, { kind: 'done' }]) }), h = await listen(t, scratch(t), ws, build);
  const step = (await h.call('/next', { key: 'K' })).json(); assert.equal(step['step'], 'verify:root');
  const bad = await h.call('/record?step=verify:root', { key: 'K', body: { pages: 'x' } }); assert.equal(bad.status, 500); assert.match(bad.text, /invalid root dump/);
  const ok = await h.call('/record?step=verify:root', { key: 'K', body: { pages: [{ name: 'Cover', id: '0:1' }], collections: [] } }); assert.equal(ok.status, 200);
  assert.equal(readFileSync(resolve(ws, 'figma/verify/root.json'), 'utf8'), '{\n "collections": [],\n "pages": [\n  {\n   "id": "0:1",\n   "name": "Cover"\n  }\n ]\n}\n');
  const fresh = new Build(ws, { ...quiet, driver: fakeDriver([{ kind: 'done' }]) }); // a restart lost current, but the dump is still the next step
  const page = (await new Build(ws, { ...quiet, driver: fakeDriver([{ kind: 'done' }]) }).resume('verify:page:Cover'))!; assert.equal(page.step, 'verify:page:Cover');
  assert.equal(await fresh.resume('nothing'), null);
});
test('a screenshot, a timed result and an upload file travel through the server', async t => {
  const recorded: [string, unknown][] = [], png = resolve(scratch(t), 'wide.png'); await sharp({ create: { width: 5000, height: 40, channels: 3, background: '#fff' } }).png().toFile(png);
  const driver = fakeDriver([{ kind: 'upload', step: 'images:a', nodeIds: ['1:1'], scaleMode: 'FILL', files: [{ file: png, contentType: 'image/png' }] }, { kind: 'screenshot', step: 'compare:a', nodeId: '1:2', maxDimension: 9, out: '/x.png' }], recorded);
  const h = await serverFor(t, root => workspace(root, 'KEY', { fileKey: 'KEY', steps: [{ id: 'images:a' }, { id: 'compare:a' }], done: [] }), { driver });
  const upload = (await h.call('/next')).json(); assert.deepEqual([upload['kind'], upload['done'], upload['total'], 'files' in upload], ['upload', 0, 2, false]);
  const file = await h.call('/file?step=images:a&i=0'); assert.equal(file.status, 200); assert.equal(file.headers['content-type'], 'image/png');
  assert.equal((await sharp(file.buffer).metadata()).width, 4096); // figma.createImage refuses more than 4096 pixels
  assert.equal((await h.call('/file?step=images:a&i=0junk')).status, 500);
  assert.equal((await h.call('/file?step=images:a&i=3')).status, 500); assert.equal((await h.call('/file?step=other&i=0')).status, 500);
  assert.equal((await h.call('/record?step=images:a', { body: { __designLabTiming: { durationMs: 12.5 }, result: { statuses: [200] } } })).status, 200);
  assert.deepEqual(recorded[0], ['images:a', { statuses: [200] }]);
  assert.deepEqual(JSON.parse(readFileSync(resolve(h.workspace, 'figma/timings.jsonl'), 'utf8').trim()), { step: 'images:a', phase: 'figma', ms: 12.5 });
  assert.equal((await h.call('/next')).json()['kind'], 'screenshot');
  assert.equal((await h.call('/record?step=compare:a', { body: { png: 'AAAA' } })).status, 200); assert.deepEqual(recorded[1], ['compare:a', { png: 'AAAA' }]);
  assert.equal((await h.call('/record?step=compare:a', { body: { __designLabTiming: { durationMs: -1 }, result: {} } })).status, 500);
  assert.deepEqual([progress(h.workspace)['state'], progress(h.workspace)['message']], ['failed', 'invalid step durationMs']);
});
test('malformed timed results cannot advance the served step or write non-finite timings', async t => {
  const driver = fakeDriver([{kind:'use_figma',step:'variables',payload:resolve(scratch(t),'payload.js')}]);
  // This tests record admission independently of serving a payload.
  const h = await serverFor(t, root=>workspace(root,'KEY'),{driver});
  for (const body of ['{"__designLabTiming":{"durationMs":1e999},"result":{}}',
    '{"__designLabTiming":{"durationMs":1}}', '{"__designLabTiming":{"durationMs":1},"result":[]}']) {
    assert.equal((await h.call('/record?step=variables',{body})).status,500);
  }
  assert.equal(driver.recorded.length,0);
  assert.equal(existsSync(resolve(h.workspace,'figma/timings.jsonl')),false);
});
test('small images are returned as stored', async t => {
  const png = resolve(scratch(t), 'small.png'); await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toFile(png);
  assert.deepEqual(await fitFigmaImage(png), readFileSync(png)); const svg = resolve(resolve(png, '..'), 'a.svg'); writeFileSync(svg, '<svg/>'); assert.deepEqual(await fitFigmaImage(svg), Buffer.from('<svg/>'));
});

/** A real build over HTTP: the in-process driver serves the pages step, records it, and a restarted server resumes. */
function realBuild(t: { after(fn: () => void): void }) {
  const project = mkdtempSync('/tmp/design-lab-runner-build-'); t.after(() => rmSync(project, { recursive: true, force: true }));
  const component = { id: 'card', label: 'card', sourceRef: 'card.yml', fields: [], slots: [], defects: [], usage: { tier: 'Components — High Use', placements: 60, structuralRefs: 2 } };
  writeOnChange(resolve(project, 'project.json'), { repository: { root: project }, run: { siteLabel: 'Acme' } });
  writeOnChange(resolve(project, 'components.json'), { components: [component] });
  writeOnChange(resolve(project, 'plan.json'), { plans: [{ id: 'card', verdict: 'build', libraryRole: 'component', refuseReason: null, variantAxes: [], properties: [] }] });
  writeOnChange(resolve(project, 'variable-plan.json'), { collections: { Core: { modes: ['Value'], variables: [{ name: 'Color/red', type: 'COLOR', hex: '#f00' }] } } });
  writeOnChange(resolve(project, 'capture/measurements/card.spec.json'), spec({ desktop: [node('/div[0]', 0, 0, 1400, 50)], tablet: [node('/div[0]', 0, 0, 800, 50)], mobile: [node('/div[0]', 0, 0, 375, 50)] }));
  writeOnChange(resolve(project, 'capture-evidence.json'), { captures: { card: { path: '/card', selector: '#card', images: ['Desktop', 'Tablet', 'Mobile'].map((viewport, i) => ({ viewport, file: resolve(project, viewport + '.png'), width: [1400, 800, 375][i], height: 50 })) } } });
  new BuildDriver(project, { runner: true }).init({ fileKey: 'FILE', siteUrl: 'https://local.test', canonicalBaseUrl: 'https://public.test', offlineImages: true });
  return project;
}
test('the real driver serves a step inline, records it with its timing, and a restarted server resumes', async t => {
  const project = realBuild(t), root = scratch(t), h = await listen(t, root, project, new Build(project, quiet));
  const step = (await h.call('/next', { key: 'FILE' })).json();
  const total = (JSON.parse(readFileSync(resolve(project, 'figma/state.json'), 'utf8')) as { steps: unknown[] }).steps.length;
  assert.deepEqual([step['kind'], step['step'], step['done'], step['total'], 'payload' in step], ['use_figma', 'pages', 0, total, false]);
  assert.match(String(step['code']), /^const ARGS = /);
  const bad = await h.call('/record?step=variables', { key: 'FILE', body: {} }); assert.equal(bad.status, 500); assert.match(bad.text, /not the current step|expected to record pages/);
  const pages = { pages: Object.fromEntries(c.pageList(project).map((n, i) => [n, `0:${i + 1}`])), foreign: [] };
  const restarted = await listen(t, scratch(t), project, new Build(project, quiet)); // this server never served `pages`
  const done = await restarted.call('/record?step=pages', { key: 'FILE', body: { __designLabTiming: { durationMs: 7 }, result: pages } });
  assert.equal(done.status, 200, done.text); assert.deepEqual([done.json()['recorded'], done.json()['remaining']], ['pages', total - 1]);
  assert.equal(progress(project)['stepsDone'], null); // nothing was served to this server, so there is no total to count against
  assert.ok(existsSync(resolve(project, 'figma/results/pages.json')));
  const timings = readFileSync(resolve(project, 'figma/timings.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Json);
  assert.ok(timings.some(r => r['step'] === 'pages' && r['phase'] === 'figma' && r['ms'] === 7)); assert.ok(timings.some(r => r['phase'] === 'next') && timings.some(r => r['phase'] === 'record'));
  const next = (await h.call('/next', { key: 'FILE' })).json(); assert.equal(next['step'], 'variables'); assert.equal(next['done'], 1);
  assert.equal(progress(project)['stepsDone'], 1);
});
test('concurrent requests for one run are served one at a time', async t => {
  const order: string[] = [], driver = fakeDriver([]); let calls = 0;
  driver.next = async () => { const n = ++calls; order.push(`start${n}`); await new Promise(r => setTimeout(r, 40)); order.push(`end${n}`); return { kind: 'done' } as never; };
  const h = await serverFor(t, root => workspace(root, 'KEY', { fileKey: 'KEY', steps: [{ id: 'a' }], done: ['a'] }), { driver });
  await Promise.all([h.call('/next'), h.call('/next'), h.call('/next')]);
  assert.deepEqual(order, ['start1', 'end1', 'start2', 'end2', 'start3', 'end3']);
});

/** The install and process-management paths, against a private home and injected process control. */
test('the runner is copied to a stable folder with its version', t => {
  const ctx: RunnerContext = { home: resolve(scratch(t), '.design-lab'), port: 0 }, first = installRunner(ctx), folder = resolve(ctx.home, 'runner');
  assert.deepEqual([first.manifest, first.firstInstall, first.version], [resolve(folder, 'manifest.json'), true, VERSION]);
  const code = readFileSync(resolve(folder, 'code.js'), 'utf8'); assert.ok(code.includes(`const RUNNER_VERSION = '${VERSION}';`)); assert.ok(!code.includes("RUNNER_VERSION = 'source'")); assert.ok(!/\bexport\b|DESIGN_LAB_TEMPLATE/.test(code));
  assert.equal(existsSync(resolve(folder, 'code.ts')), false); assert.deepEqual(JSON.parse(readFileSync(resolve(folder, 'manifest.json'), 'utf8')), JSON.parse(readFileSync(fileURLToPath(new URL('../../runner/manifest.json', import.meta.url)), 'utf8')));
  const again = installRunner(ctx); assert.deepEqual([again.firstInstall, again.updated], [false, false]);
  writeFileSync(resolve(folder, 'code.js'), 'old code'); assert.equal(installRunner(ctx).updated, true); assert.ok(readFileSync(resolve(folder, 'code.js'), 'utf8').includes('RUNNER_VERSION'));
  assert.doesNotThrow(() => new vm.Script(`(async () => {${code}\n})`)); // the emitted plugin code compiles as a function body, unexecuted
});
const status = (over: Partial<ServerStatus>): ServerStatus => ({ alive: false, pid: null, portInUse: false, inflight: false, otherRun: null, otherPid: null, log: '', ...over });
test('preflight stops the server a finished run left behind', async t => {
  const root = scratch(t), ctx: RunnerContext = { home: resolve(root, '.h'), port: 0 }, mine = preflight(resolve(root, 'w'), 'KEY'), finished = preflight(resolve(root, 'done'), 'KEYD');
  mkdirSync(resolve(finished, 'figma')); writeFileSync(resolve(finished, 'figma/state.json'), JSON.stringify({ steps: [{ id: 'pages' }], done: ['pages'] }));
  const answers = [status({ pid: 7, portInUse: true, otherRun: finished, otherPid: 7 }), status({ alive: true, pid: 8, portInUse: true })], stopped: string[] = [];
  const deps: Partial<EnsureDeps> = { serverStatus: async () => answers.shift()!, stopServer: async p => { stopped.push(p); return { stopped: true, pid: 7 }; }, portInUse: async () => false };
  const out = await ensureServer(mine, 1, ctx, deps); assert.equal(out.started, false); assert.deepEqual(stopped, [finished]);
});
test('another active run is refused by name, and a program holding the port is refused', async t => {
  const root = scratch(t), ctx: RunnerContext = { home: resolve(root, '.h'), port: 0 }, mine = preflight(resolve(root, 'w'), 'KEY');
  await assert.rejects(ensureServer(mine, 1, ctx, { serverStatus: async () => status({ portInUse: true, otherRun: '/runs/other', otherPid: 4321 }) }), (e: Error) => /another run is active: \/runs\/other \(server process 4321\)/.test(e.message) && /stop --project \/runs\/other/.test(e.message));
  await assert.rejects(ensureServer(mine, 1, ctx, { serverStatus: async () => status({ portInUse: true }) }), /in use by another program/);
});
test('a server that starts is detected, and one that exits at once is reported', async t => {
  const root = scratch(t), ctx: RunnerContext = { home: resolve(root, '.h'), port: 0 }, mine = preflight(resolve(root, 'w'), 'KEY'); let spawned = 0;
  const alive = await ensureServer(mine, 2, ctx, { serverStatus: async () => status({ alive: spawned > 0 }), spawnServer: () => { spawned++; return { pid: 4242, exited: () => false }; } });
  assert.deepEqual([alive.started, readFileSync(resolve(mine, 'figma/runner.pid'), 'utf8').trim()], [true, '4242']); assert.equal(statSync(resolve(mine, 'figma/runner-server.log')).mode & 0o777, 0o600);
  await assert.rejects(ensureServer(mine, 2, ctx, { serverStatus: async () => status({}), spawnServer: () => ({ pid: 1, exited: () => true }) }), /exited at once/);
});
test('the command line rejects unknown arguments and a fixed port', () => {
  const script = fileURLToPath(new URL('../../src/figma-runner.ts', import.meta.url));
  for (const extra of [['serve', '--project', '/tmp/none', '--port', '9999'], ['bogus'], ['status']]) {
    const done = spawnSync(process.execPath, [script, ...extra], { encoding: 'utf8', timeout: 30000, env: { ...process.env, DESIGN_LAB_HOME: '/tmp/design-lab-runner-cli-home' } });
    assert.equal(done.status, 2, extra.join(' ')); assert.match(done.stderr, /usage|unrecognized/);
  }
  assert.equal(PORT, 8765);
});
