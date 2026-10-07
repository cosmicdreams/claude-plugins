import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { compact, parseColor, px as cssPixels } from './spec-to-tree.ts';
import { variantValues } from './nesting.ts';
import { roundEven } from './json.ts';
import { sharedRequire } from './runtime.ts';
import { load, result, safe, nullable, keyOf, jsonFiles } from './build-artifacts.ts';
import type { Component, ComponentPlan, BuildState } from './build-artifacts.ts';
import type { Tree, Text, TreeNode } from './generated/tree.ts';
import type { Spec } from './generated/spec.ts';
import type { VariableCollection, PlannedVariable } from './generated/variable-plan.ts';
import type { CaptureEvidence } from './generated/capture-evidence.ts';
import type { Fonts } from './generated/fonts.ts';
import * as lc from './library-counts.ts';
const sharp = sharedRequire()('sharp') as typeof import('sharp').default;
export const STANDARD_VERSION = '4.1.0';
export const VIEWPORTS: Record<string, number> = { Desktop: 1400, Tablet: 800, Mobile: 375 };
export const COLUMN_ORDER = ['Mobile', 'Tablet', 'Desktop'];
export const BREAKPOINTS = ['mobile', 'tablet', 'desktop'];
export const FOUNDATION_ORDER = ['Color', 'Typography', 'Spacing & Layout', 'Elevation & Shape'];
export function components(project: string): Component[] {
  const captures = load<Pick<CaptureEvidence, 'captures'>>(project, 'capture-evidence.json', { captures: {} }).captures;
  return load<{ components: Component[] }>(project, 'components.json').components.map(c => {
    const ev = captures[c.id]; return ev?.path && ev.selector?.includes('data-design-lab-child') ? { ...c, _capturePath: ev.path } : c;
  });
}
export const plans = (project: string): Record<string, ComponentPlan> => Object.fromEntries(load<{ plans: ComponentPlan[] }>(project, 'plan.json', { plans: [] }).plans.map(p => [p.id, p]));
export const treeFor = (project: string, cid: string): Tree => load(project, `figma/trees/${cid}.json`);
export const componentPage = (c: Component): string => `Components — ${lc.shortTier(c.usage?.tier)}`;
export const pageId = (project: string, name: string): string => result(project, 'pages').pages![name]!;
export const brand = (project: string): string => (load<{ run?: { siteLabel?: string } }>(project, 'project.json', {}).run?.siteLabel ?? '').trim();
export const coreCollection = (project: string): string => `${brand(project)} Core`.trim();
export function breakpointCollection(project: string): string {
  const state = load<Partial<BuildState>>(project, 'figma/state.json', {}), label = brand(project), legacy = label ? `${label} Breakpoint` : 'Core Breakpoint';
  return state.subset?.length && state.emittedCollections?.includes(legacy) ? legacy : coreCollection(project);
}
export const modeNames = (): Record<string, string> => Object.fromEntries(Object.entries(VIEWPORTS).map(([role, width]) => [role, `${role} ${width}px`]));
export function tierNames(comps: Component[]): string[] {
  const tiers = new Set(comps.map(c => lc.shortTier(c.usage?.tier)));
  return [...tiers].every(t => t === 'Untiered') ? ['Untiered'] : [...lc.TIERS, ...(tiers.has('Untiered') ? ['Untiered'] : [])];
}
export function buildOrder(comps: Component[]): Component[] {
  const rank = (c: Component) => { const i = lc.TIERS.indexOf(lc.shortTier(c.usage?.tier)); return i < 0 ? lc.TIERS.length : i; };
  return [...comps].sort((a, b) => rank(a) - rank(b) || lc.placements(b) - lc.placements(a) || lc.structural(b) - lc.structural(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function examplePath(c: Component): string | null {
  if (c._capturePath && !c.usage?.examples?.length && !c.usage?.renderedExamples?.length) return c._capturePath;
  for (const key of ['examples', 'renderedExamples', 'exampleCandidates'] as const) { const v = c.usage?.[key]?.[0]; if (v) return typeof v === 'string' ? v : v.path; }
  return null;
}
export const variablePlan = (project: string): Record<string, VariableCollection> => load<{ collections: Record<string, VariableCollection> }>(project, 'variable-plan.json', { collections: {} }).collections;
export function foundationDomains(project: string): string[] {
  const vars = Object.values(variablePlan(project)).flatMap(c => c.variables), names = vars.map(v => v.name), out = [];
  if (vars.some(v => v.type === 'COLOR')) out.push('Color');
  if (names.some(n => n.startsWith('Typography/')) || existsSync(resolve(project, 'capture/measurements'))) out.push('Typography');
  if (names.some(n => n.startsWith('Spacing/'))) out.push('Spacing & Layout');
  if (names.some(n => /^(Shape|Elevation|Radius)\//.test(n))) out.push('Elevation & Shape');
  if (existsSync(resolve(project, 'voice.json'))) out.push('Brand Voice & Language');
  return out;
}
export const pageList = (project: string): string[] => ['Cover', 'Getting Started', ...foundationDomains(project).map(d => `Foundations — ${d}`), ...tierNames(components(project)).map(t => `Components — ${t}`), ...(existsSync(resolve(project, 'compositions.json')) ? ['Examples'] : [])];
const SITE_STUDIO_MIN: Record<string, number> = { xxl: 1600, xl: 1170, lg: 1024, md: 768, sm: 565, xs: 0 };
const length = '([\\d.]+)(px|rem|em)';
const feature = new RegExp('^(min|max)-width\\s*:\\s*' + length + '$');
const range = new RegExp('^(?:' + length + '\\s*(<=|<|>=|>)\\s*)?width(?:\\s*(<=|<|>=|>)\\s*' + length + ')?$');
const px = (n: string, unit: string): number => Number(n) * (['em', 'rem'].includes(unit) ? 16 : 1);
const compare = (width: number, op: string, n: number): boolean => ({ '<': width < n, '<=': width <= n, '>': width > n, '>=': width >= n })[op]!;
export function mediaApplies(condition: string, width: number): boolean | null {
  const text = condition.trim().replace(/^@media\s+/i, ''); if (!text) return null;
  const verdicts = [];
  for (const query of text.split(',')) {
    let ok = true, saw = false;
    for (let part of query.trim().split(/\s+and\s+/i)) {
      part = part.trim().toLowerCase();
      if (['screen', 'all', 'only screen', 'only all'].includes(part)) continue;
      if (['print', 'only print', 'speech'].includes(part)) { ok = false; saw = true; continue; }
      const inner = part.startsWith('(') && part.endsWith(')') ? part.slice(1, -1).trim() : '', f = feature.exec(inner), r = f ? null : range.exec(inner);
      if (f) ok = compare(width, f[1] === 'min' ? '>=' : '<=', px(f[2]!, f[3]!)) && ok;
      else if (r && (r[3] || r[4])) {
        if (r[3]) ok = compare(width, ({ '<': '>', '<=': '>=', '>': '<', '>=': '<=' } as Record<string, string>)[r[3]]!, px(r[1]!, r[2]!)) && ok;
        if (r[4]) ok = compare(width, r[4], px(r[5]!, r[6]!)) && ok;
      } else return null;
      saw = true;
    }
    if (!saw) return null; verdicts.push(ok);
  }
  return verdicts.some(Boolean);
}
export function modeLabel(mode: string): string {
  const text = mode.replace(/^@media\s+/i, ''), known: Record<string, string> = { 'prefers-color-scheme: dark': 'Dark', 'prefers-color-scheme: light': 'Light', 'prefers-reduced-motion: reduce': 'Reduced motion', 'orientation: landscape': 'Landscape', 'orientation: portrait': 'Portrait', 'hover: none': 'No hover' };
  for (const [needle, label] of Object.entries(known)) if (text.replaceAll('  ', ' ').toLowerCase().includes(needle)) return label;
  const stripped = text.replace(/[()]/g, '').replaceAll(':', '').trim().toLowerCase(); return stripped ? stripped[0]!.toUpperCase() + stripped.slice(1) : 'Mode';
}
type Values = NonNullable<PlannedVariable['valuesByMode']>;
export function roleValue(by: Values, modes: string[], role: string): Values[string] {
  const width = VIEWPORTS[role]!;
  if (modes.every(m => m in SITE_STUDIO_MIN)) {
    const own = Object.keys(SITE_STUDIO_MIN).filter(m => SITE_STUDIO_MIN[m]! <= width).sort((a, b) => SITE_STUDIO_MIN[b]! - SITE_STUDIO_MIN[a]!)[0]!;
    for (const m of modes.filter(m => SITE_STUDIO_MIN[m]! >= SITE_STUDIO_MIN[own]!).sort((a, b) => SITE_STUDIO_MIN[a]! - SITE_STUDIO_MIN[b]!)) if (by[m] != null) return by[m]!;
    return null;
  }
  let value = by[modes[0]!] ?? null;
  for (const m of modes.slice(1)) if (mediaApplies(m, width) && by[m] != null) value = by[m]!;
  return value;
}
export const foldable = (modes: string[]): boolean => modes.length > 1 && (modes.every(m => m in SITE_STUDIO_MIN) || modes.slice(1).every(m => mediaApplies(m, VIEWPORTS['Desktop']!) !== null));
export function variablesArgs(project: string, primary = breakpointCollection(project)) {
  let collections = variablePlan(project); const names = modeNames(), roles = ['Desktop', 'Tablet', 'Mobile'], label = brand(project), split: Record<string, string[]> = {};
  const branded = (name: string): string => name === 'Core' ? coreCollection(project) : !label || name.startsWith(label + ' ') ? name : `${label} ${name}`;
  const out: Record<string, VariableCollection> = {}, responsive: PlannedVariable[] = [];
  for (const [name, col] of Object.entries(collections)) {
    const modes = col.modes?.length ? col.modes : ['Value'], width = modes.slice(1).filter(m => mediaApplies(m, VIEWPORTS['Desktop']!) !== null), other = modes.slice(1).filter(m => !width.includes(m));
    if (width.length && other.length && !modes.every(m => m in SITE_STUDIO_MIN)) {
      const varies = (v: PlannedVariable, keep: string[]): boolean => new Set(keep.filter(k => k in (v.valuesByMode ?? {})).map(k => keyOf(v.valuesByMode![k]))).size > 1;
      const onWidth = col.variables.filter(v => varies(v, [modes[0]!, ...width])), onOther = col.variables.filter(v => varies(v, [modes[0]!, ...other]));
      if (!onWidth.some(v => onOther.includes(v))) {
        split[name] = [modes[0]!, ...width];
        collections = { ...collections, [name]: { ...col, variables: col.variables.filter(v => !onOther.includes(v)) }, [`${name} ${modeLabel(other[0]!)}`]: { ...col, modes: [modes[0]!, ...other], variables: onOther.map(v => ({ ...v, valuesByMode: Object.fromEntries(Object.entries(v.valuesByMode ?? {}).filter(([k]) => [modes[0]!, ...other].includes(k))) })) } };
      }
    }
  }
  for (let [name, col] of Object.entries(collections)) {
    const modes = split[name] ?? (col.modes?.length ? col.modes : ['Value']);
    if (foldable(modes)) {
      for (const v of col.variables) {
        const by = v.valuesByMode ?? {}, row = { ...v };
        if (Object.keys(by).length) { const values = Object.fromEntries(roles.map(r => [r, roleValue(by, modes, r)])), known = roles.map(r => values[r]).filter(v => v != null); row.valuesByMode = known.length ? Object.fromEntries(roles.map(r => [names[r]!, values[r] ?? known[0]!])) : {}; }
        responsive.push(row);
      }
      continue;
    }
    let target = branded(name);
    if (target === primary && modes.length > 1) { target += ' ' + modeLabel(modes[1]!); if (target in out || Object.keys(collections).some(other => other !== name && branded(other) === target)) throw new Error(`collection name collision ${JSON.stringify(target)}; name independent mode collections distinctly`); }
    if (modes.length > 1) { const relabel = Object.fromEntries(modes.map((m, i) => [m, i ? modeLabel(m) : m])); col = { ...col, modes: modes.map(m => relabel[m]!), variables: col.variables.map(v => Object.keys(v.valuesByMode ?? {}).length ? { ...v, valuesByMode: Object.fromEntries(Object.entries(v.valuesByMode!).map(([k, x]) => [relabel[k] ?? k, x])) } : v) }; }
    out[target] = { ...col, variables: [...out[target]?.variables ?? [], ...col.variables] };
  }
  if (responsive.length) out[primary] = { modes: roles.map(r => names[r]!), variables: [...out[primary]?.variables ?? [], ...responsive], modeRationale: 'responsive tokens share the breakpoint modes' };
  const merged: PlannedVariable[] = [], kept: Record<string, VariableCollection> = {};
  for (const [name, col] of Object.entries(out)) {
    if (name === primary || (col.modes?.length || 1) === 1) for (const v of col.variables) {
      const row = { ...v }, by = row.valuesByMode ?? {};
      if (Object.keys(by).length && ((col.modes?.length || 1) === 1 || !roles.some(r => names[r]! in by)) && new Set(Object.values(by).map(keyOf)).size === 1) row.valuesByMode = Object.fromEntries(roles.map(r => [names[r]!, Object.values(by)[0]!]));
      merged.push(row);
    } else kept[name] = col;
  }
  if (merged.length) {
    const seen = new Set<string>(); for (const v of merged) { if (seen.has(v.name)) throw new Error(`duplicate variable name ${v.name} while consolidating; use distinct slash groups`); seen.add(v.name); }
    return { collections: { [primary]: { modes: roles.map(r => names[r]!), variables: merged, modeRationale: 'one shared collection; invariant values repeat across width modes' }, ...kept } };
  }
  return { collections: kept };
}
export const emittedCollections = (project: string): string[] => [...new Set([...(existsSync(resolve(project, 'variable-plan.json')) ? Object.keys(variablesArgs(project, coreCollection(project)).collections) : []), coreCollection(project)])];
export const legacyCollections = (project: string): string[] => [...Object.keys(variablePlan(project)), 'Core', 'Core Breakpoint', 'Breakpoint', `${brand(project)} Breakpoint`.trim()];
export function repoRoot(project: string): string { const repo = load<{ repository?: string | { root: string } }>(project, 'project.json').repository; return resolve(typeof repo === 'object' ? repo.root : repo || '.'); }
export function siteName(repo: string): string {
  const config = resolve(repo, 'config');
  for (const entry of existsSync(config) ? readdirSync(config).sort() : []) { const f = resolve(config, entry, 'system.site.yml'); if (existsSync(f)) { const match = /^name:\s*'?(.+?)'?\s*$/m.exec(readFileSync(f, 'utf8')); if (match) return match[1]!; } }
  return basename(repo);
}
export function provenance(project: string, state: BuildState, today: string) {
  const repo = repoRoot(project); let commit = 'unknown'; try { commit = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch {}
  return { source: basename(repo), commit, siteUrl: state.siteUrl, captureWidths: Object.values(VIEWPORTS).sort((a, b) => a - b), standardVersion: STANDARD_VERSION, runtime: state.runtime, builtOn: today, regenerate: 'design-lab:run' };
}
export function coverArgs(project: string, state: BuildState, today: string) {
  const c = lc.counts(project, lc.recordedIds(state))!;
  return { pageId: pageId(project, 'Cover'), ground: lc.COVER_GROUND, headline: siteName(repoRoot(project)), subtitle: 'Component Library', total: { value: String(c.built), label: c.built === 1 ? 'component' : 'components' }, tiers: c.tiered ? c.coverBreakdown.map(r => ({ key: r.tier, value: String(r.built), label: lc.COVER_LABELS[r.tier] ?? r.tier, color: lc.TIER_COLORS[r.tier] })) : [], provenance: provenance(project, state, today), version: STANDARD_VERSION };
}
export function expandHex(h: string): string {
  const rgb = /^\s*rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/.exec(h);
  if (rgb) return '#' + rgb.slice(1).map(c => Math.min(255, roundEven(c.endsWith('%') ? Number(c.slice(0, -1)) * 2.55 : Number(c))).toString(16).padStart(2, '0')).join('');
  let s = h.replace(/^#+/, ''); if (s.length === 3) s = [...s].map(ch => ch + ch).join(''); return '#' + s.slice(0, 6).toLowerCase();
}
const floatText = (v: number): string => Number.isInteger(v) ? v.toFixed(1) : String(v);
const WEIGHTS: Record<number, string> = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };
export function measuredType(project: string) {
  const seen = new Map<string, { family: string; weight: number; size: number; lh: number | null; sizeText: string; lhText: string; sample: string; from: string }>();
  for (const f of jsonFiles(resolve(project, 'figma/trees'))) {
    const numericSources = new WeakMap<object, Map<string, string>>();
    const tree = JSON.parse(readFileSync(f, 'utf8'), function (this: object, key: string, value: unknown, context?: { source?: string }) {
      if (typeof value === 'number' && context?.source) { const entries = numericSources.get(this) ?? new Map(); entries.set(key, context.source); numericSources.set(this, entries); } return value;
    }) as Tree;
    const cid = basename(f, '.json'), comp = components(project).find(c => c.id === cid);
    const paths = [cid.replace(/[:/]/g, '__'), comp?.machineName || cid.split(':').at(-1)!.split('.').at(-1)!].map(n => resolve(project, 'capture/measurements', n + '.spec.json'));
    const measured = paths.find(existsSync), spec = measured ? JSON.parse(readFileSync(measured, 'utf8')) as Spec : null;
    const numberText = (value: Text['size'] | Text['lineHeight'], field: string, text: Text): string => {
      if (typeof value === 'object' && value !== null) { const values = tree.variables[value.var]!.values; return numericSources.get(values)?.get('Desktop') ?? String(values['Desktop']); }
      return numericSources.get(text)?.get(field) ?? String(value);
    };
    const desk = (v: Text['size'] | Text['lineHeight']): number | null => typeof v === 'object' && v !== null ? tree.variables[v.var]!.values['Desktop'] as number : v ?? null;
    const stack: TreeNode[] = [tree.tree];
    while (stack.length) { const n = stack.pop()!; stack.push(...[...n.children ?? []].reverse()); if (n.kind !== 'text') continue; const t = n.text, size = desk(t.size)!, lh = desk(t.lineHeight), key = keyOf([t.family, t.weight, size, lh]);
      const measurement = spec?.measurements['desktop:default'] ?? (spec ? Object.values(spec.measurements).find(m => 'nodes' in m && Array.isArray(m.nodes)) : undefined);
      const measuredNodes = measurement && 'nodes' in measurement ? measurement.nodes : undefined; const source = Array.isArray(measuredNodes) ? measuredNodes.find(node => node.path === n.source.replace(/#label$/, '')) : undefined;
      const sizeText = source ? cssPixels(source.computed['fontSize']) ? floatText(size) : String(size) : numberText(t.size, 'size', t);
      const lhText = lh ? source ? floatText(lh) : numberText(t.lineHeight, 'lineHeight', t) : 'normal';
      if (!seen.has(key)) seen.set(key, { family: t.family, weight: t.weight, size, lh, sizeText, lhText, sample: t.characters.slice(0, 60), from: tree.label }); }
  }
  return [...seen.values()].sort((a, b) => b.size - a.size || b.weight - a.weight || (a.family < b.family ? -1 : a.family > b.family ? 1 : 0)).slice(0, 12).map(r => ({ label: `${r.size}px · ${WEIGHTS[r.weight] ?? r.weight}`, family: r.family, style: r.weight >= 600 ? 'Bold' : 'Regular', weight: r.weight, size: r.size, lineHeight: r.lh, spec: `${r.family} ${r.weight} · ${r.sizeText}px / ${r.lhText} · first seen in ${r.from}`, sample: r.sample }));
}
export function foundationArgs(project: string, domain: string) {
  const variables = Object.values(variablePlan(project)).flatMap(c => c.variables), by = Object.fromEntries(variables.map(v => [v.name, v])), sections: Record<string, unknown>[] = []; let intro: string[] = [];
  const nameSort = (a: PlannedVariable, b: PlannedVariable): number => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  const code = (v: PlannedVariable): string | null => v.codeName ? `var(${v.codeName})` : null;
  const val = (v: PlannedVariable): number => Number(Object.values(v.valuesByMode ?? {})[0]);
  if (domain === 'Color') {
    const sw = (v: PlannedVariable) => ({ variable: v.name, label: (v.codeName || v.name).replace(/^-+/, ''), value: expandHex(v.hex || by[v.aliasOf ?? '']?.hex || '#000000'), code: code(v), alias: (by[v.aliasOf ?? '']?.codeName || v.aliasOf || '').replace(/^-+/, '') || null });
    intro = ["Every colour the site's stylesheets declare, bound to its variable. Semantic colours point at a primitive; the arrow names it."];
    for (const [title, alias] of [['Primitives', false], ['Semantic', true]] as const) { const vs = variables.filter(v => v.type === 'COLOR' && !!v.aliasOf === alias); if (vs.length) sections.push({ kind: 'color', title, note: null, swatches: vs.sort(nameSort).map(sw) }); }
  } else if (domain === 'Typography') {
    intro = ["Font families come from the site's tokens. The scale below is measured from the rendered components, because the stylesheets declare no type-size tokens; those values are literals in the components, not variables."];
    const fams = variables.filter(v => v.type === 'STRING' && v.scopes?.includes('FONT_FAMILY'));
    if (fams.length) sections.push({ kind: 'type-family', title: 'Families', note: null, families: fams.sort(nameSort).map(v => ({ variable: v.name, family: Object.values(v.valuesByMode ?? { '': '' })[0], code: code(v), sample: 'The quick brown fox jumps over the lazy dog' })) });
    const rows = measuredType(project); if (rows.length) sections.push({ kind: 'type-scale', title: 'Measured scale', note: 'Sizes observed on the built components, largest first. Measured, not tokens.', rows });
  } else if (domain === 'Spacing & Layout') sections.push({ kind: 'spacing', title: 'Spacing', note: null, steps: variables.filter(v => v.name.startsWith('Spacing/') && v.type === 'FLOAT').sort((a, b) => val(a) - val(b)).map(v => ({ variable: v.name, label: v.name.split('/').at(-1), value: val(v), code: code(v) })) });
  else if (domain === 'Elevation & Shape') sections.push({ kind: 'radius', title: 'Radius', note: null, steps: variables.filter(v => /^(Shape|Radius)\//.test(v.name) && v.type === 'FLOAT').sort(nameSort).map(v => ({ variable: v.name, label: v.name.split('/').at(-1), value: val(v), code: code(v) })) });
  return { pageId: pageId(project, `Foundations — ${domain}`), title: `Foundations — ${domain}`, intro, sections };
}
export function tierArgs(project: string, state: BuildState, tier: string) {
  const comps = components(project).filter(c => lc.shortTier(c.usage?.tier) === tier), planned = comps.filter(c => lc.plannedIds(state).includes(c.id)), total = comps.reduce((s, c) => s + lc.placements(c), 0);
  return { pageId: pageId(project, `Components — ${tier}`), title: `Components — ${tier}`, summary: [`${comps.length} component${comps.length === 1 ? '' : 's'} in this tier. ${total.toLocaleString('en-US')} author placement${total === 1 ? '' : 's'} between them.`], thresholds: tier === 'Untiered' ? "No usage source counted these components' placements, so they have no tier." : 'Tiers by author placements: High Use 50 or more · Medium Use 10 to 49 · Low Use 1 to 9 · Structural Only when placed only inside other components · Retirement Candidates when placed nowhere.', emptyLine: planned.length ? null : !comps.length ? 'No component in this tier is in the source.' : `None of the ${comps.length} components in this tier is part of the library. The index on Getting Started gives each one's reason.` };
}
export function variants(project: string, cid: string) {
  const comp = components(project).find(c => c.id === cid)!, axes = plans(project)[cid]?.variantAxes ?? [], f = resolve(project, `capture/measurements/${cid.replace(/[:/]/g, '__')}.spec.json`);
  const measurement = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Spec).measurements['desktop:default'] : undefined;
  const nodes = measurement && 'nodes' in measurement ? measurement.nodes : [];
  return variantValues(comp.fields.map(f => ({ name: f.name, options: f.options ?? [] })), axes.map(a => ({ field: a.field!, ...(a.label !== undefined ? { label: a.label } : {}) })), (nodes as { classes?: string[] }[]).map(n => ({ classes: n.classes ?? [] })));
}
export function fontPlan(project: string): Fonts['build'] | null { try { return load<Fonts>(project, 'fonts.json').build ?? null; } catch { return null; } }
export function description(project: string, c: Component): string {
  const u = c.usage ?? {}, fields = c.fields.map(f => `${f.label || f.name} (${f.kind})`).join(', ') || 'none';
  return `${c.label || c.id} — ${c.id} (${c.group || 'ungrouped'}).\nUsage: ${lc.shortTier(u.tier)}; ${lc.placements(c)} author placements, ${lc.structural(c)} structural references, rendered on ${u.renderedPages || 0} public pages.\nFields: ${fields}.\nResponsive: one component; resize an instance and set its Breakpoint mode (Desktop, Tablet, Mobile).\nExample: ${examplePath(c) || 'none verified'}\nDocumentation: the block beside this component on its tier page.`;
}
export function buildArgs(project: string, cid: string, state: BuildState) {
  const tree = treeFor(project, cid), comp = components(project).find(c => c.id === cid)!, previous = state.subset?.includes(cid) ? load(project, `figma/results/${safe('build:' + cid)}.json`, {}) as ReturnType<typeof result> : {};
  if (state.subset?.includes(cid) && !previous.componentId) throw new Error(`missing saved master identity for ${cid}; rebuild in a fresh file`);
  const masters: Record<string, string> = {}; for (const slot of comp.slots) for (const child of typeof slot.accepts === 'string' ? slot.accepts : slot.accepts ?? []) try { const id = result(project, 'build:' + child).componentId; if (id) masters[child] = id; } catch {}
  return { pageId: pageId(project, componentPage(comp)), x: 0, y: -6000, id: cid, existingComponentId: previous.componentId ?? null, name: `${cid} — ${comp.label || cid}`, description: description(project, comp), collection: breakpointCollection(project), modeNames: modeNames(), masters, variant: Object.fromEntries(variants(project, cid).map(v => [v.axis, v.value || 'As captured'])), variables: Object.assign({}, tree.variables, ...(tree.alternates ?? []).map(a => a.variables)), fonts: fontPlan(project), alternates: (tree.alternates ?? []).map(a => ({ ...(a.label !== undefined ? { label: a.label } : {}), ...compact(a.tree) })), ...compact(tree.tree) };
}
export function fieldsRows(c: Component, plan: ComponentPlan | undefined): string[][] {
  const treat = Object.fromEntries((plan?.properties ?? []).map(p => [p.field!, p.treatment])), axes = new Set(plan?.variantAxes.map(a => a.field)), treatments: Record<string, string> = { text: 'text in the drawn instance', boolean: 'shown as rendered', variable: 'value as rendered', swap: 'nested content as rendered', manual: 'as rendered; not a Figma property', skip: 'not visible' };
  return [...c.fields.map(f => [f.name, f.kind, f.required ? 'yes' : 'no', axes.has(f.name) ? 'variant axis — only the rendered option is drawn' : treatments[treat[f.name] ?? ''] ?? 'as rendered']), ...c.slots.map(s => [s.name, 'slot', s.required ? 'yes' : 'no', 'nested content as rendered'])];
}
export function backdrop(project: string, cid: string): string {
  const f = resolve(project, `capture/measurements/${cid.replace(/[:/]/g, '__')}.spec.json`); if (!existsSync(f)) return '#ffffff';
  const measurement = (JSON.parse(readFileSync(f, 'utf8')) as Spec).measurements['desktop:default'];
  const color = parseColor(measurement && 'backdrop' in measurement ? measurement.backdrop : undefined); return color && (color.opacity ?? 1) >= 1 ? color.hex : '#ffffff';
}
export async function captureImages(project: string, cid: string) {
  const ev = load<Pick<CaptureEvidence, 'captures'>>(project, 'capture-evidence.json', { captures: {} }).captures[cid], imgs = (ev?.images ?? []).filter(i => (i.state || 'default') === 'default');
  const rank = (v: string): number => { const i = BREAKPOINTS.indexOf(v.toLowerCase()); return i < 0 ? 9 : i; };
  return Promise.all([...imgs].sort((a, b) => rank(a.viewport ?? '') - rank(b.viewport ?? '')).map(async i => {
    let width = i.width, height = i.height; if (!width || !height) { const meta = await sharp(i.file).metadata(); width = meta.width; height = meta.height; }
    const view = i.viewport ?? ''; return { viewport: view ? view[0]!.toUpperCase() + view.slice(1).toLowerCase() : '', file: i.file!, width: width!, height: height! };
  }));
}
export async function evidenceCaptures(project: string, cid: string, tree: Tree) {
  const by = new Map((await captureImages(project, cid)).map(e => [e.viewport.toLowerCase(), e])); return COLUMN_ORDER.filter(r => tree.measured.includes(r.toLowerCase()) && by.has(r.toLowerCase())).map(r => by.get(r.toLowerCase())!);
}
export async function blockArgs(project: string, state: BuildState, cid: string, order: number) {
  const comp = components(project).find(c => c.id === cid)!, plan = plans(project)[cid], tree = treeFor(project, cid), u = comp.usage ?? {}, ex = examplePath(comp);
  const facts = [['Author placements', String(lc.placements(comp))], ['Structural references', String(lc.structural(comp))], ['Rendered on', `${u.renderedPages || 0} public pages`]];
  if (ex) facts.push(['Example', ex, state.canonicalBaseUrl + ex]); facts.push(['Source', dirname(comp.sourceRef || '')]);
  const relations: string[] = []; if (comp.contains?.length) relations.push('Contains: ' + [...comp.contains].sort().join(', ') + '.'); if (comp.containedBy?.length) relations.push('Placed inside: ' + [...comp.containedBy].sort().join(', ') + '.');
  for (const ref of [...new Set((u.templateRefs ?? []).flatMap(r => typeof r === 'string' ? [r] : r.file ? [r.file] : []))].sort()) relations.push(`Rendered by the ${ref.endsWith('.twig') ? 'theme template' : 'Canvas content template'} ${ref}.`);
  const names = modeNames();
  return { pageId: pageId(project, componentPage(comp)), setId: result(project, 'build:' + cid).componentId, id: cid, order, doc: { label: comp.label || cid, machine: cid, tier: lc.shortTier(u.tier), purpose: comp.description ?? null, chips: [comp.group, u.globalTemplate ? 'Global chrome' : null].filter(Boolean), facts, properties: [['Breakpoint', 'MODE', 'Desktop, Tablet, Mobile', 'Desktop']], fields: fieldsRows(comp, plan), relations, notes: comp.defects.map(d => d.detail || String(d)).slice(0, 4) }, columns: COLUMN_ORDER.filter(r => tree.measured.includes(r.toLowerCase())).map(r => ({ label: `${r} · ${tree.widths[r]}px`, width: tree.widths[r], mode: names[r], master: r === 'Desktop' })), collection: breakpointCollection(project), evidence: (await evidenceCaptures(project, cid, tree)).map(e => ({ label: `${e.viewport} ${e.width}px`, width: e.width, height: e.height })), captured: 'the running site', backdrop: backdrop(project, cid), fileKey: state.fileKey };
}
export function clip(text: string, limit = 220): string {
  if ([...text].length <= limit) return text; const cut = [...text].slice(0, limit).join(''), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? ')); return (end > 60 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' ') < 0 ? cut.length : cut.lastIndexOf(' ')) + ' …').trim();
}
interface VoiceEvidence { numerator?: number; denominator?: number; quotes?: { quote: string; address: string }[] }
export const evidenceText = (e: VoiceEvidence): string => [`${e.numerator ?? 0} of ${e.denominator ?? 0}`, ...(e.quotes ?? []).map(q => `“${clip(q.quote, 90)}” (${q.address})`)].join(' · ');
export const spaced = (key: string): string => key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
interface Voice { corpus?: { pagesFetched?: number; sentences?: number; callToActionLabels?: number; fetchDate?: string }; positioning?: { h1?: string; paragraphs?: string[]; address?: string }; rules?: { section?: string; kind: string; rule: string; evidence?: VoiceEvidence }[]; mechanics?: { Rule?: string; 'As published'?: Record<string, number> | string | number; Notes?: string }[]; vocabulary?: { phrases?: { phrase: string; pages?: string[]; count?: number }[] }; stats?: unknown[]; inconsistencies?: { rule: string; evidence?: VoiceEvidence }[] }
export function voiceArgs(project: string) {
  const v = load<Voice>(project, 'voice.json'), c = v.corpus ?? {}, pos = v.positioning ?? {}, rules = v.rules ?? [];
  return { pageId: pageId(project, 'Foundations — Brand Voice & Language'), lede: `Drawn from the copy on ${c.pagesFetched ?? 0} published pages (${(c.sentences ?? 0).toLocaleString('en-US')} sentences, ${c.callToActionLabels ?? 0} calls to action), read ${c.fetchDate ?? ''}. Observed rows describe what the site does most often; Watch rows are inconsistencies found in the same read. Nothing here is taken from a brand document.`, positioning: pos.h1 ? { line: pos.h1, supporting: (pos.paragraphs ?? []).slice(0, 2).map(p => clip(p)), attribution: `Homepage · ${pos.address ?? '/'}` } : null, stats: (v.stats ?? []).slice(0, 5), sections: ['Voice', 'Naming & terminology', 'Headlines', 'Calls to action', 'Readability', 'Search'].map(sec => ({ title: sec, rows: rules.filter(r => r.section === sec).map(r => ({ kind: r.kind, rule: r.rule, evidence: evidenceText(r.evidence ?? {}) })) })), vocabulary: (v.vocabulary?.phrases ?? []).slice(0, 16).map(p => ({ phrase: p.phrase, count: p.pages?.length || p.count || 0 })), mechanics: (v.mechanics ?? []).map(m => [m.Rule ?? '', typeof m['As published'] === 'object' ? Object.entries(m['As published']).map(([k, n]) => `${spaced(k)} ${n}`).join(' · ') : String(m['As published'] ?? 'None'), m.Notes ?? '']), inconsistencies: (v.inconsistencies ?? []).map(r => `${r.rule}: ${evidenceText(r.evidence ?? {})}`) };
}
export function componentIds(comps: Component[]): Record<string, string> {
  const out: Record<string, string> = {}; for (const c of comps) { const m = /(?:^|\/)themes\/(?:custom|contrib)\/([^/]+)\/components\/([^/]+)\//.exec(c.sourceRef || ''), source = c.sourceSdcId || (m ? `${m[1]}:${m[2]}` : null); if (source && !(source in out)) out[source] = c.id; } return out;
}
export function componentId(renderId: string, ids: Record<string, string>): string { const at = renderId.indexOf(':'); return ids[renderId] || `sdc.${at < 0 ? renderId : renderId.slice(0, at)}.${at < 0 ? '' : renderId.slice(at + 1)}`; }
export function examplesArgs(project: string, state: BuildState) {
  const inventory = components(project), comps = Object.fromEntries(inventory.map(c => [c.id, c])), ids = componentIds(inventory), pages = load<{ pages: { address: string; title?: string; components: string[] }[] }>(project, 'compositions.json').pages, built = lc.recordedIds(state);
  const distinct = (p: typeof pages[number]): string[] => [...new Set(p.components.map(r => componentId(r, ids)).filter(id => built.has(id)))].sort();
  const ranked = [...pages].sort((a, b) => Number(a.address !== '/') - Number(b.address !== '/') || distinct(b).length - distinct(a).length || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0)), chosen: typeof pages = [], seen = new Set<string>();
  for (const p of ranked) { const key = distinct(p); if (!key.length || seen.has(keyOf(key))) continue; chosen.push(p); seen.add(keyOf(key)); if (chosen.length === 3) break; }
  return { pageId: pageId(project, 'Examples'), collection: breakpointCollection(project), desktopMode: modeNames()['Desktop'], mobileMode: modeNames()['Mobile'], pages: chosen.map(p => ({ address: p.address, title: p.title || p.address, items: p.components.map(r => { const cid = componentId(r, ids), label = comps[cid]?.label || cid; if (!built.has(cid)) return { missing: label }; const tree = treeFor(project, cid); return { componentId: result(project, 'build:' + cid).componentId, label, desktop: tree.widths['Desktop'] ?? null, mobile: tree.widths['Mobile'] ?? null }; }) })) };
}
export function gettingStartedArgs(project: string, state: BuildState, today: string) {
  const comps = components(project), plan = plans(project), built = lc.recordedIds(state), ordered = buildOrder(comps), counted = lc.counts(project, built)!, shown = new Set(tierNames(comps)), gaps: string[] = [];
  const coverage = counted.byTier.filter(r => shown.has(r.tier)).map(r => [r.tier, String(r.found), String(r.built), String(r.notBuilt), r.placements.toLocaleString('en-US')]);
  const index = ordered.map(c => {
    const p = plan[c.id]; let status: string, setId: string | null, blockId: string | null;
    if (built.has(c.id)) { status = 'Built'; setId = result(project, 'build:' + c.id).componentId!; blockId = result(project, 'block:' + c.id).blockId!; }
    else { const reason = p?.refuseReason || (p?.verdict === 'map' ? 'mapped into its parent' : 'no capture'); status = p?.verdict === 'map' ? 'Mapped into parent' : 'Not built'; setId = blockId = null; gaps.push(`${c.label || c.id} (${c.id}): ${status.toLowerCase()} — ${reason}.`); }
    return { placements: lc.placements(c), label: c.label || c.id, machine: c.id, tier: lc.shortTier(c.usage?.tier), type: c.group || '—', status, setId, blockId };
  });
  const domains = foundationDomains(project);
  for (const d of FOUNDATION_ORDER) if (!domains.includes(d)) gaps.push(`Foundations — ${d} is omitted: the site's stylesheets declare no ${d.toLowerCase()} tokens.`);
  if (domains.includes('Typography')) gaps.push('Type sizes and line heights are literals in the components: the stylesheets declare no type-size tokens. The Typography page shows them as measured values.');
  for (const d of domains) { const missing = load<ReturnType<typeof result>>(project, `figma/results/${safe('foundation:' + d)}.json`, {}).missing ?? []; for (const m of [...new Set(missing)].sort()) gaps.push(`Foundations — ${d}: ${m} is not available in Figma; its specimen is drawn in Inter.`); }
  const differing: string[] = [], missingFonts = new Set<string>(), standIns: Record<string, Set<string>> = {}, styles: Record<string, Set<string>> = {};
  for (const c of ordered.filter(c => built.has(c.id))) {
    const comparison = load<ReturnType<typeof result>>(project, `figma/results/${safe('compare:' + c.id)}.json`, {});
    if (Object.keys(comparison).length && !comparison.pass) differing.push(`${c.id} (${roundEven(Math.max(...(comparison.pairs?.length ? comparison.pairs : [{}]).map(p => ('ratio' in p ? p.ratio : 0) || 0)) * 100)}%)`);
    const r = load<ReturnType<typeof result>>(project, `figma/results/${safe('build:' + c.id)}.json`, {});
    for (const m of r.missingFonts ?? []) missingFonts.add(m);
    for (const [family, drawn] of Object.entries(r.standIns ?? {})) (standIns[`${family} -> ${drawn}`] ??= new Set()).add(c.id);
    for (const [requested, drawn] of Object.entries(r.styleFallbacks ?? {})) (styles[`${requested} -> ${drawn}`] ??= new Set()).add(c.id);
  }
  if (differing.length) gaps.push(`master-matches-capture: ${differing.length} component(s) differ from their live capture by more than the 6% threshold at one or more widths, so build-record-assertions records a failing visual comparison for each: ${differing.join(', ')}.`);
  if (Object.keys(standIns).length) gaps.push('fonts-stand-in: ' + Object.entries(standIns).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k} (${v.size} components)`).join('; ') + " — the font plan's stand-in, because Figma cannot draw the family the site renders.");
  if (Object.keys(styles).length) gaps.push('fonts-style-fallback: ' + Object.entries(styles).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k} (${v.size} components)`).join('; ') + ' — Figma has no matching style, so the nearest style of the same family is drawn.');
  if (missingFonts.size) gaps.push(`fonts-available: ${[...missingFonts].sort().join(', ')} ${missingFonts.size === 1 ? 'is' : 'are'} not available to Figma here, so text using ${missingFonts.size === 1 ? 'it' : 'them'} is drawn in Inter; make the families available and rebuild.`);
  for (const c of ordered.filter(c => built.has(c.id))) for (const v of variants(project, c.id)) gaps.push(`${c.label || c.id} (${c.id}) — ${v.axis}: ${v.value ? `the captured instance is ${v.value}` : "the captured instance's option is not recorded in its classes"}; ${v.others.join(', ') || 'no other option'} not captured, so not drawn as variants.`);
  return { pageId: pageId(project, 'Getting Started'), title: `${siteName(repoRoot(project))} component library`, what: 'The components of the running site, each drawn from a live capture at three widths, with its documentation beside it on its usage tier page.', whatNot: "Not a redesign: every value is what the site renders today, defects included. Not a search index: use Figma's Find and the Assets panel.", coverage: { columns: [{ title: 'Tier' }, { title: 'Components', width: 160 }, { title: 'Built', width: 120 }, { title: 'Not built', width: 140 }, { title: 'Placements', width: 160 }], rows: coverage }, organisation: ['Pages are usage tiers, the only page axis. Within a page, components run from most to least placed.', 'Author placements and structural references are counted separately: a component placed only inside others is Structural Only, not dead.'], thresholds: { columns: [{ title: 'Tier' }, { title: 'Rule', width: 360 }], rows: [['High Use', '50 or more author placements'], ['Medium Use', '10 to 49'], ['Low Use', '1 to 9'], ['Structural Only', '0 placements, placed inside other components'], ['Retirement Candidates', '0 placements, 0 references']] }, blockGuide: [['Head', 'Name, machine name, tier, and what the component is for.'], ['Usage', 'Author placements, structural references, pages it renders on, a live example and its source.'], ['Figma properties', 'What you can change on an instance.'], ['Fields', 'Every field an author fills in, and how it appears in Figma.'], ['Breakpoints', 'The component at mobile, tablet and desktop, side by side, narrowest first.'], ['Live reference', 'Screenshots of the running site in the same columns, for comparison.']], index, gaps, changelog: [[today, lc.coverageSentence(counted) + ` ${counted.found} found in the source.`]], regenerate: ['design-lab:run against the same repository and site', 'figma_build.ts init, then next/record until done', 'design-lab:verify'] };
}
