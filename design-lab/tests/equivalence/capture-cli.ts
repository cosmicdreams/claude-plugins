import { oracleScript, oracleScripts, oracleExecutable } from './oracle.ts';
/** Exercise the complete TS capture CLI against saved, independently captured Python/mjs fixtures. */
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pluginRoot, sharedRequire } from '../../src/runtime.ts';
import { writeJson } from '../../src/contracts.ts';
import { assembleEvidence } from '../../src/capture/evidence.ts';
import type { CaptureConfig, CaptureRow } from '../../src/capture/types.ts';
const fixtures = resolve(process.argv[2]!);
assert.ok(fixtures.startsWith('/tmp/'), 'copy the saved capture fixtures to /tmp first');
const root = mkdtempSync('/tmp/design-lab-p2-capture-cli-');
const configs = readdirSync(resolve(fixtures, 'configs'))
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(resolve(fixtures, 'configs', f), 'utf8')) as CaptureConfig);
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
const summary: unknown[] = [];
for (const concurrency of [1, 4]) {
  const project = resolve(root, 'c' + concurrency),
    start = performance.now();
  const command = spawnSync(
    process.execPath,
    [
      resolve(pluginRoot, 'src/capture.ts'),
      'run',
      '--project',
      project,
      '--canonical-base-url',
      'https://www.pncb.org',
      '--configs',
      resolve(fixtures, 'configs'),
      '--no-check',
      '--fresh',
      '--concurrency',
      String(concurrency),
    ],
    { encoding: 'utf8', timeout: 600000 },
  );
  assert.equal(command.status, 0, command.stdout + command.stderr);
  const wallMs = performance.now() - start;
  const hashes = spawnSync(
    oracleExecutable,
    [
      '-c',
      'import json,sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); import capture_all; configs=[json.loads(p.read_text()) for p in Path(sys.argv[2]).glob("*.json")]; print(json.dumps({c["componentId"]:capture_all.config_hash(c,1.0) for c in configs}))',
      oracleScripts,
      resolve(fixtures, 'configs'),
    ],
    { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
  );
  assert.equal(hashes.status, 0, hashes.stderr);
  const oracleHashes = JSON.parse(hashes.stdout) as Record<string, string>;
  const index = resolve(project, 'capture/shots/index.json');
  const rows = JSON.parse(readFileSync(index, 'utf8')) as CaptureRow[];
  assert.equal(rows.length, 15);
  for (const cfg of configs) {
    const stem = cfg.componentId.replaceAll(':', '__');
    const record = JSON.parse(readFileSync(resolve(project, 'capture/records', stem + '.json'), 'utf8')) as {
      configHash: string;
    };
    assert.equal(record.configHash, oracleHashes[cfg.componentId], cfg.componentId + ': Python config hash');
    const actual = JSON.parse(
      readFileSync(resolve(project, 'capture/measurements', stem + '.spec.json'), 'utf8'),
    ) as Record<string, unknown>;
    const expected = JSON.parse(
      readFileSync(resolve(fixtures, 'oracle/measure', stem, cfg.machineName + '.spec.json'), 'utf8'),
    ) as Record<string, unknown>;
    delete actual['extractedAt'];
    delete expected['extractedAt'];
    assert.deepEqual(actual, expected);
    const oracleRows = JSON.parse(
      readFileSync(resolve(fixtures, 'oracle/capture', stem, 'index.json'), 'utf8'),
    ) as CaptureRow[];
    const actualRows = rows.filter((row) => row.componentId === cfg.componentId);
    assert.deepEqual(
      actualRows,
      oracleRows.map((row) => ({ ...row, file: stem + row.file!.slice(cfg.machineName.length) })),
    );
    for (let i = 0; i < actualRows.length; i++) {
      const a: { data: Buffer; info: import('sharp').OutputInfo } = await sharp(
        resolve(project, 'capture/shots', actualRows[i]!.file),
      )
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const b = await sharp(resolve(fixtures, 'oracle/capture', stem, oracleRows[i]!.file!))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.deepEqual(a.info, b.info);
      assert.ok(a.data.equals(b.data), cfg.componentId + ': pixels');
    }
  }
  // The same index/files isolate evidence assembly from temporary path differences.
  const oracleFile = resolve(project, 'evidence.oracle.json');
  const oracle = spawnSync(
    oracleExecutable,
    [
      resolve(oracleScripts, 'assemble_capture_evidence.py'),
      index,
      '--out',
      oracleFile,
      '--canonical-base-url',
      'https://www.pncb.org',
    ],
    { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
  );
  assert.equal(oracle.status, 0, oracle.stdout + oracle.stderr);
  const expected = JSON.parse(readFileSync(oracleFile, 'utf8')) as Record<string, unknown>;
  const actual = JSON.parse(JSON.stringify(assembleEvidence(index, rows, 'https://www.pncb.org'))) as Record<
    string,
    unknown
  >;
  delete actual['generatedAt'];
  delete expected['generatedAt'];
  assert.deepEqual(actual, expected);
  const entry = { concurrency, wallMs, specs: 5, indexes: 5, pixelIdentical: 15, evidence: 'exact except generatedAt' };
  summary.push(entry);
  writeJson(resolve(root, 'summary.json'), { root, fixtures, summary });
  console.log(JSON.stringify(entry));
}
console.log(root);
