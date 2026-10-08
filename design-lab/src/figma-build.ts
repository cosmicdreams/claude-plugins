import type { TemplateArgs } from './figma/payload-types.ts';
import { isEntrypoint } from './entrypoint.ts';
/** In-process, resumable deterministic library driver; baseline is the migration oracle. */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Renderer, LIMIT } from './render-payload.ts';
import { build as responsive } from './responsive.ts';
import { childrenFirst, signature, subtree } from './nesting.ts';
import { visible } from './spec-to-tree.ts';
import { fetchImages } from './fetch-images.ts';
import { sharedRequire } from './runtime.ts';
import { validateRunnerRecord, assertValid } from './contracts.ts';
import type { Project } from './generated/project.ts';
import { load, result, safe, writeArtifactOnChange, keyOf } from './build-artifacts.ts';
import type { BuildState, BuildResult, Geometry, GeometryBox, Component } from './build-artifacts.ts';
import type { Spec } from './generated/spec.ts';
import type { Tree } from './generated/tree.ts';
import type { RunnerStep } from './generated/runner-step.ts';
import * as content from './build-content.ts';
import * as lc from './library-counts.ts';
import { compare } from './figma-compare.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
export interface InitOptions { fileKey: string; siteUrl: string; canonicalBaseUrl: string; only?: string; rebuild?: boolean; offlineImages?: boolean; iterate?: boolean }
export interface DriverOptions { runner?: boolean; today?: () => string; renderer?: Renderer; timings?: boolean; imageFetcher?: typeof fetchImages }
export const pending = (state: BuildState): { id: string } | null => state.steps.find(s => !state.done.includes(s.id)) ?? null;
export function specFileFor(measurements: string, c: Component): string | null {
  for (const name of [c.id.replace(/[:/]/g, '__'), c.machineName || c.id.split(':').at(-1)!]) { const f = resolve(measurements, name + '.spec.json'); if (existsSync(f)) return f; } return null;
}
export function buildTrees(project: string, trees: string, only?: string): { id: string }[] {
  mkdirSync(trees, { recursive: true }); const comps = content.components(project), plan = content.plans(project), measurements = resolve(project, 'capture/measurements'), built: { id: string }[] = [];
  for (const c of content.buildOrder(comps)) {
    if (plan[c.id]?.verdict !== 'build' || only && !only.split(',').includes(c.id)) continue;
    const f = specFileFor(measurements, { ...c, machineName: c.machineName || c.id.split(':').at(-1)!.split('.').at(-1)! }); if (!f) continue;
    const spec = JSON.parse(readFileSync(f, 'utf8')) as Spec, source = spec.source?.sourceRef;
    if (c.sourceRef && source && source !== c.sourceRef) continue;
    let tree: Tree;
    try { tree = responsive(spec, c.label || c.id, c.id.split('.').at(-1)!); }
    catch (error) { if (error instanceof Error && /missing root|no usable|no measurement|no nodes|root measurement/.test(error.message)) continue; throw error; }
    writeArtifactOnChange('tree', resolve(trees, c.id + '.json'), tree); built.push({ id: c.id });
  }
  const by = new Map(comps.map(c => [c.id, c])), ids = built.map(b => b.id);
  for (const child of ids) {
    const tree = load<Tree>(trees, child + '.json'), seen = new Set([keyOf(signature(tree.tree))]), alternates: NonNullable<Tree['alternates']> = [];
    for (const parent of ids) {
      if (child === parent || !(by.get(parent)?.slots ?? []).some(s => (typeof s.accepts === 'string' ? [...s.accepts] : s.accepts ?? []).includes(child))) continue;
      const f = specFileFor(measurements, by.get(parent)!), found = f ? subtree(JSON.parse(readFileSync(f, 'utf8')) as Spec, child) : null; if (!found) continue;
      let alt: Tree; try { alt = responsive({ measurements: found[0] } as Spec, by.get(child)!.label || child, `${child.split(':').at(-1)}@${parent.split(':').at(-1)}`); } catch (error) { if (error instanceof Error && /missing root|no usable|no measurement|no nodes/.test(error.message)) continue; throw error; }
      const sig = keyOf(signature(alt.tree)); if (seen.has(sig)) continue; seen.add(sig); alternates.push({ label: `In ${by.get(parent)!.label || parent}`, parent, variables: alt.variables, tree: alt.tree });
    }
    if (alternates.length) tree.alternates = alternates; else delete tree.alternates; writeArtifactOnChange('tree', resolve(trees, child + '.json'), tree);
  }
  return built;
}
export function textMasks(project: string, cid: string, geo: Geometry): GeometryBox[][] | null {
  const f = resolve(project, `capture/measurements/${cid.replace(/[:/]/g, '__')}.spec.json`); if (!existsSync(f)) return null;
  const spec = JSON.parse(readFileSync(f, 'utf8')) as Spec;
  return (geo.variants ?? []).map(v => { const bp = /\b(Desktop|Tablet|Mobile)\b/i.exec(v.label ?? '')?.[1]?.toLowerCase() ?? 'desktop', measurement = spec.measurements[bp + ':default'], nodes = measurement && 'nodes' in measurement ? measurement.nodes : []; return (Array.isArray(nodes) ? nodes : []).filter(n => (n.text || n.inlineText) && visible(n)).map(n => n.box); });
}
export async function cropCapture(src: string, shots: Record<string, string>, out: string) {
  const [, bp, box] = /^capture:([^:]+):(.*)$/.exec(src) ?? []; if (!bp || !box) throw new Error('invalid capture source: ' + src);
  const shot = shots[bp]; if (!shot) return null;
  const [x, y, w, h] = box.split(',').map(Number); if ([x, y, w, h].some(v => v === undefined || !Number.isFinite(v))) throw new Error('invalid crop coordinates');
  const left = Math.trunc(x!), top = Math.trunc(y!), right = Math.trunc(x! + w! + 0.999), bottom = Math.trunc(y! + h! + 0.999), width = right - left, height = bottom - top;
  if (width <= 0 || height <= 0) throw new Error('invalid crop dimensions');
  // Pillow pads out-of-bounds crop pixels with transparent black for RGBA inputs.
  const img = await sharp(shot).raw().toBuffer({ resolveWithObject: true }), channels = img.info.channels;
  const data = Buffer.alloc(width * height * channels);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) if (left + i >= 0 && top + j >= 0 && left + i < img.info.width && top + j < img.info.height) img.data.copy(data, (j * width + i) * channels, ((top + j) * img.info.width + left + i) * channels, ((top + j) * img.info.width + left + i + 1) * channels);
  mkdirSync(out, { recursive: true }); const file = resolve(out, `crop-${bp}-${Math.trunc(x!)}-${Math.trunc(y!)}-${Math.trunc(w!)}-${Math.trunc(h!)}.png`); await sharp(data, { raw: { width, height, channels } }).png().toFile(file); return { file, contentType: 'image/png' };
}
export class BuildDriver {
  readonly project: string;
  readonly options: DriverOptions;
  private stateCache: BuildState | undefined;
  private stateStamp = '';
  private renderer: Renderer;
  private recordTail: Promise<unknown> = Promise.resolve();
  private issued: { stamp: string; step: RunnerStep } | undefined;
  constructor(project: string, options: DriverOptions = {}) { this.project = resolve(project); this.options = options; this.renderer = options.renderer ?? new Renderer(); }
  private get statePath(): string { return resolve(this.project, 'figma/state.json'); }
  private stamp(): string { const s = statSync(this.statePath, { bigint: true }); return `${s.mtimeNs}:${s.size}:${s.ino}`; }
  state(): BuildState {
    const stamp = this.stamp(); if (!this.stateCache || stamp !== this.stateStamp) { const state: unknown = load(this.project, 'figma/state.json'); assertValid('figma-state', state); if (!('steps' in state)) throw new Error('build has not been initialized'); this.stateCache = state; this.stateStamp = stamp; } return structuredClone(this.stateCache);
  }
  private save(state: BuildState): void { writeArtifactOnChange('figma-state', this.statePath, state); this.stateCache = structuredClone(state); this.stateStamp = this.stamp(); }
  private today(): string { return this.options.today?.() ?? new Date().toLocaleDateString('en-CA'); }
  private timing(step: string, phase: string, ms: number): void { if (this.options.timings === false) return; appendFileSync(resolve(this.project, 'figma/timings.jsonl'), JSON.stringify({ step, phase, ms }) + '\n'); }
  init(o: InitOptions) {
    if (!this.options.renderer) this.renderer = new Renderer();
    const project = this.project, out = resolve(project, 'figma'), previous = load<Partial<BuildState>>(project, 'figma/state.json', {});
    if (o.only) {
      if (o.rebuild) throw new Error('--only cannot be combined with --rebuild');
      if (previous.fileKey !== o.fileKey || !previous.steps?.length) throw new Error('--only needs an existing build in this run\'s target file');
      const selected = new Set(o.only.split(',')), planned = lc.plannedIds(previous); if ([...selected].some(id => !planned.includes(id))) throw new Error('--only must name components already in this library\'s build plan');
      let size = -1; while (size !== selected.size) { size = selected.size; for (const c of content.components(project)) if (planned.includes(c.id) && c.slots.some(s => (typeof s.accepts === 'string' ? [...s.accepts] : s.accepts ?? []).some(child => selected.has(child)))) selected.add(c.id); }
      for (const cid of [...selected].sort()) if (!load<BuildResult>(project, `figma/results/${safe('build:' + cid)}.json`, {}).componentId) throw new Error(`missing saved master identity for ${cid}; rebuild in a fresh file`);
      const built = buildTrees(project, resolve(out, 'trees'), [...selected].sort().join(',')); if (keyOf(built.map(b => b.id).sort()) !== keyOf([...selected].sort())) throw new Error('subset has missing measurements or is no longer buildable; keep the current library and rebuild in a fresh file');
      const refreshed = new Set(['cover', 'getting-started', 'examples', ...[...selected].flatMap(cid => ['build', 'images', 'block', 'evidence', 'compare'].map(p => p + ':' + cid))]), state = { ...previous, runtime: this.renderer.runtimeHash(), buildId: process.hrtime.bigint().toString(), subset: [...selected].sort(), done: previous.done!.filter(s => !refreshed.has(s)) } as BuildState;
      const completion = resolve(project, 'benchmark/completion.md'); if (existsSync(completion)) renameSync(completion, resolve(project, `benchmark/completion-before-subset-${process.hrtime.bigint()}.md`));
      this.save(state);
      const manifest = load<Project>(project, 'project.json');
      for (const p of ['components', 'index', 'verify', 'benchmark']) (manifest.phases ??= {})[p] = { status: p === 'components' ? 'running' : 'pending' };
      manifest.artifacts = Object.fromEntries(Object.entries(manifest.artifacts ?? {}).filter(([n, a]) => ![...selected].map(cid => 'build:' + cid).includes(n) && !['index', 'verify-report'].includes(a.kind ?? ''))); writeArtifactOnChange('project', resolve(project, 'project.json'), manifest);
      return { steps: state.steps.length, components: selected.size, subset: [...selected].sort() };
    }
    if (o.rebuild) {
      if (previous.fileKey !== o.fileKey) throw new Error('--rebuild needs an earlier build of this run in the same file');
      for (const folder of ['results', 'payloads', 'trees', 'compare', 'verify', 'dump']) { const f = resolve(out, folder); for (const n of existsSync(f) ? readdirSync(f) : []) if (statSync(resolve(f, n)).isFile()) unlinkSync(resolve(f, n)); }
      const builds = resolve(project, 'builds'); for (const n of existsSync(builds) ? readdirSync(builds) : []) if (n.endsWith('.json') && statSync(resolve(builds, n)).isFile()) unlinkSync(resolve(builds, n));
    }
    for (const f of ['results', 'payloads', 'trees']) mkdirSync(resolve(out, f), { recursive: true });
    const comps = content.components(project), built = buildTrees(project, resolve(out, 'trees'));
    const steps = [...(o.rebuild ? ['wipe'] : []), 'pages', 'variables', ...content.foundationDomains(project).map(d => 'foundation:' + d), ...content.tierNames(comps).map(t => 'tier:' + t), ...childrenFirst(built, comps.map(c => ({ id: c.id, slots: c.slots.map(s => ({ accepts: typeof s.accepts === 'string' ? [...s.accepts] : s.accepts ?? [] })) }))).flatMap(b => ['build', 'images', 'block', 'evidence', 'compare'].map(p => p + ':' + b.id)), ...(existsSync(resolve(project, 'compositions.json')) ? ['examples'] : []), 'cover', 'getting-started'].map(id => ({ id }));
    const state: BuildState = { standardVersion: content.STANDARD_VERSION, fileKey: o.fileKey, siteUrl: o.siteUrl.replace(/\/+$/, ''), canonicalBaseUrl: o.canonicalBaseUrl.replace(/\/+$/, ''), runtime: this.renderer.runtimeHash(), offlineImages: !!o.offlineImages || existsSync(resolve(project, 'corpus.json')), planned: built.map(b => b.id), steps, done: [], emittedCollections: [...new Set([...content.emittedCollections(project), ...(o.rebuild ? previous.emittedCollections ?? [] : [])])].sort(), iterate: !!o.iterate || !!previous.iterate && !!o.rebuild };
    const target = load<{ target?: { connection?: { coverPageId?: string; fileKey?: string }; preflight?: { coverPageId?: string; fileKey?: string } } }>(project, 'project.json', {}).target, connection = target?.connection ?? target?.preflight;
    if (connection?.coverPageId && connection.fileKey === o.fileKey) state.preflightCover = connection.coverPageId;
    state['buildId'] = process.hrtime.bigint().toString();
    this.save(state); return { steps: steps.length, components: built.length, runtime: state.runtime };
  }
  private payload<K extends keyof TemplateArgs>(sid: string, template: K, args: TemplateArgs[K]): RunnerStep {
    const code = this.renderer.call(template, args), characters = [...code].length;
    if (characters > LIMIT && !this.options.runner) throw new Error(`${sid}: payload ${characters} characters exceeds ${LIMIT}`);
    const path = resolve(this.project, `figma/payloads/${safe(sid)}.js`);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== code) writeFileSync(path, code);
    return { kind: 'use_figma', step: sid, payload: path, characters };
  }
  async next(): Promise<RunnerStep> {
    const started = performance.now(), state = this.state(), step = pending(state); if (!step) return { kind: 'done' };
    // Re-read template bytes to detect an edited runtime, while keeping the cached renderer
    // for assembly. Never silently mix runtimes in an active build.
    if (!this.options.renderer && new Renderer().runtimeHash() !== state.runtime || this.renderer.runtimeHash() !== state.runtime) throw new Error('the renderer changed since init; re-run init so every step uses one runtime');
    const sid = step.id, at = sid.indexOf(':'), head = at < 0 ? sid : sid.slice(0, at), rest = at < 0 ? '' : sid.slice(at + 1), project = this.project; let out: RunnerStep;
    if (sid === 'wipe') out = this.payload(sid, 'wipe', { fileKey: state.fileKey, collections: [...new Set([...content.emittedCollections(project), ...state.emittedCollections ?? [], ...content.legacyCollections(project)])].sort() });
    else if (sid === 'pages') out = this.payload(sid, 'pages', { pages: content.pageList(project) });
    else if (sid === 'variables') out = this.payload(sid, 'variables', content.variablesArgs(project));
    else if (sid === 'cover') out = this.payload(sid, 'cover', content.coverArgs(project, state, this.today()));
    else if (head === 'foundation') out = rest === 'Brand Voice & Language' ? this.payload(sid, 'voice', content.voiceArgs(project)) : this.payload(sid, 'foundation', content.foundationArgs(project, rest));
    else if (sid === 'examples') out = this.payload(sid, 'examples', content.examplesArgs(project, state));
    else if (head === 'tier') out = this.payload(sid, 'tier_page', content.tierArgs(project, state, rest));
    else if (head === 'build') out = this.payload(sid, 'build_responsive', content.buildArgs(project, rest, state));
    else if (head === 'images') out = await this.imagesStep(sid, rest, state);
    else if (head === 'block') out = this.payload(sid, 'component_block', await content.blockArgs(project, state, rest, lc.plannedIds(state).indexOf(rest)));
    else if (head === 'evidence') {
      const ev = await content.evidenceCaptures(project, rest, content.treeFor(project, rest)), ids = result(project, 'block:' + rest).evidenceIds!;
      if (ids.length !== ev.length) throw new Error(`${sid}: the block drew ${ids.length} capture rectangles but ${ev.length} captures match its columns; re-run the block step`);
      out = { kind: 'upload', step: sid, nodeIds: ids, scaleMode: 'FILL', files: ev.map(e => ({ file: e.file, contentType: 'image/png' })) };
    } else if (head === 'compare') {
      const block = result(project, 'block:' + rest), geo = block.geometry;
      if (!geo?.captures?.length) out = { kind: 'skip', step: sid, reason: 'no geometry or captures to compare' };
      else { const path = resolve(project, `figma/compare/${safe(rest)}.png`); mkdirSync(resolve(project, 'figma/compare'), { recursive: true }); out = { kind: 'screenshot', step: sid, nodeId: block.specimenId!, maxDimension: Math.trunc(Math.max(geo.specimen!.width, geo.specimen!.height) + 1), out: path }; }
    } else if (sid === 'getting-started') out = this.payload(sid, 'getting_started', content.gettingStartedArgs(project, state, this.today()));
    else throw new Error('unknown step ' + sid);
    assertValid('runner-step', out); this.issued = { stamp: this.stateStamp, step: out }; this.timing(sid, 'next', performance.now() - started); return out;
  }
  async imagesStep(sid: string, cid: string, state: BuildState): Promise<RunnerStep> {
    const out = resolve(this.project, 'figma/images', cid.split('.').at(-1)!), fetched = await (this.options.imageFetcher ?? fetchImages)(content.treeFor(this.project, cid), { out, baseUrl: state.siteUrl, fallbackBaseUrl: state.canonicalBaseUrl, offline: state.offlineImages || existsSync(resolve(this.project, 'corpus.json')) }), manifest = new Map(fetched.map(m => [m.src, m])), shots = Object.fromEntries((await content.captureImages(this.project, cid)).map(e => [e.viewport.toLowerCase(), e.file]));
    const images = result(this.project, 'build:' + cid).images ?? [], nodeIds: string[] = [], files: { file: string; contentType: string }[] = [], modes = new Set<string>();
    for (const img of images) { const m = img.src.startsWith('capture:') ? await cropCapture(img.src, shots, out) : manifest.get(img.src); if (m?.file) { nodeIds.push(img.id); files.push({ file: m.file, contentType: m.contentType! }); modes.add(img.fit ?? 'FILL'); } }
    return nodeIds.length ? { kind: 'upload', step: sid, nodeIds, files, scaleMode: modes.size === 1 && modes.has('FIT') ? 'FIT' : 'FILL' } : { kind: 'skip', step: sid, reason: images.length ? 'no image could be fetched' : 'no images' };
  }
  /** Records internal driver results. Wire screenshot png is decoded by recordScreenshot. */
  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.recordTail.then(fn, fn); this.recordTail = result.then(() => undefined, () => undefined); return result;
  }
  record(sid: string, data: BuildResult = {}) { return this.mutate(() => this.recordImpl(sid, data)); }
  private async recordImpl(sid: string, data: BuildResult = {}) {
    const started = performance.now(), state = this.state(), step = pending(state), originalStamp = this.stateStamp;
    if (step?.id !== sid) throw new Error(`expected to record ${step?.id ?? 'nothing'}, got ${sid}`);
    const head = sid.split(':')[0]!, required: Record<string, string> = { wipe: 'removedPages', pages: 'pages', block: 'blockId', build: 'componentId' }, key = required[head];
    if (key && !(key in data)) throw new Error(`${sid}: result has no ${key}; not recording a failed step`);
    if (sid === 'pages') { if (data.foreign?.length) throw new Error('pages: the file holds pages design-lab did not create (' + data.foreign.join(', ') + '); the build needs an empty file, or one holding only this run\'s initial Cover'); if (state.preflightCover && data.pages?.['Cover'] !== state.preflightCover) throw new Error('pages: the build must fill in the initial Cover, not add another'); }
    const expected = this.issued?.stamp === this.stateStamp && this.issued.step.step === sid ? this.issued.step : await this.next();
    if (head === 'compare' && data.file) {
      if (expected.kind !== 'screenshot') throw new Error('expected an empty skipped comparison'); const cid = sid.slice(sid.indexOf(':') + 1), geo = result(this.project, 'block:' + cid).geometry!; data = { file: data.file, ...await compare(data.file, geo, true, textMasks(this.project, cid, geo)) }; }
    else {
      const kind = expected.kind;
      if (kind === 'done' || kind === 'wait' || kind === 'check' || kind === 'dump' || kind === 'screenshot') throw new Error(`cannot record ${kind} without its expected result`);
      const errors = validateRunnerRecord(kind, data); if (errors.length) throw new Error(`${sid}: invalid ${kind} result:\n${errors.join('\n')}`);
    }
    if (this.stamp() !== originalStamp) throw new Error('build state changed while recording; retry against the current build');
    writeArtifactOnChange('step-result', resolve(this.project, `figma/results/${safe(sid)}.json`), data);
    state.done.push(sid);
    if (!['skip', 'screenshot'].includes(expected.kind)) state['executionRevision'] = randomUUID();
    this.save(state); this.timing(sid, 'record', performance.now() - started);
    return { recorded: sid, remaining: state.steps.length - state.done.length };
  }
  recordScreenshot(sid: string, data: unknown) { return this.mutate(async () => {
    const errors = validateRunnerRecord('screenshot', data); if (errors.length) throw new Error(errors.join('\n'));
    const step = await this.next(); if (step.kind !== 'screenshot' || step.step !== sid) throw new Error('expected screenshot step');
    const png = Buffer.from((data as { png: string }).png, 'base64'); await sharp(png).metadata(); writeFileSync(step.out, png); return this.recordImpl(sid, { file: step.out });
  }); }
  status() { const s = this.state(); return { done: s.done.length, total: s.steps.length, next: pending(s)?.id ?? null, planned: lc.plannedIds(s).length, built: lc.recordedIds(s).size, runtime: s.runtime }; }
}
export async function main(args = process.argv.slice(2)): Promise<number> {
  const cmd = args[0], value = (flag: string): string | undefined => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; }, project = value('--project'); if (!project) throw new Error('--project is required');
  const d = new BuildDriver(project, { runner: !!process.env['DESIGN_LAB_RUNNER'] }); let out: unknown;
  if (cmd === 'init') { const fileKey = value('--file-key'), siteUrl = value('--site-url'), canonicalBaseUrl = value('--canonical-base-url'); if (!fileKey || !siteUrl || !canonicalBaseUrl) throw new Error('--file-key, --site-url, --canonical-base-url are required'); out = d.init({ fileKey, siteUrl, canonicalBaseUrl, ...(value('--only') !== undefined ? { only: value('--only')! } : {}), rebuild: args.includes('--rebuild'), offlineImages: args.includes('--offline-images'), iterate: args.includes('--iterate') }); }
  else if (cmd === 'next') out = await d.next();
  else if (cmd === 'record') { const sid = value('--step'); if (!sid) throw new Error('--step is required'); out = await d.record(sid, value('--result') ? JSON.parse(readFileSync(value('--result')!, 'utf8')) as BuildResult : {}); }
  else if (cmd === 'status') out = d.status();
  else if (cmd === 'receipts') { const { receipts } = await import('./figma-receipts.ts'); out = receipts(project); console.log(JSON.stringify(out)); return Object.keys((out as { invalid: object }).invalid).length ? 1 : 0; }
  else throw new Error('usage: figma-build.ts init|next|record|receipts|status --project RUN');
  console.log(JSON.stringify(out)); return 0;
}
if (isEntrypoint(import.meta.url)) process.exitCode = await main();
