import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Browser, BrowserContext } from 'playwright';
import { pool, isolated, concurrency } from '../../src/capture/pool.ts';
import { runCapture, candidatePages, configHash, legacyHash } from '../../src/capture/run.ts';
import type { CaptureOptions, CaptureAdapters } from '../../src/capture/run.ts';
import type { CaptureConfig } from '../../src/capture/types.ts';
import { scaffold, firstExample, templateSelector, sdcSelector, customSelector } from '../../src/capture/scaffold.ts';
import { writeJson } from '../../src/contracts.ts';
import { cropChild } from '../../src/capture/derive.ts';
import { subtree, signature } from '../../src/nesting.ts';
import * as twig from '../../src/capture/twig.ts';
import { sharedRequire } from '../../src/runtime.ts';
import { node, spec } from './p2-fixtures.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
const temporary = () => mkdtempSync('/tmp/design-lab-p2-test-');
const config = (id = 'sdc.demo.alpha'): CaptureConfig => ({ component: id, componentId: id, machineName: id.split('.').at(-1)!, path: '/one', verificationUrl: 'https://site.test/one', linkUrl: 'https://public.test/one', rootSelector: '#x', states: [{ name: 'default' }] });
function fixture() {
  const root = temporary(), configs = [config(), config('sdc.demo.zeta')];
  writeJson(resolve(root, 'components.json'), { source: { strategy: 'canvas' }, components: configs.map(c => ({ id: c.componentId, machineName: c.machineName, usage: { examples: [c.path, '/two', '/three', '/four'] } })) });
  writeJson(resolve(root, 'project.json'), { schemaVersion: 1, standardVersion: '3.0.0', pluginVersion: '0.23.2', repository: { root, commit: null, dirty: false }, decisions: {}, phases: { capture: { status: 'pending' }, plan: { status: 'approved' }, components: { status: 'complete' } }, artifacts: { oldPlan: { kind: 'plan' } } });
  const calls: string[] = [], browser = { newContext: async () => ({ close: async () => {} }), close: async () => {} } as unknown as Browser;
  const adapters: CaptureAdapters = { launch: async () => browser, measure: async (_browser, cfg) => { calls.push('measure:' + cfg.componentId + ':' + cfg.path); return spec({ desktop: [node()], tablet: [node()], mobile: [node()] }, cfg.component); },
    capture: async (_browser, cfg, out) => { calls.push('capture:' + cfg.componentId); mkdirSync(out, { recursive: true }); return ['Desktop', 'Tablet', 'Mobile'].map(viewport => {
      const file = `${cfg.machineName}__${viewport.toLowerCase()}.png`; writeFileSync(resolve(out, file), 'png'); return { componentId: cfg.componentId, machine: cfg.machineName, file, path: cfg.path, verificationUrl: cfg.verificationUrl, linkUrl: cfg.linkUrl, selector: cfg.rootSelector, viewport, state: 'default', width: 100, height: 50 };
    }); }, check: async (_browser, check) => { calls.push('check:' + check.componentId); return { componentId: check.componentId, chosen: check.pages[0]!.path, revealed: false, seconds: 0, pages: [] }; } };
  const options: CaptureOptions = { project: root, canonicalBaseUrl: 'https://public.test', configs, concurrency: 1 };
  return { root, configs, calls, options, adapters };
}
test('scaffold uses first populated source and namespace selectors', () => {
  const out = scaffold({ source: { strategy: 'canvas' }, components: [{ id: 'sdc.demo.alpha', usage: { examples: [{ path: '/verified' }], renderedExamples: ['/rendered'] } }, { id: 'sdc.demo.zeta', usage: { renderedExamples: ['/home', '/other'] } }, { id: 'sdc.demo.empty', usage: {} }] }, { siteUrl: 'https://demo.ddev.site', canonicalBaseUrl: 'https://demo.example' });
  assert.deepEqual(out.map(c => c.path), ['/verified', null, '/home']); assert.equal(out[0]!.rootSelector, '[data-component-id="demo:alpha"]'); assert.equal(out[0]!.verificationUrl, 'https://demo.ddev.site/verified'); assert.equal(out[0]!.linkUrl, 'https://demo.example/verified');
  assert.deepEqual(firstExample({ renderedExamples: [], exampleCandidates: ['/candidate', '/later'] }), { path: '/candidate' });
});
test('fallback pages are bounded and deduplicated including candidates', () => {
  const c = { id: 'x', usage: { examples: [{ path: '/verified' }], exampleCandidates: ['/login', '/', { path: '/verified' }] } };
  assert.deepEqual(candidatePages({ path: '/login' }, c, 5), ['/login', '/verified', '/']); assert.deepEqual(candidatePages({ path: '/login' }, c, 2), ['/login', '/verified']);
});
test('capture resumes complete records and retains evidence without browser launch', async () => {
  const f = fixture(); const a = await runCapture(f.options, f.adapters); const count = f.calls.length;
  const record = resolve(f.root, 'capture/records/sdc.demo.alpha.json'), stamp = statSync(record).mtimeMs;
  const b = await runCapture(f.options, { ...f.adapters, launch: async () => { throw new Error('no browser needed'); } });
  assert.deepEqual(b.captures, a.captures); assert.equal(f.calls.length, count); assert.equal(statSync(record).mtimeMs, stamp);
  const project = JSON.parse(readFileSync(resolve(f.root, 'project.json'), 'utf8')) as { phases: Record<string, {status: string}>; artifacts: Record<string, {valid: boolean}> };
  assert.equal(project.phases['capture']!.status, 'complete'); assert.equal(project.phases['plan']!.status, 'pending'); assert.equal(project.artifacts['captureEvidence']!.valid, true); assert.equal(project.artifacts['oldPlan'], undefined);
  assert.match((project.artifacts['captureEvidence'] as unknown as { sha256: string }).sha256, /^sha256:[a-f0-9]{64}$/);
});
test('changed config invalidates reuse', async () => {
  const f = fixture(); await runCapture(f.options, f.adapters); f.calls.length = 0;
  f.configs[0]!.rootSelector = '#different'; await runCapture(f.options, f.adapters);
  assert.equal(f.calls.filter(c => c.startsWith('measure:')).length, 1);
});
test('only recaptures named component and unknown IDs are rejected', async () => {
  const f = fixture(); await runCapture(f.options, f.adapters); f.calls.length = 0;
  await runCapture({ ...f.options, only: ['sdc.demo.alpha'], fresh: true }, f.adapters); assert.equal(f.calls.filter(c => c.startsWith('measure:')).length, 1); assert.ok(f.calls.every(c => !c.includes('zeta')));
  await assert.rejects(runCapture({ ...f.options, only: ['unknown'] }, f.adapters), /unknown component/);
});
test('selector misses never produce measurements or shots; check mode publishes no captures', async () => {
  const f = fixture(), adapters = { ...f.adapters, check: async (_b: unknown, check: { componentId: string }) => ({ componentId: check.componentId, chosen: null, revealed: false, seconds: 0, pages: [] }) };
  const checked = await runCapture({ ...f.options, check: true }, adapters); assert.equal(checked.problems.length, 2); assert.equal(f.calls.length, 0); assert.equal(existsSync(resolve(f.root, 'capture-evidence.json')), false);
  const result = await runCapture(f.options, adapters); assert.equal(result.problems.length, 2); assert.equal(f.calls.length, 0);
});
test('without selector checks fallback stops at max pages', async () => {
  const f = fixture(); const adapters = { ...f.adapters, measure: async (_b: unknown, cfg: CaptureConfig) => { f.calls.push('measure:' + cfg.path); return { ...spec({}), measurements: { 'desktop:default': { error: 'no element' }, 'tablet:default': { error: 'no element' }, 'mobile:default': { error: 'no element' } } }; } };
  const result = await runCapture({ ...f.options, noCheck: true, only: ['sdc.demo.alpha'], maxPages: 3 }, adapters);
  assert.deepEqual(f.calls.filter(c => c.startsWith('measure:')), ['measure:/one', 'measure:/two', 'measure:/three']); assert.ok(result.problems.length);
});
test('setup script text changes retain the same semantic config digest', () => {
  const cfg = config(); cfg.states = [{ name: 'default', setup: '(a)', setupKey: { own: 'reveal' } }];
  assert.equal(configHash(cfg, 1), configHash({ ...cfg, states: [{ ...cfg.states[0]!, setup: '(() => a)()' }] }, 1));
  assert.notEqual(configHash(cfg, 1), configHash(cfg, 2));
  assert.equal(configHash(cfg, 1), '0ec3310eaae82ff180986930bf15cfb6d1076cef0cc7715a0e2acdb2afb9c03d');
  assert.equal(legacyHash(cfg, 1), '5243d51f24e97ffaa6a2fda4dda69e060d242d99015bd9de148df2d2ff5e70d0');
});
test('legacy script-text records upgrade without recapturing, including unselected components', async () => {
  const f = fixture(); await runCapture(f.options, f.adapters);
  const path = resolve(f.root, 'capture/records/sdc.demo.zeta.json');
  const record = JSON.parse(readFileSync(path, 'utf8')) as { configHash: string }; record.configHash = legacyHash(f.configs[1]!, 1); writeJson(path, record);
  const result = await runCapture({ ...f.options, only: ['sdc.demo.alpha'] }, { ...f.adapters, launch: async () => { throw new Error('must reuse'); } });
  assert.equal(Object.keys(result.captures).length, 2);
  assert.equal((JSON.parse(readFileSync(path, 'utf8')) as {configHash: string}).configHash, configHash(f.configs[1]!, 1));
});
test('a child prefers its own page over its parent page and retains its only example', () => {
  assert.deepEqual(firstExample({ examples: [{ path: '/parent' }, { path: '/own' }] }, new Set(['/parent'])), { path: '/own' });
  assert.deepEqual(firstExample({ examples: [{ path: '/only' }] }, new Set(['/only'])), { path: '/only' });
});
test('page pool is bounded, returns ordered results and checkpoints in completion order', async () => {
  let active = 0, peak = 0; const completed: number[] = [];
  const result = await pool([25, 1, 1, 1], 2, async (ms, i) => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, ms)); active--; return i; }, r => { completed.push(r); });
  assert.deepEqual(result, [0, 1, 2, 3]); assert.equal(peak, 2); assert.equal(completed[0], 1); assert.throws(() => concurrency(0)); assert.throws(() => concurrency(1.5));
});
test('item timeout closes contexts, preserves other work and rejects late context creation', async () => {
  let closed = 0;
  const browser = { newContext: async () => { await new Promise(r => setTimeout(r, 15)); return { close: async () => { closed++; } } as unknown as BrowserContext; } };
  await assert.rejects(isolated(browser, 5, async scoped => { await scoped.newContext(); return 1; }), /stopped after/);
  await new Promise(r => setTimeout(r, 30)); assert.equal(closed, 1);
  assert.equal(await isolated(browser, 100, async scoped => { await scoped.newContext(); return 2; }), 2); assert.equal(closed, 2);
});
test('qualified IDs isolate equal machine names', async () => {
  const f = fixture(); f.configs[0] = { ...config('block:card'), machineName: 'card' }; f.configs[1] = { ...config('paragraph:card'), machineName: 'card' };
  const result = await runCapture({ ...f.options, concurrency: 4 }, f.adapters);
  assert.equal(Object.keys(result.captures).length, 2); assert.ok(existsSync(resolve(f.root, 'capture/shots/block__card__desktop.png'))); assert.ok(existsSync(resolve(f.root, 'capture/shots/paragraph__card__desktop.png')));
});
test('tagged child subtree is rebased and crops keep backdrop overhang', async () => {
  const root = temporary(), image = resolve(root, 'parent.png'), out = resolve(root, 'child.png');
  await sharp({ create: { width: 100, height: 60, channels: 3, background: 'white' } }).png().toFile(image);
  const parent = node('/div[0]', 0, 0, 100, 60, { backgroundColor: 'rgb(255, 255, 0)' }), child = node('/div[0]/div[1]', -2, 20, 30, 20, {}, { attributes: { 'data-design-lab-child': 'paragraph:c' } }), text = node('/div[0]/div[1]/p[2]', 0, 22, 5, 5);
  const found = subtree(spec({ desktop: [parent, child, text], tablet: [parent, child, text], mobile: [parent, child, text] }), 'paragraph:c')!;
  assert.deepEqual(found[0]['desktop:default']!.nodes.map(n => [n.path, n.box.x, n.box.y]), [['/div[1]', 0, 0], ['/div[1]/p[2]', 2, 2]]);
  await cropChild(image, out, found[1]['desktop']!, 1, '#ffff00'); const result = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([result.info.width, result.info.height], [30, 20]); assert.deepEqual([...result.data.subarray(0, 3)], [255, 255, 0]); assert.deepEqual([...result.data.subarray(6, 9)], [255, 255, 255]);
});
test('nested signatures count site images, not capture surrogates', () => {
  const tree = mergeTree(); assert.deepEqual(signature(tree), [1, 1]);
  function mergeTree() { return { kind: 'frame' as const, name: 'x', source: '/x', sizing: 'FIXED', children: [{ kind: 'text' as const, name: 't', source: '/t', sizing: 'FIXED' }, { kind: 'image' as const, name: 'i', source: '/i', sizing: 'FIXED', src: '/site.png' }, { kind: 'image' as const, name: 'c', source: '/c', sizing: 'FIXED', src: 'capture:desktop:0,0,2,2' }] }; }
});
const render = (hook: string, name: string, body: string) => `<!-- THEME DEBUG -->\n<!-- THEME HOOK: '${hook}' -->\n<!-- FILE NAME SUGGESTIONS:\n * ${name}\n-->\n<!-- BEGIN OUTPUT from '${name}' -->\n${body}\n<!-- END OUTPUT from '${name}' -->`;
test('Twig suggestions use Drupal hyphens and preserve namespaces', () => {
  assert.deepEqual(twig.suggestion('paragraph:link_default'), ['paragraph', 'paragraph--link-default.html.twig']); assert.equal(twig.rootSelector('block:cards'), '[data-design-lab-root="block:cards"]');
});
test('Twig counts match bundle hook only', () => {
  const html = render('paragraph', 'paragraph--cards.html.twig', 'a') + render('paragraph', 'paragraph--cards.html.twig', 'b') + render('block', 'block--cards.html.twig', 'c');
  assert.ok(twig.enabled(html)); assert.equal(twig.enabled('<html></html>'), false); assert.equal(twig.count(html, 'paragraph:cards'), 2); assert.equal(twig.count(html, 'block:cards'), 1); assert.equal(twig.count(html, 'paragraph:text'), 0);
});
test('child renders count only within their own parent', () => {
  const child = render('paragraph', 'paragraph--child.html.twig', 'c'); const html = child + render('block', 'block--parent.html.twig', child + child);
  assert.deepEqual(twig.rendersWithin(html, 'block:parent', ['paragraph:child']), { parentRenders: 1, children: { 'paragraph:child': 2 } });
});
test('scaffold maps each marker to selector and reveal setup', () => {
  for (const [markerKind, marker, expected] of [['class', 'card', '.card'], ['id', 'id', '#id'], ['component', 'demo:card', '[data-component-id="demo:card"]'], ['template', 'paragraph--card.html.twig', '[data-design-lab-root="paragraph:card"]']]) {
    const c = scaffold({ components: [{ id: 'paragraph:card', usage: { examples: [{ path: '/x', markerKind, marker }] } }] }, { canonicalBaseUrl: 'https://public.test' })[0]!;
    assert.equal(c.rootSelector, expected); assert.ok(c['states']);
  }
});
test('selector extraction uses actual root, ignores SDC macros and custom comments', () => {
  const root = temporary(); mkdirSync(resolve(root, 'templates'), { recursive: true }); mkdirSync(resolve(root, 'components/card'), { recursive: true });
  writeFileSync(resolve(root, 'templates/paragraph--row.html.twig'), '<tr><td class="inner">x</td></tr>'); assert.equal(templateSelector(root, 'row')[0], null);
  writeFileSync(resolve(root, 'components/card/card.twig'), '{% macro a() %}<b class="wrong">x</b>{% endmacro %}<section class="card">x</section>'); assert.equal(sdcSelector(root, 'card')[0], '.card');
  writeFileSync(resolve(root, 'custom.yml'), 'template: custom.twig\n'); writeFileSync(resolve(root, 'custom.twig'), '{# <b class="wrong"> #}<div class="custom">'); assert.equal(customSelector(root, 'custom.yml')[0], '.custom');
});
test('nested children are built before parents, cycles remain bounded', async () => {
  const { childrenFirst } = await import('../../src/nesting.ts');
  const built = [{ id: 'parent' }, { id: 'child' }, { id: 'free' }];
  assert.deepEqual(childrenFirst(built, [{ id: 'parent', slots: [{ accepts: ['child'] }] }, { id: 'child', slots: [{ accepts: ['parent'] }] }]).map(b => b.id), ['child', 'parent', 'free']);
});
test('variant classes resolve options and synonyms', async () => {
  const { variantValues } = await import('../../src/nesting.ts'), options = (...values: string[]) => values.map(value => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));
  const out = variantValues([{ name: 'field_width', options: options('default', 'narrow') }, { name: 'field_alignment', options: options('left', 'right') }, { name: 'field_style', options: options('primary', 'secondary') }], [{ field: 'field_width', label: 'Width' }, { field: 'field_alignment', label: 'Alignment' }, { field: 'field_style', label: 'Style' }], [{ classes: ['block'] }, { classes: ['width-default', 'text-start', 'banner-secondary'] }]);
  assert.deepEqual(Object.fromEntries(out.map(v => [v.axis, v.value])), { Width: 'Default', Alignment: 'Left', Style: 'Secondary' });
});
test('ambiguous and unrelated generic variant words remain unknown', async () => {
  const { variantValues } = await import('../../src/nesting.ts');
  const out = variantValues([{ name: 'field_mask', options: [{ value: 'none', label: 'None' }, { value: 'circle', label: 'Circle' }] }, { name: 'field_shape', options: [{ value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }] }], [{ field: 'field_mask', label: 'Mask' }, { field: 'field_shape', label: 'Shape' }], [{ classes: ['d-none', 'circle', 'square'] }]);
  assert.equal(out[0]!.value, 'Circle'); assert.equal(out[1]!.value, null); assert.deepEqual(out[1]!.others, ['Circle', 'Square']);
});
