import { oracleScript, oracleScripts, oracleExecutable } from './oracle.ts';
/** Compare full offline font plans and summaries with unchanged Python on scratch inputs. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { finalise, plan, summaryLines, type AvailableFonts } from '../../src/fonts.ts';
import type { Fonts } from '../../src/generated/fonts.ts';
import { pluginRoot } from '../../src/runtime.ts';

interface ExpectedCase {
  plan: Fonts;
  summary: string[];
  repo: string;
  run: string;
  figma: AvailableFonts | null;
  sitestudio: string | null;
}
const root = resolve(process.argv[2] ?? mkdtempSync('/tmp/design-lab-font-equivalence-'));
assert.ok(root.startsWith('/tmp/') || root.startsWith('/private/tmp/'), `scratch path must be under /tmp: ${root}`);
const started = performance.now(), python = spawnSync(oracleExecutable, [oracleScript('fonts-oracle.py'), root], {
  encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, maxBuffer: 8 * 1024 * 1024,
});
assert.equal(python.status, 0, python.stdout + '\n' + python.stderr);
const prepared = JSON.parse(python.stdout) as { synthetic: string[]; frozen: string[] }, kit = {
  'Freight Text Pro': { cssNames: ['freight-text-pro'], slug: 'freight-text', variations: ['n4', 'i4'] },
};
const results: { name: string; families: number; rendered: number; ms: number }[] = [];
for (const name of [...prepared.synthetic, ...prepared.frozen]) {
  const casePath = resolve(root, name), expectedPath = resolve(casePath, 'expected.json');
  assert.ok(existsSync(expectedPath), `missing Python expectation for ${name}`);
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as ExpectedCase, caseStarted = performance.now();
  const actual = finalise(await plan({
    run: expected.run, repo: expected.repo, sitestudio: expected.sitestudio, figma: expected.figma,
    // Even a missing/null cache entry resolves offline and exactly like the Python oracle adapter.
    fetchAdobeKit: async id => id === 'abc1234' ? (name === 'unreadable-adobe-kit' ? null : kit) : {},
  }));
  assert.deepEqual(actual, expected.plan, `${name}: full font plan`);
  const summary = summaryLines(actual);
  assert.deepEqual(summary, expected.summary, `${name}: summary lines`);
  results.push({ name, families: actual.families.length, rendered: actual.families.reduce((n, f) => n + f.components, 0), ms: performance.now() - caseStarted });
}
const report = { root, syntheticCases: prepared.synthetic.length, frozenCases: prepared.frozen, comparedPlans: results.length,
  familiesCompared: results.reduce((n, row) => n + row.families, 0), totalMs: performance.now() - started, cases: results };
writeFileSync(resolve(root, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
