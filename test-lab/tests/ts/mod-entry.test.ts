// The mod's runner (src/mod-entry.ts) through its real process boundary: where it keeps operations, what
// operation folders and requests it accepts, that a request it can't serve ends as a failed status and
// a stop asked for before the run ends as a cancelled one, never a verdict. The release package is
// built from the sources, ships no node_modules, and runs from a physically separate folder once its
// kit holds the pinned parser, so a missing runtime dependency is caught as such. The real npm install
// step is tests/install. Runs that reach Playwright are in tests/playwright/mod-entry.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp } from './support.ts';
import { writeRequest } from './mod-request.ts';
import { operationDirProblem } from '../../src/mod-entry.ts';
import { shippedFiles, stagePlugin } from '../../scripts/stage-plugin.ts';
import { buildRelease, nodeModulesIn, releaseFiles, releaseProblem } from '../../scripts/build-release.ts';
import { stageParser } from '../../scripts/stage-parser.ts';

const ENTRY = join(import.meta.dirname, '../../src/mod-entry.ts');

function harness() {
  const data = realpathSync(tmp('test-lab-mod-data-'));
  const sessions = join(data, 'mod', 'sessions');
  const operation = (name = 'op-1') => {
    const dir = join(sessions, 'session-a', name);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  const run = (args: string[], entry = ENTRY) => spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', env: { ...process.env, TEST_LAB_DATA: data }, timeout: 60_000 });
  /** Runs a request the way the mod does: request.json first, then the matching argv. */
  const request = (dir: string, cli: string[], deadline = 60_000, entry = ENTRY) => {
    writeRequest(dir, cli, deadline);
    return run(['--operation-dir', dir, '--deadline-ms', String(deadline), '--', ...cli], entry);
  };
  const status = (dir: string) => JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8'));
  return { data, sessions, operation, run, request, status, cleanup: () => rmSync(data, { recursive: true, force: true }) };
}

test('the runner names its sessions folder from test-lab\'s data folder and says its runtime is present', () => {
  const h = harness();
  try {
    const r = h.run(['--data-dir']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { sessions: h.sessions, node: process.versions.node, runtime: { ok: true } });
  } finally {
    h.cleanup();
  }
});

test('the runner accepts only a fresh operation folder two levels under its sessions folder', () => {
  const h = harness();
  try {
    const good = h.operation();
    assert.equal(operationDirProblem(good, h.sessions), null);
    writeFileSync(join(good, 'request.json'), '{}');
    writeFileSync(join(good, 'inputs.json'), '{}');
    writeFileSync(join(good, 'cancel'), 'stop\n');
    assert.equal(operationDirProblem(good, h.sessions), null);
    const outside = tmp('test-lab-mod-outside-');
    assert.match(String(operationDirProblem(outside, h.sessions)), /not a mod session folder/);
    mkdirSync(join(h.sessions, 'shallow'), { recursive: true });
    assert.match(String(operationDirProblem(join(h.sessions, 'shallow'), h.sessions)), /not a mod session folder/);
    const used = h.operation('op-used');
    writeFileSync(join(used, 'status.json'), '{}');
    assert.match(String(operationDirProblem(used, h.sessions)), /already used/);
    const odd = h.operation('op-odd');
    writeFileSync(join(odd, 'verdict.json'), '{}');
    assert.match(String(operationDirProblem(odd, h.sessions)), /unexpected files/);
    // Refused folders get no status: nothing is written where the runner may not write.
    const r = h.run(['--operation-dir', outside, '--deadline-ms', '60000', '--', 'verify']);
    assert.equal(r.status, 4);
    assert.equal(existsSync(join(outside, 'status.json')), false);
    rmSync(outside, { recursive: true, force: true });
  } finally {
    h.cleanup();
  }
});

test('the runner speaks only for the request its folder holds: another argv, deadline or folder gets no status', () => {
  const h = harness();
  try {
    const cli = ['verify', '--app-root', '/a', '--suite-root', '/b', '--env', 'local'];
    const none = h.operation('op-none');
    assert.equal(h.run(['--operation-dir', none, '--deadline-ms', '60000', '--', ...cli]).stderr.trim(), 'the operation folder holds no readable request');
    const argv = h.operation('op-argv');
    writeRequest(argv, cli, 60_000);
    assert.equal(h.run(['--operation-dir', argv, '--deadline-ms', '60000', '--', ...cli.slice(0, -1), 'stage']).stderr.trim(), 'the runner\'s arguments are not the ones the operation requested');
    assert.equal(h.run(['--operation-dir', argv, '--deadline-ms', '61000', '--', ...cli]).stderr.trim(), 'the runner\'s arguments are not the ones the operation requested');
    const moved = h.operation('op-moved');
    writeFileSync(join(moved, 'request.json'), readFileSync(join(argv, 'request.json')));
    assert.equal(h.run(['--operation-dir', moved, '--deadline-ms', '60000', '--', ...cli]).stderr.trim(), 'the operation request is for another operation folder');
    for (const dir of [none, argv, moved]) assert.equal(existsSync(join(dir, 'status.json')), false);
  } finally {
    h.cleanup();
  }
});

test('a request the CLI refuses ends as a failed status for that operation, never a verdict', () => {
  const h = harness();
  try {
    const dir = h.operation();
    const r = h.request(dir, ['run', '--app-root', '/nowhere', '--env', 'local']);
    assert.equal(r.status, 4);
    const s = h.status(dir);
    assert.equal(s.schema, 3);
    assert.equal(s.operationId, 'op-1');
    assert.equal(s.state, 'failed');
    assert.equal(s.error, '--suite-root is required');
    assert.equal(s.result, null);
    assert.equal(s.runDir, null);
  } finally {
    h.cleanup();
  }
});

test('a stop asked for before the runner starts ends as cancelled: nothing runs and no verdict is claimed', () => {
  const h = harness();
  try {
    const dir = h.operation();
    writeFileSync(join(dir, 'cancel'), 'stop\n');
    const r = h.request(dir, ['verify', '--app-root', '/a', '--suite-root', '/b', '--env', 'local']);
    assert.equal(r.status, 4);
    const s = h.status(dir);
    assert.equal(s.state, 'cancelled');
    assert.equal(s.stopping, 'requested');
    assert.equal(s.error, 'stopped before the run started; nothing ran');
    assert.equal(s.result, null);
    assert.equal(s.runDir, null);
    const events = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).kind);
    assert.deepEqual(events, ['start', 'cancelled']);
  } finally {
    h.cleanup();
  }
});

test('a deadline the host could not honour is refused before the core starts', () => {
  const h = harness();
  try {
    const dir = h.operation();
    const r = h.request(dir, ['verify', '--app-root', '/a', '--suite-root', '/b', '--env', 'local'], 600_000);
    assert.equal(r.status, 4);
    assert.match(h.status(dir).error, /deadline must be 1000 to 570000 ms/);
  } finally {
    h.cleanup();
  }
});

test('a plain checkout of the plugin carries no node_modules, and the runner names what is missing before anything is recorded', () => {
  const h = harness();
  const bare = tmp('test-lab-shipped-');
  try {
    assert.ok(shippedFiles().includes('src/mod-entry.ts'));
    assert.ok(shippedFiles().includes('kit/source-analysis.ts'));
    assert.equal(shippedFiles().some((f) => f.includes('node_modules')), false);
    stagePlugin(bare, { dependencies: false });
    const probe = JSON.parse(h.run(['--data-dir'], join(bare, 'src/mod-entry.ts')).stdout);
    assert.match(probe.runtime.problem, /^test-lab's runtime parser is not installed in this plugin copy \(.*\)\. Install it once with: node .*\/scripts\/install-runtime\.ts \(npm ci in the copy's kit folder\)\. Nothing was installed\.$/);
    const missing = h.operation('op-bare');
    assert.equal(h.request(missing, ['verify', '--app-root', '/a', '--suite-root', '/b', '--env', 'local'], 60_000, join(bare, 'src/mod-entry.ts')).status, 4);
    assert.match(h.status(missing).error, /runtime parser is not installed in this plugin copy.*Nothing was installed\.$/);
  } finally {
    h.cleanup();
    rmSync(bare, { recursive: true, force: true });
  }
});

test('the release package is built reproducibly with no node_modules, and runs from a physically separate folder once its kit holds the pinned parser', () => {
  const h = harness();
  const built = tmp('test-lab-release-');
  const again = tmp('test-lab-release-again-');
  const isolated = tmp('test-lab-release-isolated-');
  try {
    const manifest = buildRelease(join(built, 'test-lab'));
    assert.equal(buildRelease(join(again, 'test-lab')).digest, manifest.digest, 'two builds of the same inputs differ');
    assert.equal(manifest.parser.version, '6.0.3');
    assert.match(manifest.parser.integrity, /^sha512-/);
    assert.equal(manifest.files.some((f) => f.path.startsWith('tests/')), false);
    assert.equal(manifest.files.some((f) => f.path.includes('node_modules')), false);
    assert.deepEqual(nodeModulesIn(join(built, 'test-lab')), []);
    for (const file of releaseFiles()) assert.ok(manifest.files.some((f) => f.path === file), `${file} is not in the release`);
    // A copy elsewhere, with no link anywhere in it and no checkout above it, is the installed plugin.
    const plugin = join(isolated, 'plugin');
    cpSync(join(built, 'test-lab'), plugin, { recursive: true, verbatimSymlinks: true });
    const links = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); const s = lstatSync(p); return s.isSymbolicLink() ? [p] : s.isDirectory() ? links(p) : []; });
    assert.deepEqual(links(plugin), []);
    assert.equal(releaseProblem(plugin), null);
    assert.match(JSON.parse(h.run(['--data-dir'], join(plugin, 'src/mod-entry.ts')).stdout).runtime.problem, /not installed in this plugin copy/);
    // What the install step leaves behind: the pinned parser in the copy's own kit folder (copied here
    // from this checkout's verified parser; the npm path is tests/install).
    stageParser(join(plugin, 'kit', 'node_modules', 'typescript'));
    assert.match(String(releaseProblem(plugin)), /holds kit\/node_modules/);
    assert.equal(releaseProblem(plugin, { installed: true }), null);
    assert.deepEqual(JSON.parse(h.run(['--data-dir'], join(plugin, 'src/mod-entry.ts')).stdout).runtime, { ok: true });
    // The parser the kit loads is the copy's own, and the whole CLI module graph loads from it.
    const loaded = spawnSync(process.execPath, ['--input-type=module', '-e', "const {createRequire}=await import('node:module');await import(process.argv[1]+'/src/cli.ts');const analysis=(await import(process.argv[1]+'/kit/source-analysis.ts')).ANALYSIS_VERSION;const where=createRequire(process.argv[1]+'/kit/package.json').resolve('typescript');process.stdout.write(JSON.stringify({analysis,where}));", plugin], { encoding: 'utf8', cwd: isolated });
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.ok(JSON.parse(loaded.stdout).where.startsWith(realpathSync(plugin)), loaded.stdout);
    const dir = h.operation('op-release');
    assert.equal(h.request(dir, ['verify', '--app-root', '/a', '--env', 'local'], 60_000, join(plugin, 'src/mod-entry.ts')).status, 4);
    assert.equal(h.status(dir).error, '--suite-root is required');
    // Editing a shipped file is caught against the manifest.
    writeFileSync(join(plugin, 'src/mod-entry.ts'), '// edited\n');
    assert.match(String(releaseProblem(plugin, { installed: true })), /not the ones release\.json lists/);
  } finally {
    h.cleanup();
    for (const dir of [built, again, isolated]) rmSync(dir, { recursive: true, force: true });
  }
});

test('the release build refuses to replace a folder that is not a release', () => {
  const other = tmp('test-lab-not-a-release-');
  try {
    writeFileSync(join(other, 'keep.txt'), 'mine');
    assert.throws(() => buildRelease(other), /exists and is not a test-lab release; it is left alone/);
    assert.equal(readFileSync(join(other, 'keep.txt'), 'utf8'), 'mine');
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});
