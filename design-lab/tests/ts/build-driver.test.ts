import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BuildDriver, cropCapture } from '../../src/figma-build.ts';
import { load, writeOnChange } from '../../src/build-artifacts.ts';
import type { Component, BuildState, BuildResult } from '../../src/build-artifacts.ts';
import { spec, node } from './p2-fixtures.ts';
import * as c from '../../src/build-content.ts';
import * as lc from '../../src/library-counts.ts';
import { rowFor, tierOf } from '../../src/index-rows.ts';
import { missingNested, nativeComponent, slotRendering, surrogateCrops } from '../../src/figma-receipts.ts';
import { sharedRequire } from '../../src/runtime.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
function fixture(t: { after(fn: () => void): void }, comps?: Component[]) {
  const project = mkdtempSync('/tmp/design-lab-round2-unit-'); t.after(() => rmSync(project, { recursive: true, force: true }));
  const component = (id: string, tier: string, placements: number): Component => ({ id, label: id, sourceRef: id + '.yml', fields: [], slots: [], defects: [], usage: { tier, placements, structuralRefs: 2 } });
  const inventory = comps ?? [component('card', 'Components — High Use', 60), component('ghost', 'Components — Low Use', 1)];
  writeOnChange(resolve(project, 'project.json'), { repository: { root: project }, run: { siteLabel: 'Acme' } });
  writeOnChange(resolve(project, 'components.json'), { components: inventory });
  writeOnChange(resolve(project, 'plan.json'), { plans: inventory.map((co, i) => ({ id: co.id, verdict: i ? 'refuse' : 'build', libraryRole: 'component', refuseReason: i ? 'no verified capture' : null, variantAxes: [], properties: [] })) });
  writeOnChange(resolve(project, 'variable-plan.json'), { collections: { Core: { modes: ['Value'], variables: [{ name: 'Color/red', type: 'COLOR', hex: '#f00' }] } } });
  for (const co of inventory) writeOnChange(resolve(project, `capture/measurements/${co.id}.spec.json`), spec({ desktop: [node('/div[0]', 0, 0, 1400, 50)], tablet: [node('/div[0]', 0, 0, 800, 50)], mobile: [node('/div[0]', 0, 0, 375, 50)] }));
  writeOnChange(resolve(project, 'capture-evidence.json'), { captures: Object.fromEntries(inventory.map(co => [co.id, { path: '/card', selector: '#card', images: ['Desktop', 'Tablet', 'Mobile'].map((viewport, i) => ({ viewport, file: resolve(project, viewport + '.png'), width: [1400, 800, 375][i], height: 50 })) }])) });
  const driver = new BuildDriver(project, { runner: true }); const options = { fileKey: 'file', siteUrl: 'https://local.test/', canonicalBaseUrl: 'https://public.test/', offlineImages: true };
  driver.init(options); return { project, driver, options, inventory };
}
const pages = (project: string) => ({ pages: Object.fromEntries(c.pageList(project).map((n, i) => [n, `0:${i + 1}`])), foreign: [] });
const payloadArgs = (path: string) => JSON.parse(readFileSync(path, 'utf8').split('\n')[0]!.slice(13, -1)) as Record<string, unknown>;
test('init orders pages, foundations, tiers, native build and receipts by the plan', t => {
  const { project, driver } = fixture(t), state = driver.state();
  assert.deepEqual(state.planned, ['card']); assert.deepEqual(state.steps.map(s => s.id), ['pages', 'variables', 'foundation:Color', 'foundation:Typography', ...lc.TIERS.map(tier => 'tier:' + tier), 'build:card', 'images:card', 'block:card', 'evidence:card', 'compare:card', 'cover', 'getting-started']);
  assert.equal(state.siteUrl, 'https://local.test'); assert.ok(c.pageList(project).includes('Components — High Use'));
});
test('next and status leave unchanged state and payload files untouched', async t => {
  const { project, driver } = fixture(t), file = resolve(project, 'figma/state.json'), stamp = statSync(file, { bigint: true }).mtimeNs;
  const first = await driver.next(); assert.equal(first.kind, 'use_figma'); if (first.kind !== 'use_figma') return;
  const payloadStamp = statSync(first.payload!, { bigint: true }).mtimeNs; assert.deepEqual(await driver.next(), first); driver.status();
  assert.equal(statSync(file, { bigint: true }).mtimeNs, stamp); assert.equal(statSync(first.payload!, { bigint: true }).mtimeNs, payloadStamp);
  const timings = readFileSync(resolve(project, 'figma/timings.jsonl'), 'utf8').trim().split('\n').map(s => JSON.parse(s));
  assert.equal(timings.length, 2); assert.ok(timings.every(r => r.step === 'pages' && r.phase === 'next' && r.ms >= 0));
});
test('record rejects missing ids, out-of-order steps and wrong result kinds without advancing', async t => {
  const { project, driver } = fixture(t); await assert.rejects(driver.record('pages', {}), /no pages/); await assert.rejects(driver.record('variables', { rootId: 'wrong' }), /expected to record pages/);
  await assert.rejects(driver.record('pages', { pages: {}, foreign: ['someone else'] }), /did not create/); assert.equal(driver.status().done, 0);
  assert.equal(existsSync(resolve(project, 'figma/results/pages.json')), false);
  await driver.record('pages', pages(project)); assert.equal(driver.status().next, 'variables'); assert.equal(new BuildDriver(project).status().done, 1);
});
test('preflight cover identity is retained and a second cover is refused', async t => {
  const { project, driver, options } = fixture(t);
  writeOnChange(resolve(project, 'project.json'), { repository: project, target: { connection: { fileKey: 'file', coverPageId: '0:1' } } }); driver.init(options);
  const wrong = pages(project); wrong.pages['Cover'] = 'another'; await assert.rejects(driver.record('pages', wrong), /initial Cover/);
  await driver.record('pages', pages(project)); assert.equal(driver.state().preflightCover, '0:1');
});
test('an in-process driver sees a new init from another instance and finishes despite runtime edits', async t => {
  const { project, driver, options } = fixture(t); await driver.record('pages', pages(project));
  new BuildDriver(project).init(options); assert.equal(driver.status().done, 0);
  const state = driver.state(); state.done = state.steps.map(s => s.id); state.runtime = 'changed'; writeOnChange(resolve(project, 'figma/state.json'), state);
  assert.deepEqual(await driver.next(), { kind: 'done' });
});
test('rebuild clears this run outputs, wipes first and keeps iterating; another file is refused', t => {
  const { project, driver, options } = fixture(t); driver.init({ ...options, iterate: true });
  writeOnChange(resolve(project, 'figma/results/stale.json'), {}); writeOnChange(resolve(project, 'builds/stale.json'), {});
  assert.throws(() => driver.init({ ...options, fileKey: 'other', rebuild: true }), /same file/); assert.ok(existsSync(resolve(project, 'figma/results/stale.json')));
  driver.init({ ...options, rebuild: true }); assert.equal(driver.status().next, 'wipe'); assert.equal(driver.state().iterate, true); assert.equal(existsSync(resolve(project, 'figma/results/stale.json')), false); assert.equal(existsSync(resolve(project, 'builds/stale.json')), false);
});
test('subset expands to parents, preserves unrelated progress and keeps saved master identities', t => {
  const child: Component = { id: 'child', label: 'Child', sourceRef: 'child.yml', fields: [], slots: [], defects: [] }, parent: Component = { ...child, id: 'parent', slots: [{ name: 'content', accepts: ['child'] }] }, other = { ...child, id: 'other' };
  const { project, driver, options } = fixture(t, [child, parent, other]);
  const plan = load<{ plans: { id: string; verdict: string; variantAxes: []; properties: [] }[] }>(project, 'plan.json'); for (const p of plan.plans) p.verdict = 'build'; writeOnChange(resolve(project, 'plan.json'), plan); driver.init(options);
  for (const cid of ['child', 'parent', 'other']) writeOnChange(resolve(project, `figma/results/build_${cid}.json`), { componentId: 'master:' + cid });
  const state = driver.state(); state.done = state.steps.map(s => s.id); writeOnChange(resolve(project, 'figma/state.json'), state);
  writeOnChange(resolve(project, 'figma/results/pages.json'), pages(project));
  const subset = driver.init({ ...options, only: 'child' }); assert.deepEqual(subset.subset, ['child', 'parent']); assert.ok(driver.state().done.includes('build:other')); assert.ok(!driver.state().done.includes('build:child')); assert.equal(c.buildArgs(project, 'child', driver.state()).existingComponentId, 'master:child');
  assert.throws(() => driver.init({ ...options, only: 'missing' }), /already in/); assert.throws(() => driver.init({ ...options, only: 'child', rebuild: true }), /cannot be combined/);
});
test('image steps isolate missing assets and cannot record an empty result for an upload', async t => {
  const { project, driver } = fixture(t); const state = driver.state(); state.done = state.steps.filter(s => s.id !== 'images:card').map(s => s.id); writeOnChange(resolve(project, 'figma/state.json'), state);
  writeOnChange(resolve(project, 'figma/results/build_card.json'), { componentId: 'master', images: [{ id: 'one', src: '/missing.png' }] });
  const skip = await driver.next(); assert.equal(skip.kind, 'skip'); if (skip.kind === 'skip') assert.equal(skip.reason, 'no image could be fetched'); await driver.record('images:card', {});
  state.done = state.steps.filter(s => s.id !== 'evidence:card').map(s => s.id); writeOnChange(resolve(project, 'figma/state.json'), state); writeOnChange(resolve(project, 'figma/results/block_card.json'), { evidenceIds: ['mobile', 'tablet', 'desktop'] });
  await assert.rejects(driver.record('evidence:card', {}), /invalid upload/); assert.equal(driver.status().next, 'evidence:card');
});
test('evidence upload order follows the actual drawn columns, excluding unmeasured widths', async t => {
  const { project, driver } = fixture(t), tree = c.treeFor(project, 'card'); tree.measured = ['mobile', 'desktop']; writeOnChange(resolve(project, 'figma/trees/card.json'), tree);
  const state = driver.state(); state.done = state.steps.filter(s => s.id !== 'evidence:card').map(s => s.id); writeOnChange(resolve(project, 'figma/state.json'), state); writeOnChange(resolve(project, 'figma/results/block_card.json'), { evidenceIds: ['mobile', 'desktop'] });
  const step = await driver.next(); assert.equal(step.kind, 'upload'); if (step.kind === 'upload') { assert.deepEqual(step.nodeIds, ['mobile', 'desktop']); assert.deepEqual(step.files?.map(f => f.file), [resolve(project, 'Mobile.png'), resolve(project, 'Desktop.png')]); }
});
test('Sharp crops icon captures using Pillow bounds and pads beyond the image', async t => {
  const { project } = fixture(t), image = resolve(project, 'image.png'); await sharp({ create: { width: 3, height: 3, channels: 4, background: '#ff0000' } }).png().toFile(image);
  const cropped = await cropCapture('capture:desktop:-1,-1,3.2,3.2', { desktop: image }, project); const raw = await sharp(cropped!.file).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([raw.info.width, raw.info.height], [4, 4]); assert.deepEqual([...raw.data.subarray(0, 4)], [0, 0, 0, 0]); assert.deepEqual([...raw.data.subarray(20, 24)], [255, 0, 0, 255]); assert.equal(await cropCapture('capture:mobile:0,0,1,1', { desktop: image }, project), null);
});
test('cover and getting-started use recorded master+block counts rather than planned counts', t => {
  const { project, driver } = fixture(t), state = driver.state(); writeOnChange(resolve(project, 'figma/results/pages.json'), pages(project));
  assert.equal(c.coverArgs(project, state, '2026-10-07').total.value, '0'); state.done.push('build:card'); assert.equal(lc.recordedIds(state).size, 0); state.done.push('block:card');
  writeOnChange(resolve(project, 'figma/results/build_card.json'), { componentId: 'master' }); writeOnChange(resolve(project, 'figma/results/block_card.json'), { blockId: 'block' });
  const counts = lc.counts(project, lc.recordedIds(state))!; assert.equal(counts.built, 1); assert.equal(counts.gap.refused, 1); assert.equal(counts.coverBreakdown.reduce((s, r) => s + r.built, 0), 1);
  assert.equal(c.coverArgs(project, state, '2026-10-07').total.value, '1'); const started = c.gettingStartedArgs(project, state, '2026-10-07'); assert.equal(started.index[0]!.setId, 'master'); assert.ok(started.gaps.some(g => g.includes('no verified capture'))); assert.equal(lc.TIER_COLORS['High Use'], '#FAD200'); assert.equal(lc.tierTable(counts)[0]!.built, 1);
});
test('index preserves the merged usage tier, treats partial data as untiered and separates links', t => {
  const { inventory } = fixture(t), co = inventory[0]!;
  assert.equal(tierOf({ ...co, usage: { ...co.usage, placements: 0 } }), 'Components — High Use'); assert.equal(tierOf({ ...co, usage: { ...co.usage, status: 'partial' } }), 'Components — Untiered');
  const row = rowFor(co, { figma: { componentId: 'master', documentationCardId: 'doc', pageId: 'page' } } as Parameters<typeof rowFor>[1]); assert.equal(row.componentLinkTarget, 'master'); assert.equal(row.documentationLinkTarget, 'doc');
});
test('native receipts fail closed on missing measurements and screenshot surrogates', () => {
  const fields = [{ field: 'title' }], slots = [{ name: 'items', accepts: ['child'] }], relationships = [{ field: 'items' }];
  const empty = nativeComponent({ componentId: 'master' }, { setId: 'master' }, fields, relationships, slots); assert.deepEqual(Object.values(empty.validation), [false, false, false, false]);
  const measured = nativeComponent({ componentId: 'master' }, { setId: 'master', native: { nodeType: 'COMPONENT', rootHasImageFill: false, documentedFields: ['title', 'items'], nestedInstances: [{ sourceId: 'child', instanceId: 'instance' }] } }, fields, relationships, slots); assert.ok(Object.values(measured.validation).every(Boolean));
  assert.equal(surrogateCrops({ width: 10, height: 10, images: [{ id: 'image', src: 'capture:desktop:0,0,10,10' }] }).length, 1);
  assert.deepEqual(missingNested(slots, [{ field: 'items', rendered: false }], []), []); assert.deepEqual(missingNested([{ name: 'any', accepts: 'any' }], [], []), ['any: any component']);
});
test('Twig evidence exempts only proven unrendered slots and names accepted types actually rendered', () => {
  const slot = { name: 'items', accepts: ['one', 'two'] };
  assert.deepEqual(slotRendering(undefined, slot), { rendered: true }); assert.equal(slotRendering({ parentRenders: 1, children: { one: 0, two: 0 }, page: '/page' }, slot).rendered, false); assert.deepEqual(slotRendering({ parentRenders: 1, children: { one: 1, two: 0 } }, slot).renderedAccepts, ['one']);
});
test('receipt registration keeps valid outputs, rejects corrupt ones and completes only observed coverage', async t => {
  const { project } = fixture(t), { registerOutputs, componentCoverage } = await import('../../src/figma-receipts.ts');
  const record = JSON.parse(readFileSync(new URL('./fixtures/build-record.json', import.meta.url), 'utf8')); const id = record.id;
  for (const rel of record.documentation.anatomy.relationships) if (typeof rel.accepts === 'string') rel.accepts = [rel.accepts];
  for (const assertion of Object.values(record.assertions) as { verdict: string }[]) assertion.verdict = 'pass';
  writeOnChange(resolve(project, 'builds/good.json'), record); writeOnChange(resolve(project, 'bad.json'), {}); writeOnChange(resolve(project, 'plan.json'), { plans: [{ id, verdict: 'build' }] });
  const manifest = load<{ artifacts: object; phases: object }>(project, 'project.json'); manifest.artifacts = { plan: { path: 'plan.json', kind: 'plan', valid: true } }; manifest.phases = {}; writeOnChange(resolve(project, 'project.json'), manifest);
  const outcome = registerOutputs(project, [{ name: 'build:' + id, path: resolve(project, 'builds/good.json'), kind: 'build-record', phase: 'components' }, { name: 'bad', path: resolve(project, 'bad.json'), kind: 'foundation', phase: 'foundation' }]);
  assert.deepEqual(outcome.registered, ['build:' + id]); assert.ok(outcome.invalid['bad']!.length);
  const saved = load<Parameters<typeof componentCoverage>[1] & { phases: Record<string, { status: string }> }>(project, 'project.json'); assert.equal(saved.phases['components']!.status, 'complete'); assert.deepEqual(componentCoverage(project, saved).missing, []);
  record.assertions['visual-comparison'].verdict = 'fail'; writeOnChange(resolve(project, 'builds/good.json'), record); assert.deepEqual(componentCoverage(project, saved).invalid, ['build:' + id]);
});
test('receipt policy rejects missing triad evidence, surrogate native nodes and duplicate index ids', async () => {
  const { receiptErrors } = await import('../../src/figma-receipts.ts');
  const record = JSON.parse(readFileSync(new URL('./fixtures/build-record.json', import.meta.url), 'utf8')); record.nativeComponent.rootHasImageFill = true; assert.ok(receiptErrors('build-record', record).length);
  const index = JSON.parse(readFileSync(new URL('./fixtures/index.json', import.meta.url), 'utf8')); index.rows.push(index.rows[0]); assert.ok(receiptErrors('index', index).length);
  const foundation = JSON.parse(readFileSync(new URL('./fixtures/foundation.json', import.meta.url), 'utf8')); foundation.collections = {}; assert.ok(receiptErrors('foundation', foundation).length);
});
test('unknown usage gets an Untiered page and observed font/visual losses remain named in Known gaps', t => {
  const { project, driver, options, inventory } = fixture(t); for (const co of inventory) delete co.usage;
  writeOnChange(resolve(project, 'components.json'), { components: inventory }); driver.init(options); assert.ok(c.pageList(project).includes('Components — Untiered')); assert.ok(!c.pageList(project).includes('Components — High Use'));
  writeOnChange(resolve(project, 'figma/results/pages.json'), pages(project)); const state = driver.state(); state.done = state.steps.map(s => s.id);
  writeOnChange(resolve(project, 'figma/results/build_card.json'), { componentId: 'master', missingFonts: ['Absent'], standIns: { Original: 'Inter' }, styleFallbacks: { 'Original Heavy': 'Inter Bold' } }); writeOnChange(resolve(project, 'figma/results/block_card.json'), { blockId: 'block' }); writeOnChange(resolve(project, 'figma/results/compare_card.json'), { pass: false, pairs: [{ ratio: .12 }] });
  const gaps = c.gettingStartedArgs(project, state, '2026-10-07').gaps.join('\n'); for (const name of ['master-matches-capture', 'fonts-stand-in', 'fonts-style-fallback', 'fonts-available']) assert.ok(gaps.includes(name));
});
test('Examples uses source identities and native references, with home first and duplicate sets omitted', t => {
  const { project, driver, inventory } = fixture(t); inventory[0]!.sourceSdcId = 'theme:card'; writeOnChange(resolve(project, 'components.json'), { components: inventory });
  writeOnChange(resolve(project, 'figma/results/pages.json'), { ...pages(project), pages: { ...pages(project).pages, Examples: 'examples' } }); writeOnChange(resolve(project, 'figma/results/build_card.json'), { componentId: 'master' });
  const state = driver.state(); state.done = ['build:card', 'block:card']; writeOnChange(resolve(project, 'compositions.json'), { pages: [{ address: '/other', components: ['theme:card'] }, { address: '/', components: ['theme:card', 'theme:missing'] }] });
  const examples = c.examplesArgs(project, state); assert.equal(examples.pages.length, 1); assert.equal(examples.pages[0]!.address, '/'); assert.equal(examples.pages[0]!.items[0]!.componentId, 'master'); assert.equal(examples.pages[0]!.items[1]!.missing, 'sdc.theme.missing');
});
test('missing or partial capture evidence generates failed receipt assertions without crashing', async t => {
  const { project, driver } = fixture(t), { generate } = await import('../../src/figma-receipts.ts'); const state = driver.state(); state.done = ['build:card', 'block:card']; writeOnChange(resolve(project, 'figma/state.json'), state);
  for (const [sid, body] of [['pages', pages(project)], ['variables', { collections: {} }], ['build_card', { componentId: 'master' }], ['block_card', { blockId: 'block', docId: 'doc', evidenceIds: [] }], ['evidence_card', {}], ['images_card', {}]] as const) writeOnChange(resolve(project, `figma/results/${sid}.json`), body);
  for (const captures of [{}, { card: { path: '/card', images: [{ file: '/tmp/mobile.png', viewport: 'Mobile', width: 375 }] } }]) {
    writeOnChange(resolve(project, 'capture-evidence.json'), { captures }); const outputs = generate(project); assert.equal(outputs.length, 3); const record = load<{ assertions: Record<string, { verdict: string; missing?: string[] }>; nativeComponent: { validation: Record<string, boolean> } }>(project, 'builds/card.json'); assert.equal(record.assertions['breakpoint-evidence']!.verdict, 'fail'); assert.equal(record.assertions['evidence-upload']!.verdict, 'fail'); assert.ok(Object.values(record.nativeComponent.validation).every(v => !v));
  }
});
test('measured typography preserves Python float labels and historical integer defaults', t => {
  const { project } = fixture(t), text = { kind: 'text', name: 'Label', source: '/div[0]/p[0]', sizing: 'FIXED', text: { characters: 'Hello', family: 'Inter', weight: 400, size: 16, lineHeight: 20 } };
  const tree = c.treeFor(project, 'card'); tree.tree.children = [text as NonNullable<typeof tree.tree.children>[number]]; writeOnChange(resolve(project, 'figma/trees/card.json'), tree);
  const measuredText = node('/div[0]/p[0]', 0, 0, 10, 20, { fontSize: '16px', lineHeight: '20px' });
  const measured = spec({ desktop: [node(), measuredText] }); writeOnChange(resolve(project, 'capture/measurements/card.spec.json'), measured);
  assert.ok(c.measuredType(project)[0]!.spec.includes('16.0px / 20.0'));
  measuredText.computed['fontSize'] = ''; writeOnChange(resolve(project, 'capture/measurements/card.spec.json'), measured); assert.ok(c.measuredType(project)[0]!.spec.includes('16px / 20.0'));
});
test('concurrent duplicate records are serialized and a rejected record does not poison the next request', async t => {
  const { project, driver } = fixture(t), outcomes = await Promise.allSettled([driver.record('pages', pages(project)), driver.record('pages', pages(project))]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1); assert.equal(driver.status().done, 1);
  await assert.rejects(driver.record('variables', { png: 'wrong kind' }), /invalid use_figma/); await driver.record('variables', { collections: {} }); assert.equal(driver.status().done, 2);
});
