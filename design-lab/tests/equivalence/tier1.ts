import { oracleScript, oracleScripts, oracleExecutable } from './oracle.ts';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { replay } from '../../src/tier1.ts';
import { pluginRoot } from '../../src/runtime.ts';
const root = process.argv[2] ?? '/tmp/design-lab-p4-equivalence',
  results: unknown[] = [];
if (!root.startsWith('/tmp/')) throw new Error('scratch root must be under /tmp');
function diff(a: unknown, b: unknown, p = '', out: unknown[] = []): unknown[] {
  if (out.length >= 30 || Object.is(a, b)) return out;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
    out.push([p, a, b]);
    return out;
  }
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(left), ...Object.keys(right)])) diff(left[k], right[k], p + '/' + k, out);
  return out;
}
for (const site of ['massport', 'kingtec', 'americas-credit-unions']) {
  const run = resolve(root, site, 'run'),
    out = resolve(root, site, 'tier1');
  mkdirSync(out, { recursive: true });
  const req = resolve(out, 'request.json');
  writeFileSync(req, JSON.stringify({ action: 'tier1', run, out, label: site }));
  const py = spawnSync(oracleExecutable, [oracleScript('evaluation-oracle.py'), req], {
    encoding: 'utf8',
    env: process.env,
  });
  if (py.status !== 0) throw new Error(py.stderr);
  const start = performance.now(),
    actual = replay(run, site);
  writeFileSync(resolve(out, 'tier1-ts.json'), JSON.stringify(actual, null, 2));
  results.push({
    site,
    diffs: diff(JSON.parse(readFileSync(resolve(out, 'tier1.json'), 'utf8')), actual),
    tsSeconds: (performance.now() - start) / 1000,
    python: JSON.parse(readFileSync(resolve(out, 'timings.json'), 'utf8')),
  });
  writeFileSync(resolve(root, 'tier1-summary.json'), JSON.stringify(results, null, 2));
  console.log(site, results.at(-1));
}
process.exitCode = results.some((row) => {
  if (!row || typeof row !== 'object') return false;
  return Boolean((row as { diffs?: unknown[] }).diffs?.length);
})
  ? 1
  : 0;
