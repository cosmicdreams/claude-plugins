import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { pluginRoot, completionMarker } from '../../src/runtime.ts';

function fixture() {
  const dir = mkdtempSync(resolve(tmpdir(), 'design-lab-setup-'));
  const copy = resolve(dir, 'plugin'); mkdirSync(copy);
  for (const name of ['src/runtime.ts', 'scripts/setup-ts.ts', 'package.json', 'package-lock.json']) {
    cpSync(resolve(pluginRoot, name), resolve(copy, name), { recursive: true });
  }
  const bin = resolve(dir, 'bin'); mkdirSync(bin);
  const calls = resolve(dir, 'calls');
  writeFileSync(resolve(bin, 'npm'), `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
appendFileSync(process.env.FAKE_CALLS, JSON.stringify({ pid: process.pid, cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');
mkdirSync('node_modules');
writeFileSync('node_modules/development-package', 'installed');
setTimeout(() => process.exit(process.env.FAKE_FAIL ? 2 : 0), process.env.FAKE_PAUSE ? 10000 : 250);
`, { mode: 0o755 });
  const env = { ...process.env, DESIGN_LAB_CACHE: resolve(dir, 'cache'), PATH: `${bin}:${process.env['PATH']}`, FAKE_CALLS: calls };
  const locate = spawnSync(process.execPath, ['--input-type=module', '-e', `import { dependencyFolder } from ${JSON.stringify(resolve(copy, 'src/runtime.ts'))}; console.log(dependencyFolder());`], { env, encoding: 'utf8' });
  assert.equal(locate.status, 0, locate.stderr);
  const folder = locate.stdout.trim();
  const children: ChildProcess[] = [];
  return {
    dir, copy, folder, calls, env,
    start(extra: Record<string, string> = {}, args: string[] = []) {
      const child = spawn(process.execPath, [resolve(copy, 'scripts/setup-ts.ts'), ...args], { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      let output = ''; child.stdout!.on('data', data => { output += String(data); }); child.stderr!.on('data', data => { output += String(data); });
      const done = new Promise<{ status: number | null; output: string }>((done, reject) => {
        child.once('error', reject); child.once('close', status => done({ status, output }));
      });
      return { child, done };
    },
    cleanup() {
      for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for test installer');
    await setTimeout(20);
  }
}

test('two setup processes publish one complete install; reuse and production never mutate it', { timeout: 15_000 }, async () => {
  const f = fixture();
  try {
    const first = f.start();
    await until(() => existsSync(f.calls));
    const second = f.start({}, ['--production']);
    for (const result of await Promise.all([first.done, second.done])) assert.equal(result.status, 0, result.output);
    assert.ok(existsSync(resolve(f.folder, completionMarker)));
    assert.equal(existsSync(`${f.folder}.lock`), false);
    const marker = statSync(resolve(f.folder, completionMarker));
    const markerBytes = readFileSync(resolve(f.folder, completionMarker));
    const reused = await f.start({}, ['--production']).done;
    assert.equal(reused.status, 0, reused.output);
    const after = statSync(resolve(f.folder, completionMarker));
    // Reading the readiness marker can update atime. Reuse must preserve its
    // content, identity, permissions and all modification-related timestamps.
    for (const key of ['ino', 'size', 'mode', 'mtimeMs', 'ctimeMs', 'birthtimeMs'] as const) assert.equal(after[key], marker[key], key);
    assert.deepEqual(readFileSync(resolve(f.folder, completionMarker)), markerBytes);
    const calls = readFileSync(f.calls, 'utf8').trim().split('\n').map(row => JSON.parse(row) as { cwd: string; args: string[] });
    assert.equal(calls.length, 1);
    assert.notEqual(calls[0]!.cwd, f.folder);
    assert.ok(calls[0]!.cwd.startsWith(`${realpathSync(f.folder)}.install-`));
    assert.ok(calls[0]!.args.includes('--include=dev'));
    assert.ok(!calls[0]!.args.includes('--omit=dev'));
    assert.ok(existsSync(resolve(f.folder, 'node_modules/development-package')));
  } finally { f.cleanup(); }
});

test('failed install never publishes a marker and a later setup can retry', { timeout: 15_000 }, async () => {
  const f = fixture();
  try {
    const failed = await f.start({ FAKE_FAIL: '1' }).done;
    assert.notEqual(failed.status, 0);
    assert.match(failed.output, /no dependency install was published/);
    assert.equal(existsSync(f.folder), false);
    assert.equal(existsSync(`${f.folder}.lock`), false);
    assert.deepEqual(readdirSync(resolve(f.dir, 'cache/typescript')), []);
    const retry = await f.start().done;
    assert.equal(retry.status, 0, retry.output);
    assert.ok(existsSync(resolve(f.folder, completionMarker)));
  } finally { f.cleanup(); }
});

test('unmarked install is refused by runtime and safely replaced by setup', { timeout: 15_000 }, async () => {
  const f = fixture();
  try {
    mkdirSync(resolve(f.folder, 'node_modules'), { recursive: true });
    writeFileSync(resolve(f.folder, 'partial'), 'interrupted');
    const runtime = spawnSync(process.execPath, ['--input-type=module', '-e', `import { sharedRequire } from ${JSON.stringify(resolve(f.copy, 'src/runtime.ts'))}; sharedRequire();`], { env: f.env, encoding: 'utf8' });
    assert.notEqual(runtime.status, 0);
    assert.match(runtime.stderr, /dependencies are incomplete.*setup-ts.ts/);
    const result = await f.start().done;
    assert.equal(result.status, 0, result.output);
    assert.ok(existsSync(resolve(f.folder, completionMarker)));
    assert.equal(existsSync(resolve(f.folder, 'partial')), false);
    assert.ok(readdirSync(resolve(f.dir, 'cache/typescript')).some(name => name.endsWith('.incomplete')));
  } finally { f.cleanup(); }
});

test('killed setup leaves no published install; next setup recovers its dead-owner lock', { timeout: 15_000 }, async () => {
  const f = fixture();
  let installerPid: number | undefined;
  try {
    const interrupted = f.start({ FAKE_PAUSE: '1' });
    await until(() => existsSync(f.calls));
    installerPid = (JSON.parse(readFileSync(f.calls, 'utf8').trim()) as { pid: number }).pid;
    interrupted.child.kill('SIGKILL');
    process.kill(installerPid, 'SIGKILL'); installerPid = undefined;
    await interrupted.done;
    assert.equal(existsSync(f.folder), false);
    assert.ok(existsSync(`${f.folder}.lock`));
    const retry = await f.start().done;
    assert.equal(retry.status, 0, retry.output);
    assert.ok(existsSync(resolve(f.folder, completionMarker)));
    assert.equal(existsSync(`${f.folder}.lock`), false);
  } finally {
    if (installerPid) process.kill(installerPid, 'SIGKILL');
    f.cleanup();
  }
});
