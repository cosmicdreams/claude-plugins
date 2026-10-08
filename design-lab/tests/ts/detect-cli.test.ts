import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from '../../src/detect.ts';

const launcher = fileURLToPath(new URL('../../scripts/detect.ts', import.meta.url));
const fixture = resolve(fileURLToPath(new URL('../fixtures/canvas-site', import.meta.url)));

test('the standalone detect command prints the detection document the workflow writes', () => {
  const result = spawnSync(process.execPath, [launcher, fixture], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const printed = JSON.parse(result.stdout);
  assert.deepEqual(printed, JSON.parse(JSON.stringify(detect(fixture))));
  assert.equal(printed.root, fixture);
  assert.equal(printed.configSync, resolve(fixture, 'config/sync'));
  assert.ok(printed.componentSources.some((source: { strategy: string }) => source.strategy === 'canvas'));
});

test('a relative repository path resolves from the working directory', () => {
  const result = spawnSync(process.execPath, [launcher, 'canvas-site'], {
    encoding: 'utf8',
    cwd: dirname(fixture),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).root, fixture);
});

test('a missing or extra argument prints usage and exits 2', () => {
  for (const args of [[], [fixture, 'extra']]) {
    const result = spawnSync(process.execPath, [launcher, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /usage: detect\.ts <repository>/);
  }
});
