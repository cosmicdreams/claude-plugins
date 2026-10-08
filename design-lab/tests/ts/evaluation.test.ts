import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeze, list, sitePath, sites } from '../../src/corpus.ts';
import { layoutNodes, metric, numericCheck, compare as compareProperties } from '../../src/property-compare.ts';
import { replay as replayTier1 } from '../../src/tier1.ts';
import { prepare, waitForBuild } from '../../src/tier2.ts';
import { record, rows } from '../../src/scoreboard.ts';
import { render } from '../../src/scoreboard-render.ts';
import { elapsedTime, tokens } from '../../src/run-metrics.ts';

const writeJson = (path: string, value: unknown) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(value)); };
const node = (path: string, x = 0, width = 100) => ({ path, box: { x, y: 0, width, height: 20 }, computed: { display: 'block', visibility: 'visible', opacity: '1', fontSize: '16px', textAlign: 'left' }, tag: 'div' });
function runFixture(root: string) {
  const run = join(root, 'run'); mkdirSync(join(run, 'capture/measurements'), { recursive: true }); mkdirSync(join(run, 'capture/shots'), { recursive: true }); mkdirSync(join(run, 'figma/images'), { recursive: true });
  const component = { id: 'block:sample', machineName: 'sample', label: 'Sample' };
  writeJson(join(run, 'project.json'), { pluginVersion: '1.0', run: { plugin: { version: '1.0', commit: 'abc12345' }, siteLabel: 'site-a' }, target: { figmaFileKey: 'original' }, repository: { root: join(run, 'repository') } });
  writeJson(join(run, 'components.json'), { components: [component] });
  writeJson(join(run, 'plan.json'), { plans: [{ id: component.id, verdict: 'build' }] });
  writeJson(join(run, 'capture/measurements/sample.spec.json'), { measurements: { 'desktop:default': { nodes: [node('/root'), node('/root/child', 10)] } } });
  writeJson(join(run, 'capture-evidence.json'), { canonicalBaseUrl: 'https://example.invalid', captures: {} });
  writeJson(join(run, 'figma/state.json'), { fileKey: 'original' });
  writeFileSync(join(run, 'capture/shots/sample.png'), 'shot');
  writeFileSync(join(run, 'figma/images/saved.png'), 'image');
  return run;
}

test('corpus freezes source artifacts, hashes JSON, and lists only frozen sites', () => {
  const root = mkdtempSync(join(tmpdir(), 'design-lab-corpus-'));
  try {
    const run = runFixture(root), config = { corpus: join(root, 'corpus'), scoreboard: { ledger: join(root, 'ledger.jsonl'), dashboard: join(root, 'dashboard.html') } };
    const manifest = freeze(run, 'site-a', config);
    assert.equal(manifest.pluginCommit, 'abc12345'); assert.equal(manifest.fileCount, 8); assert.ok(manifest.artifacts['project.json']);
    assert.deepEqual(sites(config), [join(root, 'corpus/site-a')]); assert.equal(list(config)[0].label, 'site-a');
    assert.throws(() => freeze(run, 'site-a', config), /already exists/);
    for (const label of ['..', '../outside', '/absolute', 'a/b', 'a\\b']) assert.throws(() => sitePath(label, config), /site label/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('tier 1 replays through injected tree builder without mutating the saved run', () => {
  const root = mkdtempSync(join(tmpdir(), 'design-lab-tier1-test-'));
  try {
    const run = runFixture(root), before = readFileSync(join(run, 'project.json'), 'utf8');
    const result = replayTier1(run, 'site-a', {
      components: () => [{ id: 'block:sample', machineName: 'sample', label: 'Sample' } as any],
      plans: () => ({ 'block:sample': { verdict: 'build' } } as any),
      buildTrees: (_run, trees) => { mkdirSync(trees, { recursive: true }); writeJson(join(trees, 'block:sample.json'), { measured: ['desktop'], variables: {}, tree: { kind:'frame', source: '/root', width: 100, height: 20, children: [{ kind:'frame',source: '/root/child', x: 10, y: 0, width: 20, height: 10 }] } }); return [{ id: 'block:sample' }]; },
    });
    assert.equal(result.tier, 1); assert.equal(result.components['block:sample']['desktop:default'].status, 'measured');
    assert.equal(result.metrics.geometry!.total, 8); assert.equal(readFileSync(join(run, 'project.json'), 'utf8'), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('property comparisons report flow positions and unknown numeric checks as unmeasured', () => {
  const rows = layoutNodes({ kind:'frame',name:'root',source:'/root',sizing:'FIXED',width: 100, height: 40, layout: { mode: 'HORIZONTAL', gap: 10 }, children: [{ kind:'frame',name:'a',sizing:'FIXED',source: 'a', width: 20, height: 10 }, { kind:'frame',name:'b',sizing:'FIXED',source: 'b', width: 30, height: 10, x: 700 }] });
  assert.deepEqual(rows.map(row => row.box.x), [0, 0, 30]);
  assert.equal(numericCheck('text', 'height', 20, null, 2).pass, null);
  const result = compareProperties({ measured: ['desktop'], variables: {}, tree: { kind:'frame', source: '/root', width: 100, height: 20 } }, { measurements: { 'desktop:expanded': { nodes: [node('/root')] } } });
  assert.equal(result['desktop:expanded'].status, 'unmeasured');
  const missingFont = numericCheck('text', 'height', 20, null, 2);
  assert.equal(metric([missingFont]).unmeasured, 1);
});

test('property comparisons retain variable breakpoints and inline text measurement gaps', () => {
  const text = { ...node('/div[0]/p[1]', 0, 100), tag: 'p', inlineText: 'Hello world', text: 'Hello world', computed: { display: 'block', visibility: 'visible', opacity: '1', fontSize: '18px', textAlign: 'center' } };
  const strong = { ...node('/div[0]/p[1]/strong[2]', 0, 40), tag: 'strong', text: 'world', computed: { display: 'inline', visibility: 'visible', opacity: '1', fontSize: '18px', textAlign: 'center', fontWeight: '700' } };
  const image = { ...node('/div[0]/img[3]', 20, 100), tag: 'img', image: { src: '/sample.png' } };
  const spec = { measurements: { 'desktop:default': { nodes: [node('/div[0]'), text, strong, image] } } };
  const tree = { measured: ['desktop'], variables: {}, tree: { kind: 'frame', source: '/div[0]', width: 90, height: 50, layout: { mode: 'NONE' }, children: [{ kind: 'text', source: text.path, x: 4, y: 0, width: 100, height: 20, text: { characters: 'Hello world', size: 16, align: 'LEFT' } }] } };
  const report = compareProperties(tree, spec)['desktop:default']!;
  for (const name of ['geometry', 'fontSize', 'textAlignment', 'textRunCount', 'imagesPresent']) assert.ok(report[name].passed < report[name].total);
  assert.equal(report.textRunCount.checks[0].flattened, true);
  const variableTree = { measured: ['desktop', 'mobile'], variables: { width: { values: { Desktop: 100, Mobile: 50 } } }, tree: { kind:'frame', source: '/root', width: { var: 'width' }, height: 50 } };
  const mobile = node('/root', 0, 50); mobile.box.height = 50;
  const breakpoints = compareProperties(variableTree, { measurements: { 'desktop:default': { nodes: [node('/root')] }, 'mobile:default': { nodes: [mobile] }, 'desktop:expanded': { nodes: [node('/root')] } } });
  assert.equal(breakpoints['mobile:default']!.geometry.passed, 4); assert.equal(breakpoints['desktop:expanded']!.status, 'unmeasured');
});

test('tier 2 prepares a relocated scratch copy and waits until dumps settle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'design-lab-tier2-test-'));
  try {
    const run = runFixture(root), config = { corpus: join(root, 'corpus'), scoreboard: { ledger: join(root, 'ledger.jsonl'), dashboard: join(root, 'dashboard.html') } };
    freeze(run, 'site-a', config);
    const site = join(root, 'corpus/site-a'), workspace = prepare(site, 'scratch-key', { timestamp: 'replay-one' });
    assert.deepEqual(JSON.parse(readFileSync(join(workspace, 'figma/state.json'), 'utf8')), { fileKey: 'scratch-key' });
    assert.equal(JSON.parse(readFileSync(join(workspace, 'project.json'), 'utf8')).target.figmaFileKey, 'scratch-key');
    assert.equal(JSON.parse(readFileSync(join(site, 'project.json'), 'utf8')).target.figmaFileKey, 'original');
    let calls = 0;
    await waitForBuild(workspace, 1, { status: () => ({ done: 1, total: 1, next: null }), dumpStep: () => ++calls === 1 ? { step: 'verify:root' } : null, sleep: async () => {} });
    assert.equal(calls, 2);
    writeJson(join(workspace, 'figma/progress.json'), { state: 'failed', message: 'build failed' });
    await assert.rejects(waitForBuild(workspace, 1, { status: () => ({ done: 0, total: 1, next: 'build:sample' }), dumpStep: () => ({ step: 'build:sample' }), sleep: async () => {} }), /build failed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('shared run cost helpers preserve recorded values', () => {
  const root = mkdtempSync(join(tmpdir(), 'design-lab-cost-'));
  try {
    const cost = { model: { status: 'measured', tokens: 23 }, clock: { wallSeconds: 12 } };
    writeJson(join(root, 'benchmark/scorecard.json'), { sections: { cost } });
    assert.equal(tokens(root), 23); assert.deepEqual(elapsedTime(root), { clock: cost.clock });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('scoreboard appends shared metrics and renders a self-contained dashboard', async () => {
  const root = mkdtempSync(join(tmpdir(), 'design-lab-scoreboard-'));
  try {
    const run = runFixture(root), config = { corpus: join(root, 'corpus'), scoreboard: { ledger: join(root, 'ledger.jsonl'), dashboard: join(root, 'dashboard.html') } };
    const first = await record(run, 2, 'site-a', { config, now: () => '2026-10-07T12:00:00Z', getMetrics: () => ({ coverage: { placementShare: 0.82 }, correctedWidths: { pass: 14, total: 20 }, openFindings: { blocker: 2, major: 1 }, tokens: null }) });
    assert.equal(first.pluginCommit, 'abc12345'); assert.equal(rows(config).length, 1); assert.equal(existsSync(config.scoreboard.dashboard), true);
    const page = readFileSync(config.scoreboard.dashboard, 'utf8'); assert.doesNotMatch(page, /<script src/);
    const standalone = render([{ timestamp: first.timestamp, site: 'site-a', pluginVersion: '1.0', tier: 2 }]); assert.match(standalone, /not measured/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('property comparison reads typography from the text payload and preserves absent actuals',()=>{
 const measured={...node('/label'),text:'Hello',computed:{display:'block',visibility:'visible',opacity:'1',fontSize:'18px',textAlign:'center'}};
 const tree={measured:['desktop'],variables:{},tree:{kind:'text',source:'/label',width:100,height:20,text:{characters:'Hello',size:18,align:'CENTER'}}};
 const good=compareProperties(tree,{measurements:{'desktop:default':{nodes:[measured]}}})['desktop:default']!;
 assert.equal(good.fontSize.passed,1);assert.equal(good.textAlignment.passed,1);assert.equal(good.textRunCount.passed,1);
 const missing=compareProperties({...tree,tree:{kind:'frame',width:100,height:20}},{measurements:{'desktop:default':{nodes:[measured]}}})['desktop:default']!;
 assert.equal(missing.fontSize.checks[0].actual,null);assert.equal(missing.textAlignment.checks[0].actual,null);assert.equal(missing.geometry.checks[0].actual,null);
});
