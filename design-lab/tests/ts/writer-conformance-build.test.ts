/**
 * The build receipts (foundation, build record, index, project registry) are written from observed Figma results.
 * A receipt the closed schema rejects is never registered, so the phase never completes. Each case below observes a
 * complete, passing build whose inputs differ in the branches that add, omit or null a receipt field, runs the real
 * generate-and-register path, and requires every receipt to register.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BuildDriver } from '../../src/figma-build.ts';
import { generate, registerOutputs } from '../../src/figma-receipts.ts';
import { load, writeOnChange } from '../../src/build-artifacts.ts';
import { validate } from '../../src/contracts.ts';
import * as c from '../../src/build-content.ts';
import { spec, node } from './p2-fixtures.ts';
import { sharedRequire } from '../../src/runtime.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;

type Variation = {
  name: string;
  realCompare?: boolean;
  component?: Record<string, unknown>;
  build?: Record<string, unknown>;
  block?: Record<string, unknown>;
  compare?: Record<string, unknown> | null;
  usage?: unknown;
};

function observed(t: { after(fn: () => void): void }, variation: Variation) {
  const project = mkdtempSync('/tmp/design-lab-writer-build-');
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const component = {
    id: 'card',
    label: 'Card',
    sourceRef: 'card.yml',
    fields: [],
    slots: [],
    defects: [],
    usage:
      variation.usage === undefined
        ? { tier: 'Components — High Use', placements: 60, structuralRefs: 2 }
        : variation.usage,
    ...variation.component,
  };
  writeOnChange(resolve(project, 'project.json'), {
    schemaVersion: 1,
    standardVersion: '3.0.0',
    pluginVersion: 'test',
    repository: { root: project, commit: null, dirty: false },
    decisions: {},
    phases: {},
    artifacts: {},
    run: { siteLabel: 'Acme' },
  });
  writeOnChange(resolve(project, 'components.json'), { components: [component] });
  writeOnChange(resolve(project, 'plan.json'), {
    standardVersion: '3.0.0',
    plans: [
      {
        id: 'card',
        verdict: 'build',
        libraryRole: 'component',
        refuseReason: null,
        variantAxes: [],
        properties: [],
        variants: 1,
        visualIdentity: 'independent',
        visualEvidence: { captured: true, renderSignals: true, path: '/card', states: ['default'], images: [] },
      },
    ],
  });
  writeOnChange(resolve(project, 'variable-plan.json'), {
    collections: { Core: { modes: ['Value'], variables: [{ name: 'Color/red', type: 'COLOR', hex: '#f00' }] } },
  });
  writeOnChange(
    resolve(project, 'capture/measurements/card.spec.json'),
    spec({
      desktop: [node('/div[0]', 0, 0, 1400, 50)],
      tablet: [node('/div[0]', 0, 0, 800, 50)],
      mobile: [node('/div[0]', 0, 0, 375, 50)],
    }),
  );
  const images = ['Desktop', 'Tablet', 'Mobile'].map((viewport, i) => {
    const file = resolve(project, viewport + '.png');
    writeFileSync(file, 'png');
    return { viewport, state: 'default', file, hash: 'sha256:x', width: [1400, 800, 375][i], height: 50 };
  });
  writeOnChange(resolve(project, 'capture-evidence.json'), {
    captures: { card: { path: '/card', selector: '#card', images } },
  });
  const driver = new BuildDriver(project, { runner: true });
  driver.init({
    fileKey: 'file',
    siteUrl: 'https://local.test/',
    canonicalBaseUrl: 'https://public.test/',
    offlineImages: true,
  });
  const state = driver.state();
  state.done = state.steps.map((s) => s.id).filter((id) => !(variation.realCompare && id === 'compare:card'));
  writeOnChange(resolve(project, 'figma/state.json'), state);
  const box = (label: string, x: number) => ({ x, y: 0, width: 100, height: 50, label });
  const results: Record<string, unknown> = {
    pages: { pages: Object.fromEntries(c.pageList(project).map((n, i) => [n, `0:${i + 1}`])), foreign: [] },
    variables: { collections: { Core: { id: 'c1', modes: ['Value'], variables: 1 } } },
    build_card: { componentId: 'master', created: 4, bound: 0, literal: 3, variables: 0, ...variation.build },
    block_card: {
      blockId: 'block',
      docId: 'doc',
      setId: 'master',
      specimenId: 'specimen',
      evidenceIds: ['e1', 'e2', 'e3'],
      geometry: {
        variants: [box('desktop', 0), box('tablet', 100), box('mobile', 200)],
        captures: [box('desktop', 0), box('tablet', 100), box('mobile', 200)],
        specimen: { width: 300, height: 50 },
      },
      native: { nodeType: 'COMPONENT', rootHasImageFill: false, documentedFields: [], nestedInstances: [] },
      ...variation.block,
    },
    evidence_card: { statuses: [200, 200, 200] },
    images_card: {},
  };
  if (variation.compare !== null && !variation.realCompare)
    results['compare_card'] = {
      file: resolve(project, 'compare.png'),
      pass: true,
      pairs: ['desktop', 'tablet', 'mobile'].map((label) => ({
        label,
        changed: 0,
        height: 50,
        width: 100,
        ratio: 0,
        pass: true,
      })),
      ...variation.compare,
    };
  for (const [name, body] of Object.entries(results)) {
    mkdirSync(resolve(project, 'figma/results'), { recursive: true });
    writeOnChange(resolve(project, `figma/results/${name}.json`), body);
  }
  return { project, driver };
}
function registered(project: string) {
  const outputs = generate(project),
    outcome = registerOutputs(project, outputs);
  assert.deepEqual(outcome.invalid, {}, JSON.stringify(outcome.invalid));
  assert.equal(outcome.registered.length, outputs.length);
  assert.deepEqual(validate('project', load(project, 'project.json')), []);
  for (const output of outputs)
    assert.deepEqual(validate(output.kind, load(project, output.path.slice(project.length + 1))), [], output.name);
  return {
    outputs,
    record: load<{ built: Record<string, unknown>; assertions: Record<string, Record<string, unknown>> }>(
      project,
      'builds/card.json',
    ),
  };
}

const variations: Variation[] = [
  { name: 'a component that binds no variable has no collection id', build: {} },
  {
    name: 'a component that binds variables records its collection',
    build: { collectionId: 'c1', variables: 1, bound: 1, literal: 2 },
    component: {},
  },
  {
    name: 'a build with images, fonts, fallbacks and nested mismatches',
    build: {
      images: [{ id: 'i1', src: 'capture:desktop:0,0,10,10', fit: 'FILL' }],
      fonts: { A: 'Inter' },
      missingFonts: ['B'],
      standIns: { B: 'Inter' },
      styleFallbacks: { C: 'Inter Bold' },
      iconText: { a: 'x', b: 2 },
      nestedMismatch: [{ sourceId: 's', texts: [1], images: [0] }],
      svgFailures: ['x'],
      collectionId: 'c1',
    },
  },
  {
    name: 'fields with array and object defaults, mixed enum values and slots that accept any component',
    component: {
      fields: [
        { name: 'list', kind: 'array', default: [1, 'a'] },
        {
          name: 'mode',
          kind: 'enum',
          default: true,
          options: [
            { value: 'a', label: 'A' },
            { value: null, label: 'None' },
            { value: true, label: 'True' },
          ],
        },
        { name: 'rich', kind: 'richtext', default: { uri: 'x', options: { a: 1 } } },
      ],
      slots: [
        { name: 'body', accepts: 'any' },
        { name: 'foot', accepts: ['x:y'] },
      ],
    },
  },
  { name: 'a component with no usage measured (degraded run)', usage: null },
  {
    name: 'a comparison that did not pass',
    compare: {
      pass: false,
      pairs: [{ label: 'desktop', changed: 5, height: 50, width: 100, ratio: 0.5, pass: false }],
    },
  },
  { name: 'a component never compared', compare: null },
  { name: 'a comparison measured by the real screenshot comparison', realCompare: true },
  {
    name: 'a set that is a component set',
    block: {
      setId: 'master',
      native: {
        nodeType: 'COMPONENT_SET',
        rootHasImageFill: false,
        documentedFields: [],
        nestedInstances: [{ sourceId: 's', instanceId: 'i' }],
      },
    },
  },
];
for (const variation of variations) {
  void test(`receipts register: ${variation.name}`, async (t) => {
    const { project, driver } = observed(t, variation);
    if (variation.realCompare) {
      const png = await sharp({ create: { width: 300, height: 50, channels: 3, background: '#ffffff' } })
        .png()
        .toBuffer();
      await driver.recordScreenshot('compare:card', { png: png.toString('base64') });
    }
    registered(project);
  });
}

void test('foundation errors remain an intentional rejected receipt, with their evidence preserved', (t) => {
  const { project } = observed(t, { name: 'unplanned variables' });
  writeOnChange(resolve(project, 'figma/results/variables.json'), {
    collections: { Core: { id: 'c1', modes: ['Value'], variables: 1 } },
    unplanned: ['unplanned/color'],
  });
  const outputs = generate(project),
    outcome = registerOutputs(project, outputs);
  assert.ok(
    outcome.invalid['foundation']?.some(
      (error) => error.includes('validation.errors') || error.includes('fewer than') || error.includes('more than'),
    ),
  );
  assert.ok(!outcome.registered.includes('foundation'));
  assert.deepEqual(load<{ validation: { errors: string[] } }>(project, 'foundation.json').validation.errors, [
    'unplanned/color',
  ]);
});
