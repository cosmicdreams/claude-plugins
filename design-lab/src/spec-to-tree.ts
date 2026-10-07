/** Deterministic geometry conversion. Python remains the oracle until phase 5. */
import type { Spec, MeasuredNode } from './generated/spec.ts';
import type { Color, Text, TreeNode, Layout } from './generated/tree.ts';
import { roundEven, roundDecimal, pythonJson } from './json.ts';
export const TOLERANCE = 2;
export const SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type Side = typeof SIDES[number];
export type Padding = Record<Side, number>;
export type Box = MeasuredNode['box'];
export type Index = Record<string, MeasuredNode[]>;
export interface InferredLayout extends Layout { padding: Padding; gap?: number; counterGap?: number; spacers?: number[] }
const TAG_NAMES: Record<string, string> = { h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading', p: 'Paragraph', a: 'Link', img: 'Image', svg: 'Icon', ul: 'List', ol: 'List', li: 'Item', button: 'Button', figure: 'Figure', figcaption: 'Caption', blockquote: 'Quote', picture: 'Picture', span: 'Inline text', strong: 'Strong text', em: 'Emphasis', time: 'Date', label: 'Label', input: 'Input', nav: 'Navigation', header: 'Header', footer: 'Footer', section: 'Section', article: 'Article' };
const FIGMA_DEFAULT = new Set(['Frame', 'Group', 'Rectangle', 'Ellipse', 'Text', 'Vector', 'Line', 'Polygon', 'Star', 'Component', 'Slice']);
const cap = (value: string): string => value[0]!.toUpperCase() + value.slice(1).toLowerCase();
const fnum = (value: number): string => Number.isInteger(value) ? value.toFixed(1) : String(value);
export function clips(computed: Record<string, string>): boolean { return (computed['overflow'] ?? '').split(/\s+/).some(value => ['hidden', 'clip', 'auto', 'scroll'].includes(value)); }
export function px(value?: string | null): number { const match = /^(-?[\d.]+)px$/.exec(value?.trim() ?? ''); return match ? Number(match[1]) : 0; }
export const r2 = (value: number): number => roundEven(value * 2) / 2;
export function parseColor(value?: string | null): Color | null {
  const match = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\s*\)/.exec(value ?? '');
  if (!match) return null;
  const a = match[4] === undefined ? 1 : Number(match[4]);
  if (a === 0) return null;
  return { hex: '#' + [1, 2, 3].map(i => roundEven(Number(match[i])).toString(16).padStart(2, '0')).join(''), opacity: roundDecimal(a, 3) };
}
export function cssVar(value: string | boolean | undefined): string | null { return typeof value === 'string' ? /var\(\s*(--[\w-]+)/.exec(value)?.[1] ?? null : null; }
export function parseShadow(value?: string): NonNullable<TreeNode['effects']> {
  if (!value || value === 'none') return [];
  return value.split(/,(?![^(]*\))/).flatMap(part => {
    const color = parseColor(/rgba?\([^)]*\)/.exec(part)?.[0]), nums = [...part.matchAll(/(-?[\d.]+)px/g)].map(m => Number(m[1]));
    return color && nums.length >= 2 ? [{ type: part.includes('inset') ? 'INNER_SHADOW' : 'DROP_SHADOW', color, x: nums[0]!, y: nums[1]!, blur: nums[2] ?? 0, spread: nums[3] ?? 0 }] : [];
  });
}
export function nodeName(node: MeasuredNode, rootBlock: string | null): string | null {
  for (const cls of node.classes ?? []) {
    const match = /^[a-z]+-([a-z0-9-]+?)__([a-z0-9-]+)$/.exec(cls);
    if (match) { const name = cap(match[2]!.replaceAll('-', ' ')); return FIGMA_DEFAULT.has(name) ? cap(match[1]!.replaceAll('-', ' ')) + ' ' + name.toLowerCase() : name; }
  }
  if (rootBlock && (node.classes ?? []).includes(rootBlock)) return null;
  for (const cls of node.classes ?? []) {
    const match = /^[a-z]+-([a-z0-9-]+)$/.exec(cls);
    if (match && !cls.includes('--')) { const name = cap(match[1]!.replaceAll('-', ' ')); return FIGMA_DEFAULT.has(name) ? name + ' element' : name; }
  }
  return TAG_NAMES[node.tag] ?? 'Container';
}
function borders(c: Record<string, string>): boolean { return SIDES.some(s => px(c[`border${cap(s)}Width`]) > 0 && ![undefined, 'none', 'hidden'].includes(c[`border${cap(s)}Style`])); }
export function visible(node: MeasuredNode): boolean {
  const c = node.computed, b = node.box;
  if (node.rendered === false || c['display'] === 'none' || c['visibility'] === 'hidden' || Number(c['opacity'] || 1) === 0) return false;
  if (/rect\(\s*0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\s*\)|inset\(\s*50%/.test((c['clip'] ?? '') + ' ' + (c['clipPath'] ?? ''))) return false;
  if (b.width > 1.5 && b.height > 1.5) return true;
  return (b.width > 1.5 || b.height > 1.5) && (borders(c) || parseColor(c['backgroundColor']) !== null);
}
export function buildIndex(nodes: MeasuredNode[]): Index {
  const children: Index = {};
  for (const node of nodes) { const parent = node.path.slice(0, node.path.lastIndexOf('/')); (children[parent] ??= []).push(node); }
  return children;
}
export function drawsNothing(node: MeasuredNode): boolean {
  const c = node.computed;
  return !parseColor(c['backgroundColor']) && ['none', ''].includes(c['backgroundImage'] ?? 'none') && !borders(c) && ['none', ''].includes(c['boxShadow'] ?? 'none');
}
export function passthrough(node: MeasuredNode, hasChildren = true): boolean {
  const c = node.computed, b = node.box;
  if (!hasChildren || c['display'] === 'none' || c['visibility'] === 'hidden' || Number(c['opacity'] || 1) === 0) return false;
  return c['display'] === 'contents' || b.width <= 1.5 || b.height <= 1.5 || (c['display'] === 'inline' && !node.text && !node.inlineText && drawsNothing(node));
}
export function stacking(node: Pick<MeasuredNode, 'computed'>): [number, number] {
  const c = node.computed, positioned = !!c['position'] && c['position'] !== 'static';
  const z = /^[-+]?\d+$/.test(c['zIndex'] ?? '') ? Number(c['zIndex']) : 0;
  return positioned ? z < 0 ? [0, z] : z > 0 ? [3, z] : [2, 0] : [1, 0];
}
const length = (value: string, whole: number): number => value.trim().endsWith('%') ? Number(value.trim().slice(0, -1)) / 100 * whole : px(value);
export type Shape = { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number } | { kind: 'polygon'; points: [number, number][] };
export function clipShape(clip: string | undefined, width: number, height: number): Shape | null {
  let m = /^circle\(\s*([\d.]+(?:px|%))?\s*(?:at\s+([\d.]+(?:px|%))\s+([\d.]+(?:px|%)))?\s*\)/.exec(clip ?? '');
  if (m) { const r = length(m[1] ?? '50%', Math.sqrt((width ** 2 + height ** 2) / 2)); return { kind: 'ellipse', cx: r2(length(m[2] ?? '50%', width)), cy: r2(length(m[3] ?? '50%', height)), rx: r2(r), ry: r2(r) }; }
  m = /^ellipse\(\s*([\d.]+(?:px|%))\s+([\d.]+(?:px|%))\s*(?:at\s+([\d.]+(?:px|%))\s+([\d.]+(?:px|%)))?\s*\)/.exec(clip ?? '');
  if (m) return { kind: 'ellipse', rx: r2(length(m[1]!, width)), ry: r2(length(m[2]!, height)), cx: r2(length(m[3] ?? '50%', width)), cy: r2(length(m[4] ?? '50%', height)) };
  m = /^polygon\((.*)\)$/.exec(clip?.trim() ?? '');
  if (m) {
    const points: [number, number][] = [];
    for (const pair of m[1]!.split(',')) { const parts = pair.trim().split(/\s+/); if (parts.length !== 2) return null; points.push([r2(length(parts[0]!, width)), r2(length(parts[1]!, height))]); }
    return { kind: 'polygon', points };
  }
  return null;
}
export function shapeSvg(shape: Shape, width: number, height: number, fill: Color): string {
  const color = `fill="${fill.hex}" fill-opacity="${fnum(fill.opacity ?? 1)}"`;
  const body = shape.kind === 'ellipse' ? `<ellipse cx="${fnum(shape.cx)}" cy="${fnum(shape.cy)}" rx="${fnum(shape.rx)}" ry="${fnum(shape.ry)}" ${color}/>`
    : `<polygon points="${shape.points.map(([x, y]) => `${fnum(x)},${fnum(y)}`).join(' ')}" ${color}/>`;
  const w = fnum(r2(width)), h = fnum(r2(height));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><clipPath id="box"><rect width="${w}" height="${h}"/></clipPath></defs><g clip-path="url(#box)">${body}</g></svg>`;
}
export interface PseudoImage { width: number; height: number; gap: number; src?: string; svg?: string }
export function pseudoImage(node: MeasuredNode, which: 'before' | 'after'): PseudoImage | null {
  const p = node[which]; if (!p || p['display'] === 'none') return null;
  let m = /url\("?([^")]+)"?\)/.exec(p['content'] ?? '');
  if (!m && !(p['content'] ?? '').replace(/^['"]+|['"]+$/g, '')) m = /url\("?([^")]+)"?\)/.exec(p['backgroundImage'] ?? '');
  if (!m) return null;
  const size = px(node.computed['fontSize']) || 16, width = px(p['width']) || size, height = px(p['height']) || size;
  const out: PseudoImage = { width: r2(width), height: r2(height), gap: r2(px(p[which === 'before' ? 'marginRight' : 'marginLeft'])) }, url = m[1]!;
  if (url.startsWith('data:image/svg+xml')) {
    const comma = url.indexOf(','); out.svg = url.slice(0, comma).includes(';base64') ? Buffer.from(url.slice(comma + 1), 'base64').toString('utf8') : decodeURIComponent(url.slice(comma + 1));
    const angle = rotation(p['transform']);
    if (angle) out.svg = out.svg.replace(/(<svg\b[^>]*>)([\s\S]*)(<\/svg>)/, (_, open: string, body: string, close: string) => `${open}<g transform="rotate(${fnum(angle)} ${fnum(width / 2)} ${fnum(height / 2)})">${body}</g>${close}`);
  } else out.src = url;
  return out;
}
export function maskedIconSvg(node: MeasuredNode): string | null {
  let source = node.maskSvg; const fill = parseColor(node.computed['backgroundColor']); if (!source || !fill) return null;
  source = source.replace(/^\ufeff+/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*(<\?xml[\s\S]*?\?>)?\s*(<!DOCTYPE[^>]*>)?\s*/i, '');
  const end = source.lastIndexOf('</svg>'); if (!source.startsWith('<svg') || end < 0) return null;
  let svg = source.slice(0, end + 6); const colour = fill.hex, alpha = fill.opacity ?? 1;
  svg = svg.replace(/\b(fill|stroke)=(["'])(?!none\2)[^"']*\2/g, (_, prop: string) => `${prop}="${colour}"`)
    .replace(/\b(fill|stroke)\s*:\s*(?!none\b)[^;"'}<]+/g, (_, prop: string) => `${prop}:${colour}`).replaceAll('currentColor', () => colour);
  const root = /^<svg\b[^>]*>/.exec(svg)![0]; let tag = root;
  const width = r2(node.box.width || 0), height = r2(node.box.height || 0);
  if (width && height) {
    if (!/\bviewBox=/.test(tag)) {
      const w = /\bwidth=["']?([\d.]+)(?:px)?["'\s>]/.exec(tag), h = /\bheight=["']?([\d.]+)(?:px)?["'\s>]/.exec(tag);
      if (w && h) tag = tag.replace('<svg', () => `<svg viewBox="0 0 ${w[1]} ${h[1]}"`);
    }
    tag = tag.replace(/\s(width|height)=(["'])[^"']*\2/g, '').replace('<svg', () => `<svg width="${fnum(width)}" height="${fnum(height)}"`);
  }
  if (!/\bfill=/.test(tag) && !/\bfill\s*:/.test(tag)) tag = tag.replace('<svg', () => `<svg fill="${colour}"`);
  if (alpha < 1) tag = tag.replace('<svg', () => `<svg opacity="${alpha}"`);
  return svg.replace(root, () => tag);
}
export const maskedLeaf = (node: MeasuredNode, hasChildren: boolean): string | null => hasChildren || node.text?.trim() ? null : maskedIconSvg(node);
export const positionedOut = (node: MeasuredNode): boolean => ['absolute', 'fixed'].includes(node.computed['position'] ?? '');
export interface PseudoGeometry { x: number; y: number; width: number; height: number; fill: Color; stacking: [number, number] }
export function pseudoGeometry(node: MeasuredNode, which: 'before' | 'after'): PseudoGeometry | null {
  const p = node[which] ?? {}, fill = parseColor(p['backgroundColor']);
  if ((p['content'] ?? '').replace(/^['"]+|['"]+$/g, '') || p['display'] === 'none' || !fill || !['absolute', 'fixed'].includes(p['position'] ?? '') || !node.computed['position'] || node.computed['position'] === 'static') return null;
  const width = px(p['width']), height = px(p['height']); if (width <= 0 || height <= 0) return null;
  const set = (v: string | undefined): boolean => v !== undefined && v !== 'auto';
  let x = set(p['left']) ? px(p['left']) : set(p['right']) ? node.box.width - px(p['right']) - width : 0;
  let y = set(p['top']) ? px(p['top']) : set(p['bottom']) ? node.box.height - px(p['bottom']) - height : 0;
  const m = /^matrix\(\s*1,\s*0,\s*0,\s*1,\s*([-\d.e]+),\s*([-\d.e]+)\)/.exec(p['transform'] ?? '');
  if (m) { x += Number(m[1]); y += Number(m[2]); }
  return { x: r2(x), y: r2(y), width: r2(width), height: r2(height), fill, stacking: stacking({ computed: { position: p['position']!, zIndex: p['zIndex'] ?? '' } }) };
}
export function translated(node: MeasuredNode): boolean {
  const m = /^matrix\(\s*[-\d.e]+,\s*[-\d.e]+,\s*[-\d.e]+,\s*[-\d.e]+,\s*([-\d.e]+),\s*([-\d.e]+)\)/.exec(node.computed['transform'] ?? '');
  return !!m && (Math.abs(Number(m[1])) > 0.5 || Math.abs(Number(m[2])) > 0.5);
}
export function rotation(transform?: string): number {
  const m = /^matrix\(\s*([-\d.e]+),\s*([-\d.e]+),/.exec(transform ?? '');
  if (!m) return 0; const angle = roundDecimal(Math.atan2(Number(m[2]), Number(m[1])) * 180 / Math.PI, 2);
  return Math.abs(angle) < 0.01 ? 0 : angle;
}
export type Style = Pick<TreeNode, 'fill' | 'stroke' | 'radius' | 'effects' | 'opacity' | 'clip' | 'backgroundImage'>;
export function styleOf(node: MeasuredNode): Style {
  const c = node.computed, d = node.declared ?? {}, style: Style = {}, fill = parseColor(c['backgroundColor']);
  if (fill) { fill.var = cssVar(d['background-color']); style.fill = fill; }
  const widths = SIDES.map(s => px(c[`border${cap(s)}Width`])), styles = SIDES.map(s => c[`border${cap(s)}Style`]);
  if (widths.some((w, i) => w > 0 && !['none', 'hidden'].includes(styles[i] ?? ''))) {
    const color = parseColor(c['borderTopColor']) ?? parseColor(c['borderBottomColor']);
    if (color) { color.var = cssVar(d['border-top-color'] || d['border-bottom-color']); style.stroke = { color, top: widths[0], right: widths[1], bottom: widths[2], left: widths[3] }; }
  }
  const radii = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'].map(k => px(c[k]));
  if (radii.some(Boolean)) style.radius = radii;
  const effects = parseShadow(c['boxShadow']); if (effects.length) style.effects = effects;
  const opacity = Number(c['opacity'] || 1); if (opacity < 1) style.opacity = opacity;
  if (clips(c)) style.clip = true;
  if (!['none', ''].includes(c['backgroundImage'] ?? 'none')) { const m = /url\("?([^")]+)"?\)/.exec(c['backgroundImage']!); if (m) style.backgroundImage = { src: m[1]!, fit: c['backgroundSize'] ?? 'cover' }; }
  return style;
}
export function textOf(node: MeasuredNode, chars: string): Text {
  const c = node.computed, d = node.declared ?? {}, family = (c['fontFamily'] || 'Inter').split(',')[0]!.trim().replace(/^['"]+|['"]+$/g, ''), color = parseColor(c['color']) ?? { hex: '#000000', opacity: 1 };
  color.var = cssVar(d['color']);
  return { characters: chars, family, stack: c['fontFamily'] || '', familyVar: cssVar(d['font-family']), weight: Number((c['fontWeight'] || '400').replace(/\D/g, '') || 400),
    italic: /^(italic|oblique)/.test(c['fontStyle'] ?? ''), size: px(c['fontSize']) || 16, lineHeight: (c['lineHeight'] ?? 'normal') === 'normal' ? null : px(c['lineHeight']), letterSpacing: px(c['letterSpacing']),
    align: ({ center: 'CENTER', right: 'RIGHT', end: 'RIGHT', justify: 'JUSTIFIED' } as Record<string, Text['align']>)[c['textAlign'] ?? 'left'] ?? 'LEFT',
    case: ({ uppercase: 'UPPER', lowercase: 'LOWER', capitalize: 'TITLE' } as Record<string, Text['case']>)[c['textTransform'] ?? 'none'] ?? 'ORIGINAL',
    underline: (c['textDecorationLine'] ?? '').includes('underline'), color, singleLine: singles(node, c) };
}
export function singles(node: MeasuredNode, c: Record<string, string>): boolean {
  const size = px(c['fontSize']) || 16, lh = c['lineHeight'] && c['lineHeight'] !== 'normal' ? px(c['lineHeight']) : size * 1.25;
  return node.box.height - px(c['paddingTop']) - px(c['paddingBottom']) - px(c['borderTopWidth']) - px(c['borderBottomWidth']) < lh * 1.5;
}
export function iconGlyph(chars: string): boolean { const shown = [...chars].filter(c => !/\s/u.test(c)); return !!shown.length && shown.every(c => c.codePointAt(0)! >= 0xe000 && c.codePointAt(0)! <= 0xf8ff); }
export function gridTracks(node: MeasuredNode): number | null { const c = node.computed; if (!['grid', 'inline-grid'].includes(c['display'] ?? '')) return 0; const tracks = (c['gridTemplateColumns'] ?? '').trim().split(/\s+/).filter(Boolean); return tracks.length && !(tracks.length === 1 && tracks[0] === 'none') ? tracks.length : null; }
export function padding(node: MeasuredNode): Padding { return Object.fromEntries(SIDES.map(side => [side, px(node.computed[`padding${cap(side)}`]) + px(node.computed[`border${cap(side)}Width`])])) as Padding; }
export function primaryAlign(offsets: number[], sizes: number[], start: number, avail: number, justify?: string): [NonNullable<Layout['primaryAlign']>, number] | null {
  const gaps = offsets.slice(1).map((o, i) => o - (offsets[i]! + sizes[i]!)), gap = gaps[0] ?? 0;
  if (gaps.some(g => Math.abs(g - gap) > TOLERANCE)) return null;
  const lead = offsets[0]! - start, trail = avail - (offsets.at(-1)! + sizes.at(-1)! - start);
  if (justify === 'space-between' && offsets.length > 1 && Math.abs(lead) <= TOLERANCE && Math.abs(trail) <= TOLERANCE) return ['SPACE_BETWEEN', r2(gap)];
  if (Math.abs(lead) <= TOLERANCE) return ['MIN', r2(gap)];
  if (Math.abs(lead - trail) <= TOLERANCE) return ['CENTER', r2(gap)];
  if (Math.abs(trail) <= TOLERANCE) return ['MAX', r2(gap)];
  return null;
}
export function crossAlign(offsets: number[], sizes: number[], start: number, avail: number): NonNullable<Layout['counterAlign']> | null {
  if (offsets.every(o => Math.abs(o - start) <= TOLERANCE)) return 'MIN';
  if (offsets.every((o, i) => Math.abs(o - start + sizes[i]! / 2 - avail / 2) <= TOLERANCE)) return 'CENTER';
  if (offsets.every((o, i) => Math.abs(o - start + sizes[i]! - avail) <= TOLERANCE)) return 'MAX';
  return null;
}
export type Rect = [number, number, number, number];
export function wrappedRows(rel: Rect[], pad: Padding, box: Box, justify?: string) {
  const rows: Rect[][] = [];
  for (const item of rel) { const prev = rows.at(-1)?.at(-1); if (prev && item[0] > prev[0] + prev[2] - TOLERANCE) rows.at(-1)!.push(item); else rows.push([item]); }
  let primary: Layout['primaryAlign'] | null = null, cross: Layout['counterAlign'] | null = null; const gaps: number[] = [];
  for (const row of rows) {
    const fit = primaryAlign(row.map(r => r[0]), row.map(r => r[2]), pad.left, box.width - pad.left - pad.right, justify);
    if (!fit || primary && fit[0] !== primary) return null; primary = fit[0]; if (row.length > 1) gaps.push(fit[1]);
    const top = Math.min(...row.map(r => r[1])), height = Math.max(...row.map(r => r[1] + r[3])) - top;
    const align = crossAlign(row.map(r => r[1]), row.map(r => r[3]), top, height);
    if (!align || cross && align !== cross) return null; cross = align;
  }
  if (gaps.some(g => Math.abs(g - gaps[0]!) > TOLERANCE)) return null;
  const tops = rows.map(row => Math.min(...row.map(r => r[1]))), bottoms = rows.map(row => Math.max(...row.map(r => r[1] + r[3])));
  if (Math.abs(tops[0]! - pad.top) > TOLERANCE) return null;
  const rowGaps = tops.slice(1).map((top, i) => top - bottoms[i]!);
  if (rowGaps.some(g => Math.abs(g - rowGaps[0]!) > TOLERANCE)) return null;
  return { gap: gaps[0] ?? 0, rowGap: r2(rowGaps[0] ?? 0), primary: primary!, cross: cross! };
}
export function inferLayout(node: MeasuredNode, kids: MeasuredNode[], stackedGrid = false): InferredLayout {
  const c = node.computed, b = node.box, pad = padding(node);
  if (!kids.length) return { mode: 'NONE', padding: pad };
  const rel: Rect[] = kids.map(k => [k.box.x - b.x, k.box.y - b.y, k.box.width, k.box.height]);
  let display = c['display'] ?? 'block'; if (stackedGrid && ['grid', 'inline-grid'].includes(display)) display = 'block';
  const horizontal = (['flex', 'inline-flex'].includes(display) && (c['flexDirection'] ?? 'row').startsWith('row')) || ['grid', 'inline-grid'].includes(display);
  const wrap = ['grid', 'inline-grid'].includes(display) || c['flexWrap'] === 'wrap';
  if (horizontal && !wrap) {
    const primary = primaryAlign(rel.map(r => r[0]), rel.map(r => r[2]), pad.left, b.width - pad.left - pad.right, c['justifyContent']);
    const align = crossAlign(rel.map(r => r[1]), rel.map(r => r[3]), pad.top, b.height - pad.top - pad.bottom);
    if (primary && align) return { mode: 'HORIZONTAL', gap: primary[1], primaryAlign: primary[0], padding: pad, counterAlign: align };
  } else if (horizontal && wrap) {
    const fit = wrappedRows(rel, pad, b, c['justifyContent']);
    if (fit) return { mode: 'HORIZONTAL', wrap: true, gap: fit.gap, counterGap: fit.rowGap, primaryAlign: fit.primary, padding: pad, counterAlign: fit.cross };
  } else {
    const column = ['flex', 'inline-flex'].includes(display);
    const align = crossAlign(rel.map(r => r[0]), rel.map(r => r[2]), pad.left, b.width - pad.left - pad.right);
    const primary = primaryAlign(rel.map(r => r[1]), rel.map(r => r[3]), pad.top, b.height - pad.top - pad.bottom, column ? c['justifyContent'] : undefined);
    if (primary && align && (column || primary[0] === 'MIN')) return { mode: 'VERTICAL', gap: primary[1], primaryAlign: primary[0], padding: pad, counterAlign: align };
    if (align && !column) {
      const lead = rel[0]![1] - pad.top, gaps = rel.slice(1).map((r, i) => r[1] - (rel[i]![1] + rel[i]![3]));
      if (lead >= -TOLERANCE && gaps.every(g => g >= -TOLERANCE)) {
        const padded = { ...pad, top: r2(pad.top + Math.max(lead, 0)) };
        if (gaps.every(g => Math.abs(g - gaps[0]!) <= TOLERANCE)) return { mode: 'VERTICAL', gap: r2(gaps[0] ?? 0), primaryAlign: 'MIN', padding: padded, counterAlign: align };
        return { mode: 'VERTICAL', gap: 0, primaryAlign: 'MIN', padding: padded, counterAlign: align, spacers: gaps.map(g => r2(Math.max(g, 0))) };
      }
    }
  }
  return { mode: 'NONE', padding: pad, fellBack: true };
}
export interface FlatNode {
  kind: TreeNode['kind']; name: string; source?: string; tag?: string; x: number; y: number; width: number; height: number;
  text?: Text; layout?: InferredLayout; children?: FlatNode[]; [key: string]: unknown;
}
export function convert(node: MeasuredNode, index: Index, rootBlock: string | null, label: string | null, bp = ''): FlatNode | null {
  if (!visible(node)) return null;
  const b = node.box, name = node.path.split('/').length === 2 ? label : nodeName(node, rootBlock);
  const base = { name: name || 'Container', tag: node.tag, x: r2(b.x), y: r2(b.y), width: r2(b.width), height: r2(b.height), source: node.path };
  const crop = `capture:${bp}:${[base.x, base.y, base.width, base.height].map(fnum).join(',')}`;
  if (['iframe', 'video', 'canvas', 'object', 'embed'].includes(node.tag)) return { ...base, kind: 'image', name: 'Embed', src: crop, fit: 'FILL' };
  const icon = maskedLeaf(node, (index[node.path] ?? []).some(visible)); if (icon) return { ...base, kind: 'svg', name: 'Icon', svg: icon };
  if (node.svg) return { ...base, kind: 'svg', svg: node.svg, color: parseColor(node.computed['color']) };
  if (node.image) return { ...base, kind: 'image', src: node.image.src, fit: node.computed['objectFit'] === 'contain' ? 'FIT' : 'FILL', ...styleOf(node) };
  const kidsRaw = (index[node.path] ?? []).filter(visible), style = styleOf(node), chars = node.inlineText || (!kidsRaw.length ? node.text : null);
  if (chars && !kidsRaw.length && iconGlyph(chars)) return { ...base, kind: 'image', name: 'Icon', src: crop, fit: 'FIT' };
  if (chars && (node.inlineText || !kidsRaw.length)) {
    const text: FlatNode = { ...base, kind: 'text', text: textOf(node, chars) };
    if (!Object.keys(style).length && !SIDES.some(s => px(node.computed[`padding${cap(s)}`]))) return text;
    const layout = inferLayout(node, []), p = layout.padding;
    const inner = { ...text, name: 'Label', x: r2(b.x + p.left), y: r2(b.y + p.top), width: r2(b.width - p.left - p.right), height: r2(b.height - p.top - p.bottom) };
    return { ...base, kind: 'frame', ...style, layout: { mode: 'VERTICAL', gap: 0, padding: p, counterAlign: text.text!.align === 'CENTER' ? 'CENTER' : text.text!.align === 'RIGHT' ? 'MAX' : 'MIN' }, children: [inner] };
  }
  let children = kidsRaw.map(k => convert(k, index, rootBlock, null, bp)).filter((c): c is FlatNode => !!c);
  if (!Object.keys(style).length && children.length === 1 && node.path.split('/').length > 2) {
    const only = children[0]!; if (Math.abs(only.width - base.width) <= TOLERANCE && Math.abs(only.height - base.height) <= TOLERANCE) return only;
  }
  const layout = inferLayout(node, kidsRaw.filter(k => convert(k, index, rootBlock, null, bp))), spacers = layout.spacers; delete layout.spacers;
  if (spacers?.length) {
    const innerWidth = r2(b.width - layout.padding.left - layout.padding.right);
    children = children.flatMap((child, i) => i < spacers.length && spacers[i]! > 0 ? [child, { kind: 'frame', name: 'Spacer', width: innerWidth, height: spacers[i]!, x: child.x, y: r2(child.y + child.height), layout: { mode: 'NONE', padding: { top: 0, right: 0, bottom: 0, left: 0 } }, children: [] } as FlatNode] : [child]);
  }
  return { ...base, kind: 'frame', ...style, layout, children };
}
export function build(spec: Spec, label?: string | null) {
  const order = ['mobile', 'tablet', 'desktop'];
  const breakpoints = Object.entries(spec.measurements).sort(([a], [b]) => {
    const ai = order.indexOf(a.split(':')[0]!), bi = order.indexOf(b.split(':')[0]!); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  }).map(([key, measurement]) => {
    const [breakpoint, state] = key.split(':');
    if ('error' in measurement) return { breakpoint, state, error: measurement.error };
    const nodes = measurement.nodes as MeasuredNode[], root = nodes[0]!;
    const block = root.classes.find(c => !c.includes('__') && !c.includes('--')) ?? null;
    return { breakpoint, state, tree: convert(root, buildIndex(nodes), block, label || spec.component, breakpoint) };
  });
  return { component: spec.component, machineName: spec.machineName, label: label || spec.component, breakpoints };
}
export function compact(tree: TreeNode | FlatNode): { styles: Omit<Text, 'characters'>[]; tree: Record<string, unknown> } {
  const styles: Omit<Text, 'characters'>[] = [], keys = new Map<string, number>();
  const walk = (node: TreeNode | FlatNode): Record<string, unknown> => {
    const out = Object.fromEntries(Object.entries(node).filter(([k]) => !['children', 'text', 'layout'].includes(k)));
    if (node.text) {
      const { characters, ...style } = node.text, key = pythonJson(style);
      if (!keys.has(key)) { keys.set(key, styles.length); styles.push(style); }
      out['chars'] = characters; out['ts'] = keys.get(key);
    }
    if (node.layout) {
      const { padding: pad, ...layout } = node.layout, values = SIDES.map(s => pad?.[s] ?? 0);
      if (values.some(Boolean)) layout['pad'] = values; out['layout'] = layout;
    }
    if (node.children) out['children'] = node.children.map(walk); return out;
  };
  return { styles, tree: walk(tree) };
}
