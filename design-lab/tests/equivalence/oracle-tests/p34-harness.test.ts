import { oracleScript, oracleExecutable } from '../oracle.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { differences, evaluationExitCode } from '../evaluation.ts';
import { portableParity, portableManifest } from '../portable.ts';
import { validate } from '../../../src/contracts.ts';
const scratch = '/tmp/design-lab-merge-tests/harness';
mkdirSync(scratch, { recursive: true });
const temp = () => mkdtempSync(scratch + '/case-');
after(() => rmSync(scratch, { recursive: true, force: true }));
type HarnessRow = {
  site: string;
  error?: string;
  artifacts: Record<string, { status: string; ajv?: string[] }> & {
    scorecard: { status: string; ajv?: string[] };
    report: { status: string; ajv?: string[] };
    completion: { status: string; ajv?: string[] };
  };
};
const good = (): HarnessRow => ({
  site: 'fixture',
  artifacts: { scorecard: { status: 'match' }, report: { status: 'match' }, completion: { status: 'match' } },
});
const exit = (row: HarnessRow) => {
  const root = temp(),
    path = join(root, 'summary.json');
  writeFileSync(path, JSON.stringify({ results: [row] }));
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../evaluation.ts', import.meta.url)), '--check-summary', path],
    { env: process.env, encoding: 'utf8' },
  );
};
for (const error of ['rendering exception', 'browser launch failure', 'embedded image count assertion'])
  void test('harness exits nonzero after ' + error, () => {
    const row = good();
    row.error = error;
    assert.equal(exit(row).status, 1);
  });
void test('harness exits nonzero for actual Ajv errors after a JSON match', () => {
  const row = good();
  row.artifacts['scorecard'].ajv = validate('scorecard', {});
  assert.ok(row.artifacts['scorecard'].ajv.length);
  assert.equal(exit(row).status, 1);
});
for (const name of ['report', 'completion', 'scorecard'])
  void test('harness exits nonzero for absent ' + name, () => {
    const row = good();
    delete row.artifacts[name];
    assert.equal(exit(row).status, 1);
  });
void test('harness exits nonzero for wrong empty container type', () => {
  const row = good();
  row.artifacts['scorecard'] = { status: differences([], {}).length ? 'mismatch' : 'match' };
  assert.equal(exit(row).status, 1);
});
void test('harness accepts complete matches and rejects empty result sets', () => {
  const result = exit(good());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(evaluationExitCode({ results: [] }), 1);
});
for (const missing of ['both', 'python', 'ts'])
  void test('discovery exits nonzero if required artifacts are missing from ' + missing, () => {
    const root = temp(),
      manifest = join(root, 'manifest.json');
    writeFileSync(manifest, JSON.stringify({ core: { fixture: ['components'] } }));
    for (const arm of ['python', 'ts']) {
      mkdirSync(join(root, 'fixture', arm), { recursive: true });
      if (missing !== 'both' && missing !== arm) writeFileSync(join(root, 'fixture', arm, 'components.json'), '{}');
    }
    const p = spawnSync(oracleExecutable, [oracleScript('discovery-compare.py'), root, '--manifest', manifest], {
      encoding: 'utf8',
    });
    assert.equal(p.status, 1, p.stderr);
    assert.match(readFileSync(join(root, 'strict-summary.json'), 'utf8'), /missing required artifact/);
  });
void test('portable matrix and oracle acceptance runs without a DDEV site', async () => {
  assert.equal(portableManifest().pending.length, 2);
  const result = await portableParity(temp());
  assert.equal(result.results.length, 3);
  assert.ok(result.results.every((r) => r.status === 'match'));
});
