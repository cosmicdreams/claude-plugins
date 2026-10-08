import { oracleScript, oracleExecutable } from './oracle.ts';
/** Cross-run determinism verdicts, including a differing layout pair, against the Python oracle. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { checkHash } from '../../src/determinism.ts';
const root = process.argv[2] ?? '/tmp/design-lab-p4-equivalence';
assert.ok(root.startsWith('/tmp/'));
const results = [];
for (const [a, b] of [
  ['definitive-03', 'definitive-05'],
  ['definitive-05', 'massport'],
] as const) {
  const left = resolve(root, a, 'run/figma/trees'),
    right = resolve(root, b, 'run/figma/trees'),
    name = readdirSync(left)
      .filter((n) => n.endsWith('.json'))
      .sort()[0]!;
  const paths = [
    resolve(left, name),
    resolve(
      right,
      existsSync(resolve(right, name))
        ? name
        : readdirSync(right)
            .filter((n) => n.endsWith('.json'))
            .sort()[0]!,
    ),
  ];
  const out = resolve(root, 'determinism', a + '-' + b);
  mkdirSync(out, { recursive: true });
  const hashes = [];
  for (const [i, path] of paths.entries()) {
    const request = resolve(out, 'request.json');
    writeFileSync(request, JSON.stringify({ action: 'determinism', run: path, out }));
    const py = spawnSync(oracleExecutable, [oracleScript('evaluation-oracle.py'), request], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    assert.equal(py.status, 0, py.stderr);
    hashes[i] = JSON.parse(readFileSync(resolve(out, 'determinism.json'), 'utf8')).hash as string;
  }
  const expectedFile = resolve(out, 'expected.txt');
  writeFileSync(expectedFile, hashes[1]!);
  const expected = { expected: hashes[1], actual: hashes[0], pass: hashes[0] === hashes[1] },
    actual = checkHash(paths[0]!, expectedFile);
  assert.deepEqual(actual, expected);
  results.push({ pair: [a, b], layouts: paths, python: expected, typescript: actual, match: true });
}
writeFileSync(resolve(root, 'determinism-summary.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
