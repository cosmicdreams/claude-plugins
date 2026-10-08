import { oracleScript, oracleScripts, oracleExecutable } from './oracle.ts';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compareRuns } from '../../src/compare-runs.ts';
import { hashLayout } from '../../src/determinism.ts';
import { render } from '../../src/scoreboard-render.ts';
import { pluginRoot } from '../../src/runtime.ts';
import { score, headline } from '../../src/score-run.ts';
import { checkHash } from '../../src/determinism.ts';
const root = process.argv[2] ?? '/tmp/design-lab-p4-equivalence',
  oracle = oracleScript('evaluation-oracle.py'),
  results: unknown[] = [];
if (!root.startsWith('/tmp/')) throw new Error('scratch root must be under /tmp');
function py(request: unknown) {
  const path = resolve(root, 'aux-request.json');
  writeFileSync(path, JSON.stringify(request));
  const p = spawnSync(oracleExecutable, [oracle, path], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', DYLD_FALLBACK_LIBRARY_PATH: '/opt/homebrew/lib' },
  });
  if (p.status !== 0) throw new Error(p.stderr);
  return p;
}
import { differences, normalize } from './evaluation.ts';

for (const [a, b] of [
  ['definitive-03', 'definitive-05'],
  ['definitive-05', 'massport'],
] as const) {
  const run = resolve(root, a, 'run'),
    other = resolve(root, b, 'run'),
    out = resolve(root, 'aux', a + '-' + b);
  mkdirSync(out, { recursive: true });
  py({ action: 'compare', run, other, out });
  const expected = JSON.parse(readFileSync(out + '/comparison.json', 'utf8')),
    actual = compareRuns(run, other);
  writeFileSync(out + '/comparison-ts.json', JSON.stringify(actual, null, 2));
  if (actual.summary.score === null) {
    assert.equal(a, 'definitive-03');
    assert.match(actual.summary.reason!, /dump/);
    expected.summary.score = null;
    expected.summary.reason = actual.summary.reason;
  }
  results.push({
    operation: 'compare',
    pair: [a, b],
    intentionalDivergence: actual.summary.score === null ? 'incomplete dump evidence' : null,
    diffs: differences(expected, actual),
  });
  const folder = run + '/figma/trees',
    file = readdirSync(folder).filter((p) => p.endsWith('.json'))[0],
    layout = folder + '/' + file!;
  const hash = spawnSync(
    oracleExecutable,
    [
      '-c',
      'import sys;sys.path.insert(0,sys.argv[1]);import determinism;print(determinism.hash_layout(sys.argv[2]))',
      oracleScripts,
      layout,
    ],
    { encoding: 'utf8' },
  ).stdout.trim();
  writeFileSync(out + '/expected.txt', hash);
  const check = checkHash(layout, out + '/expected.txt');
  results.push({
    operation: 'determinism',
    pair: [a, b],
    layout,
    python: hash,
    typescript: check.actual,
    match: check.pass,
  });
  py({ action: 'scorecard', run, compare: [other], out });
  const expectedCard = JSON.parse(readFileSync(out + '/scorecard.json', 'utf8')),
    actualCard = await score(run, { compare: [other] });
  for (const c of [expectedCard, actualCard]) {
    delete c.generatedAt;
    delete c.sections.cost.clock.scorerSeconds;
  }
  if (actual.summary.score === null) {
    assert.equal(expectedCard.sections.repeatability.status, 'measured');
    assert.equal(actualCard.sections.repeatability.status, 'not-measured');
    assert.match(String(actualCard.sections.repeatability.reason), /dump/);
    const repeated = actualCard.sections.repeatability.comparisons;
    assert.ok(repeated?.length);
    assert.ok(repeated.every((r) => r.error && !('score' in r)));
    expectedCard.sections.repeatability = actualCard.sections.repeatability;
    expectedCard.headline = headline(expectedCard.sections);
  }
  results.push({
    operation: 'score-repeatability',
    pair: [a, b],
    intentionalDivergence: actual.summary.score === null ? 'incomplete dump evidence' : null,
    diffs: differences(normalize(expectedCard), normalize(actualCard)),
  });
}
for (const [name, a, b] of [
  ['missing-null', '"fontSize":null', '"fontName":null'],
  ['float-int', '"width":10.0', '"width":10'],
] as const) {
  const base = resolve(root, 'aux', name),
    run = resolve(base, 'a'),
    other = resolve(base, 'b'),
    out = resolve(base, 'oracle');
  for (const [folder, node] of [
    [run, a],
    [other, b],
  ]) {
    mkdirSync(folder! + '/figma/dump', { recursive: true });
    mkdirSync(folder! + '/figma/verify', { recursive: true });
    writeFileSync(folder! + '/figma/verify/root.json', '{"pages":[{"name":"Main"}]}');
    writeFileSync(folder! + '/figma/dump/Main.json', `{"page":"Main","nodes":[{"path":"Main#0",${node}}]}`);
  }
  mkdirSync(out, { recursive: true });
  py({ action: 'compare', run, other, out });
  const actual = compareRuns(run, other),
    expected = JSON.parse(readFileSync(out + '/comparison.json', 'utf8'));
  results.push({
    operation: 'compare-edge',
    fixture: name,
    score: actual.summary.score,
    diffs: differences(expected, actual),
  });
}
// Explicit exception to Python parity: absent dumps are evidence unavailable, not a perfect build.
{
  const base = resolve(root, 'aux', 'absent-dumps'),
    run = base + '/a',
    other = base + '/b',
    out = base + '/oracle';
  for (const p of [run, other]) mkdirSync(p + '/figma', { recursive: true });
  mkdirSync(out, { recursive: true });
  py({ action: 'compare', run, other, out });
  const expected = JSON.parse(readFileSync(out + '/comparison.json', 'utf8')),
    actual = compareRuns(run, other);
  results.push({
    operation: 'intentional-divergence',
    fixture: 'absent-dump-repeatability',
    python: expected.summary.score,
    typescript: actual.summary.score,
    reason: actual.summary.reason,
    match: expected.summary.score === 100 && actual.summary.score === null,
  });
}
const rows = [
  {
    timestamp: '2026-10-07T00:00:00Z',
    site: "$'<img src=x onerror=alert(1)>",
    tier: 2,
    pluginVersion: '$&$$$`</script>',
    pluginCommit: 'abcdef12',
    coverage: { built: 2, inventoried: 3, buildable: 3, ratio: 2 / 3, placementShare: 0.25 },
    correctedWidths: { pass: 2, total: 3, medianRatio: 0.02 },
    originalWidths: { pass: 1, total: 3, medianRatio: 0.1 },
    openFindings: { blocker: 0, major: 1, minor: 2, other: 0 },
    tokens: { input: 100, output: 50, cacheRead: 200, cacheWrite: 10, total: 360 },
    time: {
      runner: { activeSeconds: 83, steps: 10 },
      clock: { wallSeconds: 3600 },
      working: { status: 'not-measured', reason: 'missing' },
    },
  },
];
const out = resolve(root, 'aux', 'scoreboard');
mkdirSync(out, { recursive: true });
py({ action: 'scoreboard', run: resolve(root, 'definitive-05/run'), out, rows });
writeFileSync(out + '/report-ts.html', render(rows));
results.push({ operation: 'scoreboard', match: readFileSync(out + '/report.html', 'utf8') === render(rows) });
writeFileSync(root + '/aux-summary.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));

process.exitCode = results.some((row) => {
  if (!row || typeof row !== 'object') return false;
  const result = row as { match?: boolean; diffs?: unknown[] };
  return result.match === false || Boolean(result.diffs?.length);
})
  ? 1
  : 0;
