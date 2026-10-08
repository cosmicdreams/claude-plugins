import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { validate, assertValid, artifactKinds, writeJson } from '../../src/contracts.ts';
import type { ArtifactKind, ArtifactMap } from '../../src/contracts.ts';
import { scanArtifacts, kindForPath } from '../../src/artifact-scan.ts';

const durableKinds = [
  'project',
  'detection',
  'components',
  'render-evidence',
  'capture-evidence',
  'tokens',
  'usage',
  'plan',
  'foundation',
  'index',
  'build-record',
  'verify-report',
  'scorecard',
] as const;
for (const kind of durableKinds)
  void test(`real artifact excerpt: ${kind}`, () => {
    const fixture = JSON.parse(readFileSync(new URL(`./fixtures/${kind}.json`, import.meta.url), 'utf8')) as unknown;
    assert.deepEqual(validate(kind, fixture), []);
    assert.ok(validate(kind, {}).length);
    assert.deepEqual(validate(kind, fixture), [], 'validation has no mutable previous-error state');
  });
const spec = {
  component: 'Card',
  machineName: 'card',
  source: null,
  path: '/example',
  verificationUrl: 'https://example.test',
  linkUrl: 'https://example.test',
  rootSelector: '.card',
  derivedFrom: 'parent',
  measurements: {
    'desktop:default': { rootBox: { width: 10, height: 20 }, nodes: [], backdrop: 'rgb(255, 255, 255)' },
    'mobile:default': { error: 'no element matched', totalMatches: 0 },
  },
};
const tree = {
  component: 'Card',
  machineName: 'card',
  label: 'Card',
  measured: ['desktop'],
  modes: ['Desktop'],
  fallbacks: [],
  notes: [],
  widths: { Desktop: 10 },
  variables: { 'card/width': { type: 'FLOAT', values: { Desktop: 10 } } },
  tree: {
    kind: 'frame',
    name: 'Card',
    source: '/div[0]',
    sizing: 'FIXED',
    width: { var: 'card/width' },
    fill: { hex: '#ffffff', var: null },
    children: [
      {
        kind: 'text',
        name: 'Label',
        source: '#label',
        sizing: 'FILL',
        text: { characters: 'Hello', family: 'Inter', size: 16, weight: 400, lineHeight: null },
      },
    ],
  },
};
const progress = {
  state: 'waiting',
  stepsDone: null,
  stepsTotal: null,
  step: null,
  stepKind: null,
  message: null,
  inflight: false,
  lastSeen: null,
  at: '2026-10-07T12:00:00Z',
  serverPid: 42,
};
const boundaryCases: [ArtifactKind, unknown][] = [
  ['spec', spec],
  ['tree', tree],
  ['progress', progress],
  [
    'phase-log-entry',
    { at: '2026-10-07T12:00:00Z', phase: 'init', status: 'complete', rebuiltFrom: { run: '/previous' } },
  ],
  [
    'variable-plan',
    {
      collections: {
        Core: { modes: ['Value'], variables: [{ name: 'width', type: 'FLOAT', valuesByMode: { Value: 10 } }] },
      },
      collectionStrategy: { kind: 'grouped-by-mode-boundary' },
      warnings: [{ kind: 'component-layer-excluded', value: 329 }],
    },
  ],
  [
    'fonts',
    {
      families: [
        {
          family: 'Variable Font',
          cssFamily: 'Variable Font',
          source: 'self-hosted',
          components: 1,
          uses: [{ weight: 400, italic: false, face: null }],
          available: null,
          figmaFamily: null,
        },
      ],
      unrendered: [],
      icons: [],
      kits: {},
      figmaChecked: false,
      build: {
        families: {
          font: { family: null, display: 'Variable Font', standIn: false, faces: {}, variable: { '400|0': 400 } },
        },
        stacks: {
          icons: { icon: 'Icon Font' },
          body: { family: 'Variable Font', ranges: [[0, 127]], otherwise: 'Inter' },
        },
        skip: [],
        icons: [],
      },
    },
  ],
  ['figma-state', { fileKey: 'test' }],
  [
    'figma-state',
    {
      fileKey: 'test',
      standardVersion: '1',
      siteUrl: 'https://example.test',
      canonicalBaseUrl: 'https://example.test',
      runtime: 'sha256:test',
      steps: [{ id: 'pages' }],
      done: [],
    },
  ],
  ['step-result', {}],
  ['step-result', { statuses: [200, 0] }],
  ['runner-step', { kind: 'done' }],
  ['runner-step', { kind: 'wait', step: 'wait', retryMs: 5000, message: 'Waiting' }],
  ['runner-step', { kind: 'check', step: 'preflight:check', code: 'return {};' }],
  ['runner-step', { kind: 'dump', step: 'dump:Cover', code: 'return {};', out: '/dump.json' }],
  ['runner-step', { kind: 'use_figma', step: 'pages', payload: '/payload.js', characters: 123 }],
  ['runner-step', { kind: 'use_figma', step: 'pages', code: 'return {};', done: 0, total: 1 }],
  [
    'runner-step',
    {
      kind: 'upload',
      step: 'images:card',
      nodeIds: ['1:1'],
      scaleMode: 'FILL',
      files: [{ file: '/a.png', contentType: 'image/png' }],
    },
  ],
  ['runner-step', { kind: 'screenshot', step: 'compare:card', nodeId: '1:1', out: '/a.png', maxDimension: 200 }],
  ['runner-step', { kind: 'skip', step: 'images:card', reason: 'no images' }],
  ['runner-record', { png: 'iVBORw0KGgo=' }],
  [
    'runner-record',
    { fileKey: 'test', fileName: 'Test', pages: 1, empty: true, preflightCover: false, fonts: { Inter: ['Regular'] } },
  ],
  ['runner-record', { pages: [], collections: [] }],
  ['runner-record', { page: 'Cover', pageIndex: 0, nodes: [], _ids: { page: '0:1', nodes: {} } }],
  ['runner-record-response', { recorded: 'pages', remaining: 1 }],
  ['runner-record-response', { recorded: 'preflight:check', ignored: true }],
  ['runner-error', { step: 'pages', message: 'failed' }],
  ['runner-error-response', {}],
  ['runner-request', { fileKey: 'test', token: 'test-only', version: '0.23.2', step: 'pages', i: '0' }],
];
for (const [index, [kind, fixture]] of boundaryCases.entries())
  void test(`boundary fixture ${index}: ${kind}`, () => assert.deepEqual(validate(kind, fixture), []));

void test('every schema is covered and rejects non-object roots', () => {
  assert.deepEqual([...new Set([...durableKinds, ...boundaryCases.map(([kind]) => kind)])].sort(), artifactKinds);
  for (const kind of artifactKinds)
    for (const value of [null, false, 'text', []]) assert.ok(validate(kind, value).length, kind);
});
void test('nested corruption has a readable path and never coerces input', () => {
  const value = structuredClone(tree);
  value.tree.width = { var: 5 as unknown as string };
  const before = JSON.stringify(value);
  assert.ok(validate('tree', value).some((error) => error.includes('/tree/width/var')));
  assert.equal(JSON.stringify(value), before);
  assert.throws(() => assertValid('tree', value), /tree:\n/);
  assert.ok(validate('progress', { ...progress, stepsDone: '3' }).some((error) => error.includes('/stepsDone')));
  assert.ok(validate('figma-state', { fileKey: 'test', steps: [] }).length);
  assert.ok(validate('runner-step', { kind: 'upload', step: 'images', nodeIds: [5], scaleMode: 'BAD' }).length);
  assert.ok(validate('runner-record', { statuses: ['200'] }).length);
  assert.ok(validate('runner-step', { kind: 'use_figma', step: 'pages' }).length);
  assert.ok(validate('runner-error', { step: 'pages' }).some((error) => error.includes('/message')));
  assert.match(validate('unknown' as ArtifactKind, {})[0]!, /unsupported/);
});
void test('atomic writes replace complete JSON, use private files, and clean up failures', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'design-lab-write-'));
  try {
    const file = resolve(dir, 'nested', 'artifact.json');
    assert.equal(writeJson(file, { text: 'é', count: 1 }), file);
    assert.equal(readFileSync(file, 'utf8'), '{\n  "text": "é",\n  "count": 1\n}\n');
    assert.throws(() => writeJson(file, { bad: 1n }), /BigInt/);
    assert.throws(() => writeJson(file, undefined), /not JSON serializable/);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).count, 1);
    writeJson(file, { count: 2 });
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).count, 2);
    assert.throws(() => writeJson(resolve(dir, 'nested'), {}));
    assert.deepEqual(readdirSync(dir), ['nested']);
    assert.deepEqual(readdirSync(resolve(dir, 'nested')), ['artifact.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
void test('read-only scanner reports all files and JSONL entries, distinguishes screenshot manifests', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'design-lab-scan-'));
  try {
    mkdirSync(resolve(dir, 'figma/trees'), { recursive: true });
    writeJson(resolve(dir, 'figma/trees/card.json'), tree);
    writeFileSync(resolve(dir, 'phase-log.jsonl'), '{"at":"now","phase":"init","status":"complete"}\n{bad}\n');
    writeFileSync(resolve(dir, 'project.json'), '{}');
    const results = scanArtifacts([dir]);
    assert.equal(results.length, 3);
    assert.equal(results.find((r) => r.kind === 'tree')!.errors.length, 0);
    assert.equal(results.find((r) => r.kind === 'phase-log-entry')!.entries, 2);
    assert.match(results.find((r) => r.kind === 'phase-log-entry')!.errors[0]!, /line 2/);
    assert.equal(kindForPath('/run/capture/shots/index.json'), undefined);
    assert.equal(kindForPath('/run/capture.before-0.20.2/shots/index.json'), undefined);
    assert.equal(kindForPath('/run/figma/verify/state.json'), undefined);
    assert.equal(kindForPath('/run/builds/card.json'), 'build-record');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
// Compile-time assertions: bad discriminators and field types cannot enter typed consumers.
function typedContracts(value: unknown): void {
  assertValid('progress', value);
  const state: string = value.state;
  void state;
  // @ts-expect-error runtime contracts expose numbers, not arbitrary strings
  const invalid: ArtifactMap['progress'] = { ...progress, state: 'waiting', stepsDone: '3' };
  // @ts-expect-error runner steps are a discriminated union
  const badKind: ArtifactMap['runner-step'] = { kind: 'unknown' };
  void invalid;
  void badKind;
}
void typedContracts;

void test('media-only tokens accept arbitrary mode names with string values', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/tokens-media-only.json', import.meta.url), 'utf8'));
  assert.deepEqual(validate('tokens', fixture), []);
  fixture.tokens[0].valuesByMode['Unseen breakpoint'] = 42;
  assert.ok(validate('tokens', fixture).some((error) => error.includes('/tokens/0/valuesByMode/Unseen breakpoint')));
  const modes: NonNullable<NonNullable<ArtifactMap['tokens']['tokens']>[number]['valuesByMode']> = {
    'Arbitrary typed breakpoint': '12px',
  };
  // @ts-expect-error all mode values are strings, including previously unseen keys
  modes['Another breakpoint'] = 12;
  void modes;
});

void test('owned artifact records reject root and nested field drift', () => {
  for (const kind of durableKinds) {
    const fixture = JSON.parse(readFileSync(new URL(`./fixtures/${kind}.json`, import.meta.url), 'utf8'));
    assert.ok(
      validate(kind, { ...fixture, unexpectedField: true }).some((error) => error.includes('/unexpectedField')),
      kind,
    );
  }
  assert.ok(
    validate('tree', { ...tree, tree: { ...tree.tree, widht: 10 } }).some((error) => error.includes('/tree/widht')),
  );
  assert.ok(
    validate('tree', { ...tree, tree: { ...tree.tree, fill: { ...tree.tree.fill, opactiy: 1 } } }).some((error) =>
      error.includes('/tree/fill/opactiy'),
    ),
  );
  assert.ok(
    validate('runner-step', { kind: 'upload', step: 'images', nodeIds: [], nodeIDs: [], scaleMode: 'FILL' }).some(
      (error) => error.includes('/nodeIDs'),
    ),
  );
  assert.ok(
    validate('step-result', { geometry: { captures: [{ x: 0, y: 0, width: 10, height: 10, lable: 'Desktop' }] } }).some(
      (error) => error.includes('/geometry/captures/0/lable'),
    ),
  );
});

void test('explicit dictionaries accept new keys and validate their values without defaults', () => {
  const value = structuredClone(spec);
  value.measurements['desktop:default'].nodes = [];
  assert.deepEqual(validate('spec', value), []);
  const variables = { 'a new/component id': { type: 'FLOAT', values: { 'A new mode': 10 } } };
  assert.deepEqual(validate('tree', { ...tree, variables }), []);
  assert.ok(
    validate('tree', { ...tree, variables: { bad: { type: 'FLOAT', values: { Value: { typo: 10 } } } } }).length,
  );
  assert.deepEqual(validate('runner-record', { pages: { 'A user page name': '0:2' } }), []);
  assert.ok(validate('runner-record', { pages: { 'A user page name': 2 } }).length);
  const receipt = JSON.parse(readFileSync(new URL('./fixtures/build-record.json', import.meta.url), 'utf8'));
  assert.deepEqual(
    validate('build-record', {
      ...receipt,
      built: { fonts: { 'A new font 400': 'Regular' }, standIns: { 'A new font': 'Inter' } },
    }),
    [],
  );
  assert.deepEqual(
    validate('tokens', {
      standardVersion: '1',
      toolVersion: 'test',
      spacing: [],
      customStyles: [{ valuesByBreakpoint: { 'A new breakpoint': null } }],
    }),
    [],
  );
  const before = JSON.stringify(value);
  validate('spec', value);
  assert.equal(JSON.stringify(value), before);
});

void test('generated contracts reject typos, missing variant fields and present undefined', () => {
  // @ts-expect-error nodeIDs is not a writer field; the generated union must stay closed.
  const typo: ArtifactMap['runner-step'] = { kind: 'upload', step: 'images', nodeIDs: [], scaleMode: 'FILL' };
  // @ts-expect-error The required-only schema union must require code or payload in its generated type too.
  const missing: ArtifactMap['runner-step'] = { kind: 'use_figma', step: 'pages' };
  // @ts-expect-error Persisted optional properties mean missing, never a present undefined value.
  const absent: ArtifactMap['runner-step'] = { kind: 'done', buildId: undefined };
  assert.ok(validate('runner-step', typo).length);
  assert.ok(validate('runner-step', missing).length);
  // Ajv accepts an undefined optional key as missing and does not remove it; the compiler
  // guards in-memory producers while serialization is the JSON boundary.
  assert.deepEqual(validate('runner-step', absent), []);
  assert.ok(Object.hasOwn(absent, 'buildId'));
});
