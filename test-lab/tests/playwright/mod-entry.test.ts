// The mod's runner on the generic cross-repository fixture with real Playwright: the verdict it reports is
// the one the core wrote, for the operation that asked, progress names the steps, and Stop or the
// deadline end the run through the coordinator's own interruption path, reaping the owned Playwright
// tree and still writing a verdict.
//
// Each test leaves a diagnostics record in $TMPDIR/test-lab-pw-diagnostics: stage timings with the load
// average, the runner's events, its final status, and the run folder's problems, reasons and invocation
// files. A failing test also keeps a copy of its operation and run folders there, taken before the
// fixture is cleaned up, so a failure in a long gate can be explained afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupCoordinator } from '../fixtures/coordinator.ts';
import { certifyCoordinator } from '../fixtures/coordinator-evidence.ts';
import { coordinate } from '../../src/coordinator.ts';
import { commandAdapter } from '../../src/local-adapter.ts';
import { tmp } from '../ts/support.ts';
import { writeRequest } from '../ts/mod-request.ts';

const ENTRY = join(import.meta.dirname, '../../src/mod-entry.ts');
const DIAGNOSTICS = join(tmpdir(), 'test-lab-pw-diagnostics');
type Fixture = Awaited<ReturnType<typeof setupCoordinator>>;

function start(f: Fixture, data: string, name: string, deadline = 120_000) {
  const dir = join(data, 'mod', 'sessions', 'session-a', name);
  mkdirSync(dir, { recursive: true });
  const cli = ['run', '--app-root', f.app, '--suite-root', f.suite, '--env', 'local', '--no-work', '--adapter', join(f.suite, 'adapter.ts'), '--timeout-ms', String(deadline)];
  writeRequest(dir, cli, deadline);
  const child = spawn(process.execPath, [ENTRY, '--operation-dir', dir, '--deadline-ms', String(deadline), '--', ...cli], { env: { ...process.env, TEST_LAB_DATA: data }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (b) => (stderr += String(b)));
  const steps = new Set<string>();
  const watch = setInterval(() => {
    try {
      const s = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8'));
      if (s.step) steps.add(s.step);
    } catch {
      // Between the first write and the rename there may be no file yet.
    }
  }, 20);
  const exit = new Promise<number | null>((done) => child.on('close', (code) => { clearInterval(watch); done(code); }));
  return { dir, exit, steps, stderr: () => stderr, status: () => JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')) };
}

async function until(check: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((done) => setTimeout(done, 30));
  }
}

const read = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};
const lines = (path: string): unknown[] => (existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/** Stage timings and what the runner and the core left, for one test. */
function recorder(name: string) {
  const begun = Date.now();
  let last = begun;
  const stages: { stage: string; ms: number; atMs: number; load1: number }[] = [];
  const mark = (stage: string) => {
    const now = Date.now();
    stages.push({ stage, ms: now - last, atMs: now - begun, load1: Number(loadavg()[0]!.toFixed(2)) });
    last = now;
  };
  const save = (passed: boolean, run: { dir: string } | null) => {
    mkdirSync(DIAGNOSTICS, { recursive: true });
    const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}`;
    const status = run === null ? null : read(join(run.dir, 'status.json')) as { runDir?: string | null } | null;
    const runDir = status?.runDir ?? null;
    const manifest = runDir === null ? null : read(join(runDir, 'manifest.json')) as { problems?: unknown; invocations?: { id: string; purpose: string; dir: string }[] } | null;
    const verdict = runDir === null ? null : read(join(runDir, 'verdict.json')) as { verdict?: { verdict: string; rule: number; reasons: string[] } } | null;
    const invocations = (manifest?.invocations ?? []).map((i) => ({
      id: i.id,
      purpose: i.purpose,
      files: existsSync(i.dir) ? readdirSync(i.dir).map((f) => ({ f, bytes: statSync(join(i.dir, f)).size, mtime: statSync(join(i.dir, f)).mtime.toISOString() })) : 'missing',
    }));
    const record = { test: name, passed, totalMs: Date.now() - begun, stages, status, events: run === null ? [] : lines(join(run.dir, 'events.jsonl')), problems: manifest?.problems ?? null, verdict: verdict?.verdict ?? null, invocations };
    writeFileSync(join(DIAGNOSTICS, `${stamp}.json`), `${JSON.stringify(record, null, 2)}\n`);
    if (!passed && run !== null) {
      cpSync(run.dir, join(DIAGNOSTICS, stamp, 'operation'), { recursive: true });
      if (runDir !== null && existsSync(runDir)) cpSync(runDir, join(DIAGNOSTICS, stamp, 'run'), { recursive: true });
    }
    return join(DIAGNOSTICS, `${stamp}.json`);
  };
  return { mark, save };
}

test('the runner reports the Ready verdict the core wrote, for its own operation, with its steps, on Playwright 1.60.0', async () => {
  const d = recorder('ready');
  const f = await setupCoordinator('1.60.0');
  d.mark('setup');
  const data = realpathSync(tmp('test-lab-mod-run-'));
  let run: ReturnType<typeof start> | null = null;
  let passed = false;
  try {
    await certifyCoordinator(f, () => coordinate({ operation: 'run', appRoot: f.app, suiteRoot: f.suite, environment: 'local', noWork: true, adapter: commandAdapter(join(f.suite, 'adapter.ts'), f.app) }), d.mark);
    // The product's default budget: this test is about the Ready verdict reaching the pane, not the
    // deadline (its own test below). A 120 s budget failed the loaded full gate once (exit 3 after
    // 1,040 s, against about 22 s for the runner when measured at load 66).
    run = start(f, data, 'op-ready', 540_000);
    const code = await run.exit;
    d.mark('runner');
    const s = run.status();
    // Say why when it isn't Ready: the verdict's own summary, any stop, and the diagnostics record.
    assert.equal(code, 0, JSON.stringify({ stderr: run.stderr(), stopping: s.stopping, summary: s.result?.summary ?? s.error }));
    assert.equal(s.state, 'finished');
    assert.equal(s.operationId, 'op-ready');
    assert.equal(s.result.verdict, 'ready');
    assert.equal(s.result.exitCode, 0);
    assert.ok(s.runDir.startsWith(`${f.suite}/.test-lab/runs/`), s.runDir);
    const written = JSON.parse(readFileSync(join(s.runDir, 'verdict.json'), 'utf8'));
    assert.equal(written.runDir, s.runDir);
    const requested=JSON.parse(readFileSync(join(run.dir,'request.json'),'utf8')).requestIdentity;
    assert.deepEqual(s.requestIdentity,requested);
    assert.deepEqual(written.requestIdentity,requested);
    assert.deepEqual(JSON.parse(readFileSync(join(s.runDir,'manifest.json'),'utf8')).requestIdentity,requested);
    assert.equal(written.verdict.verdict, s.result.verdict);
    assert.equal(written.verdict.rule, s.result.rule);
    assert.equal(written.context.appRoot, realpathSync(f.app));
    assert.equal(written.context.suiteRoot, realpathSync(f.suite));
    assert.ok(run.steps.has('e2e: run'), [...run.steps].join(', '));
    assert.equal(s.stopping, null);
    passed = true;
  } finally {
    const where = d.save(passed, run);
    if (!passed) console.log(`diagnostics: ${where}`);
    await f.cleanup();
    rmSync(data, { recursive: true, force: true });
  }
});

for (const how of ['requested', 'deadline'] as const) {
  test(`a ${how === 'requested' ? 'Stop request' : 'deadline'} ends the run inconclusive, reaps its Playwright tree, and still writes the verdict`, async () => {
    const d = recorder(how);
    const f = await setupCoordinator('1.60.0');
    d.mark('setup');
    const data = realpathSync(tmp('test-lab-mod-stop-'));
    let run: ReturnType<typeof start> | null = null;
    let passed = false;
    try {
      f.state.slow = true;
      run = start(f, data, `op-${how}`, how === 'deadline' ? 12_000 : 120_000);
      if (how === 'requested') {
        await until(() => f.state.bodyRequests > 0, 60_000);
        writeFileSync(join(run.dir, 'cancel'), 'stop\n');
      }
      assert.equal(await run.exit, 3, run.stderr());
      d.mark('runner');
      const s = run.status();
      assert.equal(s.state, 'finished');
      assert.equal(s.stopping, how);
      assert.equal(s.result.verdict, 'inconclusive');
      const manifest = JSON.parse(readFileSync(join(s.runDir, 'manifest.json'), 'utf8'));
      assert.ok(manifest.problems.some((p: string) => /operation interrupted/.test(p)), JSON.stringify(manifest.problems));
      assert.ok(existsSync(join(s.runDir, 'verdict.json')));
      // Nothing of the run is left requesting pages once the runner has exited.
      const seen = f.state.httpRequests;
      await new Promise((done) => setTimeout(done, 1_500));
      assert.equal(f.state.httpRequests, seen);
      passed = true;
    } finally {
      const where = d.save(passed, run);
      if (!passed) console.log(`diagnostics: ${where}`);
      await f.cleanup();
      rmSync(data, { recursive: true, force: true });
    }
  });
}
