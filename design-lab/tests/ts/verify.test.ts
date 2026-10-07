import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { verify } from '../../src/verify.ts';
import { buildMeasurements } from '../../src/verify-inputs.ts';
import { mergeVerifyState } from '../../src/verify-state.ts';

const run = (state: any, more: any = {}) => verify({ state, generatedAt: '2026-01-01T00:00:00Z', out: '/tmp/verify-report.json', ...more });

test('verify returns the baseline report envelope and distinguishes empty subjects', () => {
  const report = run({});
  assert.deepEqual(Object.keys(report), ['standardVersion', 'generatedAt', 'open', 'waived', 'passed', 'inapplicable', 'completeness']);
  assert.equal(report.standardVersion, '4.1.0');
  assert.equal(report.open.some(f => f.check === 'verify-report-exists'), false);
  assert.ok(report.inapplicable.includes('component-naming'));
  assert.ok(report.passed.includes('components-built'));
});

test('visual fidelity requires registered capture files and a passing live comparison', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-verify-'));
  try {
    const builds = resolve(root, 'builds'); mkdirSync(builds);
    writeFileSync(resolve(builds, 'hero.json'), JSON.stringify({ id: 'hero', visualEvidence: { captureFiles: ['hero.png'], comparison: { verdict: 'fail' } } }));
    const report = run({ components: [], cards: [], collections: [], pages: [] }, { builds, captureEvidence: { captures: {} } });
    assert.deepEqual(report.open.filter(f => f.check.startsWith('visual-') || f.check === 'master-matches-capture').map(f => f.check), ['visual-evidence-present', 'master-matches-capture']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('source token binding regressions catch both one-sided mismatches', () => {
  const state = { components: [
    { name: 'hero — Hero', tokenBoundCount: 0 },
    { name: 'plain — Plain', tokenBoundCount: 1 },
  ], cards: [], collections: [], pages: [] };
  const report = run(state, {
    renderEvidence: { items: { hero: { styleFacts: { rootRules: [{ declarations: [{ resolution: 'sass-variable' }] }] } } } },
    measurements: { plain: { nodes: [{ declared: { color: '#333' } }] } },
  });
  const finding = report.open.find(f => f.check === 'bindings-match-source');
  assert.deepEqual(finding?.evidence, [
    'hero: Sass/CSS evidence consumes a token, the Figma component binds nothing',
    'plain: the Figma component binds variables, the source hardcodes every value - the defect has been tidied away',
  ]);
});

test('breakpoint state is checked for actual responsive variable bindings', () => {
  const report = run({ components: [{ id: 'hero', name: 'hero — Hero', type: 'COMPONENT_SET', responsiveVariableCount: 1, breakpointBoundCount: 0 }], cards: [], collections: [], pages: [] }, { plan: { plans: [{ id: 'hero', variantAxes: [{ field: 'appearance' }] }] } });
  assert.ok(report.open.some(f => f.check === 'variants-are-sets' && (f.evidence as string[]).some(x => x.includes('no Breakpoint variable'))));
});

test('Boolean variables remain exempt while other ALL_SCOPES variables fail', () => {
  const report = run({ collections: [{ name: 'Core', variables: [
    { name: 'enabled', type: 'BOOLEAN', scopes: ['ALL_SCOPES'] },
    { name: 'space/1', type: 'FLOAT', scopes: ['ALL_SCOPES'] },
  ] }] });
  assert.deepEqual(report.open.filter(f => f.check === 'variable-scoped').map(f => f.scope), ['Core::space/1']);
});

test('an explained blank Web code name passes and an unrelated description does not', () => {
  const report = run({ collections: [{ name: 'Core', variables: [
    { name: 'measured/width', web: null, description: 'No CSS custom property declares this value, so there is no code name.' },
    { name: 'surface/primary', web: null, description: 'Used for the primary card background.' },
  ] }] });
  const blank = report.open.find(f => f.check === 'code-syntax-set');
  assert.deepEqual(blank?.evidence, ['surface/primary']);
});

test('Sass map references resolve by their variable name', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-theme-'));
  try {
    writeFileSync(resolve(root, 'theme.scss'), '$spacers: (1: 4px);');
    const report = run({ collections: [{ name: 'Core', variables: [
      { name: 'space/1', web: 'map-get($spacers, 1)' },
      { name: 'space/missing', web: 'map-get($missing, 1)' },
    ] }] }, { themeRoot: root });
    const finding = report.open.find(f => f.check === 'code-syntax-resolves');
    assert.deepEqual(finding?.evidence, ['space/missing -> map-get($missing, 1)']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('collection strategy accepts a recorded independent boundary', () => {
  const state = { collections: [{ name: 'Example Core', modes: ['Light', 'Dark'] }, { name: 'Example Theme', modes: ['Regular', 'Compact'] }], collectionStrategyReason: 'independent mode boundary' };
  const report = run(state, { brand: 'Example' });
  assert.equal(report.open.some(f => f.check === 'collection-strategy'), false);
});

test('documentation adjacency and required block sections remain enforced', () => {
  const report = run({ components: [{ name: 'hero — Hero', page: 'Components — High Use', pageId: 'component-page' }], cards: [
    { component: 'hero', name: 'Documentation · hero', pageId: 'other-page', sections: ['Head', 'Usage'] },
  ] });
  assert.ok(report.open.some(f => f.check === 'documentation-adjacent'));
  assert.ok(report.open.some(f => f.check === 'documentation-signal'));
});

test('breakpoint component sets require the expected collection mode identities and captures', () => {
  const component = { id: 'master', name: 'hero — Hero', type: 'COMPONENT', breakpointBoundCount: 2 };
  const collection = { id: 'bp', modes: [
    { name: 'Desktop 1400px', id: 'd' }, { name: 'Tablet 800px', id: 't' }, { name: 'Mobile 375px', id: 'm' },
  ] };
  const card = { component: 'hero', captureLabels: ['Mobile 375px', 'Tablet 800px', 'Desktop 1400px'], breakpointScreenshotCount: 3, breakpointNodes: [
    { id: 'mobile', name: 'hero Mobile', type: 'INSTANCE', width: 375, mainComponentId: 'master', explicitModes: { bp: 'm' } },
    { id: 'tablet', name: 'hero Tablet', type: 'INSTANCE', width: 800, mainComponentId: 'master', explicitModes: { bp: 't' } },
    { id: 'master', name: 'hero', type: 'COMPONENT', width: 1400 },
  ] };
  const pass = run({ components: [component], cards: [card], breakpointCollection: collection });
  assert.equal(pass.open.some(f => f.check === 'breakpoint-triad'), false);
  (card.breakpointNodes[0] as any).explicitModes.bp = 'Tablet 800px';
  const fail = run({ components: [component], cards: [card], breakpointCollection: collection });
  assert.ok(fail.open.some(f => f.check === 'breakpoint-triad'));
});

test('breakpoint triad rejects missing instance mode, wrong mode order, and unnamed layers', () => {
  const component = { id: 'master', name: 'hero — Hero', type: 'COMPONENT', pageId: 'wrong', breakpointBoundCount: 2 };
  const card = { component: 'hero', name: 'Documentation · hero', pageId: 'expected', defaultNamedLayers: 1,
    captureLabels: ['Mobile 375px', 'Tablet 800px', 'Desktop 1400px'], breakpointScreenshotCount: 3,
    breakpointNodes: [
      { id: 'm', name: 'hero Mobile', type: 'INSTANCE', width: 375, mainComponentId: 'master', explicitModes: {} },
      { id: 't', name: 'hero Tablet', type: 'INSTANCE', width: 800, mainComponentId: 'master', explicitModes: { bp: 't' } },
      { id: 'master', name: 'hero', type: 'COMPONENT', width: 1400 },
    ] };
  const report = run({ components: [component], cards: [card], pages: [{ id: 'expected', name: 'Components' }],
    breakpointCollection: { id: 'bp', modes: [
      { name: 'Mobile 375px', id: 'm' }, { name: 'Tablet 800px', id: 't' }, { name: 'Desktop 1400px', id: 'd' },
    ] } });
  assert.ok(report.open.some(f => f.check === 'documentation-adjacent'));
  assert.ok(report.open.some(f => f.check === 'layers-named'));
  assert.ok(report.open.some(f => f.check === 'breakpoint-triad'));
});

test('component sets need a planned or observed non-breakpoint axis', () => {
  const base = { id: 'hero', name: 'hero — Hero', type: 'COMPONENT_SET', cards: [], pages: [] };
  const rejected = run({ components: [base] }, { plan: { plans: [{ id: 'hero' }] } });
  assert.ok(rejected.open.some(f => f.check === 'variants-are-sets'));
  const accepted = run({ components: [{ ...base, variantNames: ['Layout=Wide'] }] }, { plan: { plans: [{ id: 'hero', variantAxes: [{ field: 'Breakpoint' }] }] } });
  assert.equal(accepted.open.some(f => f.check === 'variants-are-sets'), false);
});

test('duplicate definitions and non-instance Examples content fail', () => {
  const report = run({ components: [
    { name: 'hero — Hero', description: 'Source id: paragraph:hero' },
    { name: 'hero — Hero copy', description: 'Source id: paragraph:hero' },
    { name: 'bad — Bad', page: 'Examples' },
  ], exampleInvalidNodes: [{ name: 'Extra shape', type: 'RECTANGLE' }] });
  assert.ok(report.open.some(f => f.check === 'no-duplicate-components'));
  assert.deepEqual(report.open.find(f => f.check === 'examples-instances-only')?.evidence, ['bad — Bad', 'Extra shape (RECTANGLE)']);
});

test('measurement assembly uses qualified paths and rejects stale source references', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-measurements-'));
  try {
    const folder = resolve(root, 'capture/measurements'); mkdirSync(folder, { recursive: true });
    writeFileSync(resolve(folder, 'paragraph__hero.spec.json'), JSON.stringify({ source: { sourceRef: 'paragraph.yml' }, measurements: { 'desktop:default': { nodes: [{ id: 'current' }] } } }));
    writeFileSync(resolve(folder, 'block__hero.spec.json'), JSON.stringify({ source: { sourceRef: 'old-block.yml' }, measurements: { 'desktop:default': { nodes: [{ id: 'stale' }] } } }));
    const values = buildMeasurements(root, [
      { id: 'paragraph:hero', sourceRef: 'paragraph.yml' } as any,
      { id: 'block:hero', sourceRef: 'new-block.yml' } as any,
    ]);
    assert.deepEqual(values, { 'paragraph:hero': { nodes: [{ id: 'current' }] } });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('verification dump merging carries strategy, brand, page children, and Getting Started data', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-state-'));
  try {
    const runDir = resolve(root, 'run'), folder = resolve(runDir, 'figma/verify');
    mkdirSync(folder, { recursive: true });
    writeFileSync(resolve(runDir, 'variable-plan.json'), JSON.stringify({ collectionStrategy: { reason: 'independent theme boundary' } }));
    writeFileSync(resolve(runDir, 'project.json'), JSON.stringify({ run: { siteLabel: 'Example' } }));
    writeFileSync(resolve(folder, 'root.json'), JSON.stringify({ pages: [{ id: 'p', name: 'Components', children: null }], collections: [{ name: 'Core' }, { name: 'Theme' }] }));
    writeFileSync(resolve(folder, 'page-p.json'), JSON.stringify({ page: { id: 'p', children: 4 }, cards: [{ name: 'Documentation · hero' }] }));
    writeFileSync(resolve(folder, 'getting-started.json'), JSON.stringify({ gettingStarted: { indexRowCount: 1 } }));
    assert.deepEqual(mergeVerifyState(folder), {
      pages: [{ id: 'p', name: 'Components', children: 4 }], collections: [{ name: 'Core' }, { name: 'Theme' }],
      collectionStrategyReason: 'independent theme boundary; separate collections are reserved for an independent mode boundary', brand: 'Example',
      components: [], cards: [{ name: 'Documentation · hero' }], breakpointFrames: [], exampleInvalidNodes: [],
      gettingStarted: { indexRowCount: 1 },
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('planned documentation approval matches either the inventory id or machineName', () => {
  const state = { components: [], cards: [], collections: [] };
  const inventory = { components: [{ id: 'block:hero', machineName: 'hero', label: 'Hero' }] };
  const report = run(state, {
    components: inventory,
    plan: { plans: [{ machineName: 'hero', verdict: 'build' }] },
  });
  assert.deepEqual(report.open.find(f => f.check === 'documentation-cards')?.evidence, ['block:hero']);
  const byId = run(state, { components: inventory, plan: { plans: [{ id: 'block:hero', verdict: 'build' }] } });
  assert.deepEqual(byId.open.find(f => f.check === 'documentation-cards')?.evidence, ['block:hero']);
  const preferredId = run(state, { components: inventory, plan: { plans: [
    { id: 'paragraph:legacy-id', machineName: 'hero', verdict: 'build' },
  ] } });
  assert.equal(preferredId.open.some(f => f.check === 'documentation-cards'), false);
});

test('empty measurements are baseline-falsy and leave source binding comparison unperformed', () => {
  const report = run({ components: [{ name: 'hero — Hero', tokenBoundCount: 0 }] }, { measurements: {} });
  assert.deepEqual(report.open.filter(f => f.check === 'bindings-match-source').map(f => [f.severity, f.detail]), [[
    'minor', 'not checked - pass --render-evidence or --measurements so source token use can be compared against the Figma bindings',
  ]]);
});

test('Find-oriented documentation names count as documentation and refused inventory is exempt', () => {
  const state = { components: [{ name: 'link_default — Link (Paragraph)', pageId: 'p' }], cards: [
    { name: 'Link · link_default (Paragraph)', pageId: 'p' },
  ] };
  const components = { components: [
    { id: 'paragraph:link_default', machineName: 'link_default', label: 'Link' },
    { id: 'paragraph:field_group', machineName: 'field_group', label: 'Field group' },
  ] };
  const report = run(state, { components, plan: { plans: [
    { id: 'paragraph:link_default', verdict: 'build' }, { id: 'paragraph:field_group', verdict: 'refuse' },
  ] } });
  assert.equal(report.open.some(f => f.check === 'documentation-cards'), false);
});

test('plans key enforces completeness, even without an inventory components key', () => {
  const report = run({ components: [] }, { plan: { plans: [{ id: 'block:hero', verdict: 'build' }] } });
  const finding = report.open.find(f => f.check === 'components-built');
  assert.equal(finding?.severity, 'blocker');
  assert.equal(finding?.detail, '1 of 1 planned components are not in the file');
});

test('namespace-colliding inventory is counted only for its qualified source id', () => {
  const report = run({ components: [{
    name: 'accordion — Accordion', description: 'Machine name: accordion\nSource id: block:accordion',
  }] }, { components: { components: [
    { id: 'block:accordion', machineName: 'accordion', usage: { tier: 'High Use' } },
    { id: 'paragraph:accordion', machineName: 'accordion', usage: { tier: 'High Use' } },
  ] } });
  assert.deepEqual(report.completeness, { built: 1, expected: 2, byTier: { 'High Use': [1, 2, ['paragraph:accordion']] } });
});

test('render token evidence cannot bind a same-named component from another Drupal namespace', () => {
  const report = run({ components: [{
    name: 'accordion — Accordion', description: 'Machine name: accordion\nSource id: block:accordion', tokenBoundCount: 0,
  }] }, { renderEvidence: { items: { 'paragraph:accordion': { styleFacts: { rootRules: [{ declarations: [
    { property: 'color', value: '$brand', resolution: 'sass-variable' },
  ] }] } } } } });
  assert.equal(report.open.some(f => f.check === 'bindings-match-source' && f.severity === 'blocker'), false);
});

test('an observed set of alternate layouts is a valid component set without a planned axis', () => {
  const report = run({ components: [{ name: 'paragraph:card — Card', type: 'COMPONENT_SET',
    description: 'Source id: paragraph:card', variantNames: ['Layout=Captured', 'Layout=In Cards'] }] },
  { plan: { plans: [{ id: 'paragraph:card', variantAxes: [] }] } });
  assert.equal(report.open.some(f => f.check === 'variants-are-sets'), false);
});

test('mode names and split width-mode collections are rejected', () => {
  const report = run({ collections: [
    { name: 'Example Breakpoint', modes: ['Desktop 1400px', 'Mobile 375px'] },
    { name: 'Example Type', modes: ['Value', '@media (width < 48rem)'] },
  ], collectionStrategyReason: 'x' }, { brand: 'Example' });
  assert.ok(report.open.some(f => f.check === 'mode-naming'));
  assert.ok(report.open.some(f => f.check === 'collection-strategy'));
});

test('receipt contract requires source anatomy, breakpoint triad, and nested instances', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-receipt-contract-'));
  try {
    const builds = resolve(root, 'builds'); mkdirSync(builds);
    writeFileSync(resolve(builds, 'accordion.json'), JSON.stringify({ id: 'block:accordion',
      documentation: { anatomy: { fields: [], relationships: [] }, breakpointScreenshots: { desktop: '1:1' } },
      nativeComponent: { nodeType: 'COMPONENT_SET', rootHasImageFill: false, componentProperties: [], nestedInstances: [],
        validation: { nativeNode: true, noScreenshotSurrogate: true, authoringCoverage: true, relationshipCoverage: false } },
      visualEvidence: { breakpoints: { desktop: { captureFile: 'desktop.png' } }, comparison: { breakpoints: { desktop: 'pass' } } },
    }));
    const report = run({ components: [], cards: [], collections: [] }, { builds,
      components: { components: [{ id: 'block:accordion', fields: [{ name: 'field_heading' }], slots: [
        { name: 'field_items', accepts: ['paragraph:item'] },
      ] }] },
    });
    assert.deepEqual(report.open.filter(f => ['documentation-anatomy', 'breakpoint-triad', 'nested-component-coverage'].includes(f.check)).map(f => f.check),
      ['documentation-anatomy', 'breakpoint-triad', 'nested-component-coverage']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('not-run build assertions cannot pass whole-file verification', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-build-assertions-'));
  try {
    const builds = resolve(root, 'builds'); mkdirSync(builds);
    writeFileSync(resolve(builds, 'hero.json'), JSON.stringify({ assertions: { fidelity: { verdict: 'not-run' } } }));
    const report = run({ components: [], cards: [], collections: [] }, { builds });
    assert.deepEqual(report.open.find(f => f.check === 'build-record-assertions')?.evidence, ['hero.json (fidelity)']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('font receipts report planned stand-ins, actual drawn family, and ignore unrendered planned fonts', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'design-lab-font-receipts-'));
  try {
    const builds = resolve(root, 'builds'); mkdirSync(builds);
    writeFileSync(resolve(root, 'fonts.json'), JSON.stringify({ families: [
      { family: "Suisse Int'l", cssFamily: "Suisse Int'l", standIn: { family: 'Inter' } },
      { family: 'Courier', cssFamily: 'Courier', standIn: { family: 'Courier New' } },
    ] }));
    writeFileSync(resolve(builds, 'a.json'), JSON.stringify({ built: {
      missingFonts: ["Suisse Int'l", 'Courier'], standIns: { "Suisse Int'l": 'Inter', Courier: 'Cousine' },
      styleFallbacks: { 'PT Sans 600': 'PT Sans Bold' }, fonts: {},
    } }));
    writeFileSync(resolve(builds, 'b.json'), JSON.stringify({ built: {
      missingFonts: [], standIns: {}, styleFallbacks: {}, fonts: { 'Poppins 400': 'Inter Regular' },
    } }));
    const report = run({ components: [], cards: [], collections: [] }, { builds });
    const standIn = report.open.find(f => f.check === 'fonts-stand-in');
    assert.ok(standIn?.detail.includes("Courier and Suisse Int'l drawn in Cousine and Inter"));
    const standEvidence = standIn?.evidence as string[];
    assert.ok(standEvidence[0]?.includes('Courier -> Cousine'));
    assert.ok(standEvidence[0]?.includes('the plan now names Courier New'));
    assert.ok((report.open.find(f => f.check === 'fonts-style-fallback')?.evidence as string[] | undefined)?.[0]?.includes('PT Sans 600 -> PT Sans Bold'));
    assert.equal(report.open.some(f => f.check === 'fonts-available'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
