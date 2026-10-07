/** Every queue step, including images, with immutable source runs copied to /tmp. */
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { generate as receipts } from '../../src/figma-receipts.ts';
import { BuildDriver } from '../../src/figma-build.ts';
import { load, writeOnChange } from '../../src/build-artifacts.ts';
import type { BuildState, BuildResult } from '../../src/build-artifacts.ts';
import type { RunnerStep } from '../../src/generated/runner-step.ts';
import { pluginRoot } from '../../src/runtime.ts';
const sources = { definitive: resolve(homedir(), 'Sites/DEFINITIVEHC/design/2026-10-05'), pncb: resolve(homedir(), '.design/pncb/2026-10-06') };
const root = process.argv[2] ?? mkdtempSync('/tmp/design-lab-round2-driver-');
assert.ok(root.startsWith('/tmp/'));
const normalize = (v: unknown, folder: string): unknown => {
  if (typeof v === 'string') return v.replaceAll(folder.startsWith('/private') ? folder : '/private' + folder, '<RUN>').replaceAll(folder.startsWith('/private') ? folder.slice(8) : folder, '<RUN>');
  if (Array.isArray(v)) return v.map(x => normalize(x, folder));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x, folder)]));
  return v;
};
function relocate(folder: string, old: string, replacement: string): void {
  for (const n of readdirSync(folder, { withFileTypes: true })) {
    const p = resolve(folder, n.name); if (n.isDirectory()) relocate(p, old, replacement);
    else if (n.isFile() && n.name.endsWith('.json')) { const text = readFileSync(p, 'utf8'); if (text.includes(old)) writeFileSync(p, text.replaceAll(old, replacement)); }
  }
}
if (!existsSync(resolve(root, 'prepared.json'))) {
  for (const [run, source] of Object.entries(sources)) {
    const oracle = resolve(root, run, 'python'), target = resolve(root, run, 'ts'); mkdirSync(resolve(root, run), { recursive: true });
    cpSync(source, oracle, { recursive: true });
    // Move saved results aside before init while preserving frozen fetched files.
    if (existsSync(resolve(oracle, 'figma/results'))) cpSync(resolve(oracle, 'figma/results'), resolve(oracle, 'recorded-results'), { recursive: true });
    relocate(oracle, source, oracle); cpSync(oracle, target, { recursive: true }); relocate(target, oracle, target);
  }
  writeOnChange(resolve(root, 'prepared.json'), {});
}
const pendingRuns = Object.entries(sources).filter(([run, source]) => {
  const initial = load<BuildState>(source, 'figma/state.json'), options = { rebuild: initial.steps[0]?.id === 'wipe' };
  for (const lane of ['python', 'ts']) writeOnChange(resolve(root, run, lane, 'replay-options.json'), options);
  const path = resolve(root, run, 'python/oracle.json'); return !existsSync(path) || load<{ transcript: unknown[] }>(path, '').transcript.length !== initial.steps.length;
}).map(([run]) => run);
if (pendingRuns.length) {
  const python = spawnSync(process.env['DESIGN_LAB_PYTHON'] ?? 'python3', [resolve(pluginRoot, 'tests/equivalence/driver-oracle.py'), ...pendingRuns.map(run => resolve(root, run, 'python'))], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(python.status, 0, python.stdout + '\n' + python.stderr);
}
const summary: Record<string, unknown> = {};
for (const run of Object.keys(sources)) {
  const project = resolve(root, run, 'ts'), oracle = resolve(root, run, 'python'), expected = load<{ init: unknown; state: BuildState; transcript: { step: RunnerStep; input: BuildResult; result: BuildResult; recorded: unknown }[]; ms: number }>(oracle, 'oracle.json'), old = load<BuildState>(project, 'figma/state.json'), driver = new BuildDriver(project, { runner: true }), started = performance.now();
  const init = driver.init({ fileKey: old.fileKey, siteUrl: old.siteUrl, canonicalBaseUrl: old.canonicalBaseUrl, offlineImages: true, iterate: old.iterate, ...load<{ rebuild: boolean }>(project, 'replay-options.json') });
  assert.deepEqual(init, expected.init, run + ': init');
  const steps: string[] = []; let payloads = 0, images = 0;
  for (const row of expected.transcript) {
    const sid = row.step.step!, step = await driver.next();
    assert.deepEqual(normalize(step, project), normalize(row.step, oracle), run + ': ' + sid + ': step');
    if (step.kind === 'use_figma') {
      const actual = readFileSync(step.payload!, 'utf8'), py = readFileSync((row.step as typeof step).payload!, 'utf8');
      // Exact source proves both the normalized ARGS and unchanged oracle JS bodies.
      assert.equal(actual, py, run + ': ' + sid + ': payload'); payloads++;
    }
    if (sid.startsWith('images:')) {
      images++;
      const manifest = `figma/images/${sid.slice(7).split('.').at(-1)}/images.json`;
      assert.deepEqual(normalize(load(project, manifest), project), normalize(load(oracle, manifest), oracle), run + ': ' + sid + ': asset manifest');
      if (step.kind === 'upload') for (const [i, file] of (step.files ?? []).entries()) {
        const expectedFile = row.step.kind === 'upload' ? row.step.files![i]!.file : '';
        if (!file.file.includes('/crop-')) assert.deepEqual(readFileSync(file.file), readFileSync(expectedFile), sid + ': frozen image bytes');
      }
    }
    const data = JSON.parse(JSON.stringify(row.input).replaceAll(oracle, project)) as BuildResult;
    if (step.kind === 'screenshot') cpSync(row.input.file!, data.file!);
    const recorded = await driver.record(sid, data);
    assert.deepEqual(recorded, row.recorded, run + ': ' + sid + ': recorded');
    assert.deepEqual(normalize(load(project, `figma/results/${sid.replace(/[^A-Za-z0-9_.-]+/g, '_')}.json`), project), normalize(row.result, oracle), run + ': ' + sid + ': result'); steps.push(sid);
  }
  assert.deepEqual(await driver.next(), { kind: 'done' });
  assert.deepEqual(driver.state(), JSON.parse(JSON.stringify(expected.state).replaceAll(oracle, project)));
  const oracleIndex = load<{ generatedAt: string }>(oracle, 'index.json');
  const outputs = receipts(project, new Date(oracleIndex.generatedAt));
  for (const output of outputs) assert.deepEqual(normalize(load(project, output.path), project), normalize(load(oracle, output.path.replace(project, oracle)), oracle), run + ': receipt ' + output.name);
  summary[run] = { stepsCompared: steps.length, stepsMatched: steps.length, payloads, images, tsMs: performance.now() - started, pythonMs: expected.ms, recordedFigmaResults: run === 'definitive', syntheticProtocolResults: run === 'pncb' };
}
writeOnChange(resolve(root, 'summary.json'), { root, summary }); console.log(JSON.stringify({ root, summary }, null, 2));
