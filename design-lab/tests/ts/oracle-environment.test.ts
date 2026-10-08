import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const oracle = resolve(import.meta.dirname, '../equivalence/oracle.ts');
function loadOracle(values: Record<string, string>) {
  const env = { ...process.env };
  delete env['DESIGN_LAB_ORACLE_ROOT'];
  delete env['DESIGN_LAB_PYTHON'];
  return spawnSync(process.execPath, [oracle], { env: { ...env, ...values }, encoding: 'utf8' });
}

void test('equivalence harness requires explicit oracle root and Python, including nonblank values', () => {
  for (const values of [{}, { DESIGN_LAB_ORACLE_ROOT: ' ' }]) {
    const result = loadOracle(values);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DESIGN_LAB_ORACLE_ROOT is required/);
  }
  for (const value of [undefined, ' ']) {
    const result = loadOracle({
      DESIGN_LAB_ORACLE_ROOT: '/tmp/baseline',
      ...(value ? { DESIGN_LAB_PYTHON: value } : {}),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DESIGN_LAB_PYTHON is required/);
  }
});

void test('equivalence harness accepts explicitly supplied checkout or plugin paths without running Python', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-oracle-env-'));
  try {
    mkdirSync(resolve(root, 'design-lab/scripts'), { recursive: true });
    for (const supplied of [root, resolve(root, 'design-lab')]) {
      const result = loadOracle({ DESIGN_LAB_ORACLE_ROOT: supplied, DESIGN_LAB_PYTHON: '/path/to/prepared/python' });
      assert.equal(result.status, 0, result.stderr);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('saved-run comparisons require an explicit manifest and absolute run paths', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-saved-env-'));
  const helper = resolve(import.meta.dirname, '../equivalence/saved-runs.ts');
  const load = (manifest?: string) => {
    const env = { ...process.env };
    delete env['DESIGN_LAB_SAVED_RUNS'];
    if (manifest !== undefined) env['DESIGN_LAB_SAVED_RUNS'] = manifest;
    return spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `import {savedRun} from ${JSON.stringify(helper)}; savedRun('pncb');`],
      { env, encoding: 'utf8' },
    );
  };
  try {
    for (const manifest of [undefined, 'relative.json']) {
      const result = load(manifest);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /DESIGN_LAB_SAVED_RUNS must name an absolute JSON file/);
    }
    const manifest = resolve(root, 'runs.json');
    for (const runs of [{}, { pncb: 'relative/run' }]) {
      writeFileSync(manifest, JSON.stringify(runs));
      const result = load(manifest);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /DESIGN_LAB_SAVED_RUNS must supply an absolute path for pncb/);
    }
    writeFileSync(manifest, JSON.stringify({ pncb: root }));
    const result = load(manifest);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('reality scanner requires explicit run folders instead of personal defaults', () => {
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, '../../scripts/check-artifacts.ts')], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contracts:reality requires explicit run folders/);
});

void test('synthetic oracle helpers can load without saved-run inputs', () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DESIGN_LAB_ORACLE_ROOT: '/tmp/baseline',
    DESIGN_LAB_PYTHON: '/path/to/python',
  };
  delete env['DESIGN_LAB_SAVED_RUNS'];
  // Import without invoking the CLI entrypoint or its saved-run workflow.
  const imported = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(resolve(import.meta.dirname, '../equivalence/discovery.ts'))});`,
    ],
    { env, encoding: 'utf8' },
  );
  assert.equal(imported.status, 0, imported.stderr);
});
