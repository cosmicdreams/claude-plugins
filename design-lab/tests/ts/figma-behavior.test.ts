import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../../src/render-payload.ts';
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;
interface Text { stack: string; family: string; weight: number; italic: boolean; characters?: string }
interface Font { family: string; style: string; variationSettings?: { wght: number } }
interface FontReport { missingFonts: string[]; standIns: Record<string, string>; styleFallbacks: Record<string, string>; iconText: Record<string, number> }
const text = (stack: string, weight: number, italic = false, characters?: string): Text => ({ stack, family: stack.split(',')[0]!.replaceAll('"', ''), weight, italic, ...(characters !== undefined ? { characters } : {}) });
async function fonts(plan: unknown, available: Record<string, string[]>, texts: Text[], axes: Record<string, unknown[]> = {}) {
  const renderer = new Renderer(), source = renderer.units.get('build_responsive')!, start = source.indexOf("/* ---- Fonts: the run's font plan"), section = source.slice(start, source.indexOf('const codeVars', start));
  const figma = { listAvailableFontsAsync: async () => Object.entries(available).flatMap(([family, styles]) => styles.map(style => ({ fontName: { family, style } }))), getFontFamilyVariationAxes: async (family: string) => axes[family] ?? null };
  const report: FontReport = { missingFonts: [], standIns: {}, styleFallbacks: {}, iconText: {} };
  const out = await new AsyncFunction('figma', 'ARGS', 'report', 'texts', `${renderer.units.get('_cache') ?? ''}\n${section}\nreturn await Promise.all(texts.map(resolveFont));`)(figma, { fonts: plan }, report, texts) as Font[];
  return { out, report };
}
const available = { Inter: ['Regular', 'SemiBold', 'Italic'], 'Source Serif 4': ['Regular', 'Italic'], Arial: ['Regular'], Assistant: ['Regular'] };
const plan = { families: {
  suisseintl: { family: 'Inter', standIn: true, faces: { '500|0': 'SemiBold', '700|0': 'SemiBold' }, variable: {}, display: "Suisse Int'l" },
  freighttextpro: { family: 'Source Serif 4', standIn: true, faces: {}, variable: {}, display: 'Freight Text Pro' },
  assistant: { family: 'Assistant', standIn: false, faces: {}, variable: { '450|0': 450 } },
}, stacks: { "\"Suisse Int'l\", sans-serif": { family: "Suisse Int'l" }, 'freight-text-pro, serif': { family: 'freight-text-pro' }, 'Poppins, Arial, sans-serif': { family: 'Arial' }, 'Assistant, sans-serif': { family: 'Assistant' } } };
test('KEEP missing family draws its planned stand-in and served face', async () => {
  const r = await fonts(plan, available, [text("\"Suisse Int'l\", sans-serif", 500), text("\"Suisse Int'l\", sans-serif", 700), text('freight-text-pro, serif', 400, true)]);
  assert.deepEqual(r.out.map(f => [f.family, f.style]), [['Inter', 'SemiBold'], ['Inter', 'SemiBold'], ['Source Serif 4', 'Italic']]);
  assert.deepEqual(r.report.standIns, { "Suisse Int'l": 'Inter', 'Freight Text Pro': 'Source Serif 4' });
});
test('KEEP installed real family uses the served face rather than nearest weight', async () => {
  const p = structuredClone(plan); p.families.suisseintl.family = 'Suisse Intl Trial'; p.families.suisseintl.standIn = false;
  const r = await fonts(p, { ...available, 'Suisse Intl Trial': ['Regular', 'Medium', 'Semibold', 'Bold'] }, [text("\"Suisse Int'l\", sans-serif", 500)]);
  assert.deepEqual(r.out[0], { family: 'Suisse Intl Trial', style: 'Semibold' }); assert.deepEqual(r.report.missingFonts, []);
});
test('KEEP unserved first family is skipped and variable weight 450 remains exact', async () => {
  const r = await fonts(plan, available, [text('Poppins, Arial, sans-serif', 400), text('Assistant, sans-serif', 450)], { Assistant: [{ tag: 'wght', min: 200, max: 800 }] });
  assert.equal(r.out[0]!.family, 'Arial'); assert.deepEqual(r.out[1]!.variationSettings, { wght: 450 });
});
test('KEEP names match without a plan and style loss is reported', async () => {
  const r = await fonts(null, { 'Articulat CF': ['Regular', 'Bold'], Inter: ['Regular'] }, [text('articulat-cf', 600)]);
  assert.equal(r.out[0]!.family, 'Articulat CF'); assert.ok('articulat-cf 600' in r.report.styleFallbacks);
});
test('KEEP Heavy and Black remain distinct drawable faces', async () => {
  const r = await fonts({ families: { brand: { family: 'Brand', faces: { '900|0': 'Black' } } }, stacks: { Brand: { family: 'Brand' } } }, { Brand: ['Heavy', 'Black'] }, [text('Brand', 900)]);
  assert.equal(r.out[0]!.style, 'Black');
});
test('KEEP icon text is counted without an ordinary missing-font warning', async () => {
  const r = await fonts({ families: {}, stacks: { icomoon: { icon: 'icomoon' } } }, available, [text('icomoon', 400, false, '\ue900')]);
  assert.deepEqual(r.report.missingFonts, []); assert.deepEqual(r.report.iconText, { icomoon: 1 });
});
test('KEEP characters outside a face range use the next family', async () => {
  const r = await fonts({ families: {}, stacks: { 'Latin, Arial': { family: 'Latin', ranges: [[0, 255]], otherwise: 'Arial' } } }, { Latin: ['Regular'], Arial: ['Regular'] }, [text('Latin, Arial', 400, false, 'Шалом'), text('Latin, Arial', 400, false, 'Hello')]);
  assert.deepEqual(r.out.map(f => f.family), ['Arial', 'Latin']);
});
test('KEEP cover shares total the bar width and preserve zero categories', async () => {
  const source = new Renderer().units.get('cover')!, helpers = source.slice(source.indexOf('/* BEGIN bar helpers'), source.indexOf('/* END bar helpers */'));
  for (const [values, width] of [[[3, 0, 17, 9], 1280], [[1, 1, 1], 100], [[5], 1280], [[0, 0, 0, 0], 1280], [[50, 7, 13, 1], 997]] as [number[], number][]) {
    const widths = await new AsyncFunction('values', 'width', helpers + '\nreturn barWidths(values, width);')(values, width) as number[], total = values.reduce((a, b) => a + b, 0);
    assert.equal(widths.reduce((a, b) => a + b, 0), total ? width : 0);
    values.forEach((v, i) => { if (total) assert.ok(Math.abs(widths[i]! - v / total * width) < 1); if (!v) assert.equal(widths[i], 0); });
  }
});
for (const set of [false, true]) test(`KEEP native rebuild preserves ${set ? 'variant set' : 'master'} and consumer identities`, async () => {
  const source = new Renderer().units.get('build_responsive')!, body = source.slice(source.indexOf('/* ---- The master:'));
  const harness = `
const nodes = new Map(); let created = 0;
function node(id, type, name) {
 const n = {id, type, name, children: [], width: 100, height: 50, parent: null,
  appendChild(c) { if(c.parent) c.parent.children = c.parent.children.filter(x=>x!==c); this.children.push(c); c.parent=this; },
  remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);},
  resize(w,h){this.width=w;this.height=h;}, resizeWithoutConstraints(w,h){this.resize(w,h);}, setSharedPluginData(){}};
 nodes.set(id,n); return n;
}
const page = node('page','PAGE','Page'); const block=node('block','FRAME','Block');page.appendChild(block);
const master=node('master','COMPONENT','Hero');block.appendChild(master);const consumer={mainComponent:master};
const owner = SET ? node('set','COMPONENT_SET','Hero') : master;
if(SET){block.appendChild(owner);owner.appendChild(master);master.name='Theme=Default';}
const figma={getNodeByIdAsync:async id=>nodes.get(id),createComponent:()=>{created++;return node('new'+created,'COMPONENT','new');},combineAsVariants:()=>{throw Error('must preserve existing set');}};
const ARGS={existingComponentId:owner.id,name:'Hero',id:'hero',x:0,y:0,tree:{width:100,height:50,children:[]},variant:SET?{Theme:'Default'}:{}};
const col={id:'core'};const report={};const num=x=>x;const isVar=()=>false;
const style=()=>{};const layout=()=>{};const bind=()=>{};const build=async()=>{};
const result = await (async()=>{ BODY })();
return {id:result.componentId,variant:result.variantId,consumer:consumer.mainComponent.id,removed:!!master.removed,created};`;
  const result = await new AsyncFunction('SET', harness.replace('BODY', body))(set);
  assert.deepEqual(result, { id: set ? 'set' : 'master', variant: 'master', consumer: 'master', removed: false, created: 0 });
});
