import type { TreeNode, Text, Layout } from './generated/tree.ts';
import { assertNever } from './assert-never.ts';
import { iconGlyph, px, visible } from './spec-to-tree.ts';

export const GEOMETRY_TOLERANCE = 2, FONT_TOLERANCE = 0.5;
export function resolveVariables(value: any, variables: Record<string, any>, breakpoint: string): any {
  if (Array.isArray(value)) return value.map(v => resolveVariables(v, variables, breakpoint));
  if (value && typeof value === 'object') {
    if (typeof value.var === 'string' && variables[value.var]) return variables[value.var].values[breakpoint[0]!.toUpperCase() + breakpoint.slice(1)];
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, resolveVariables(v, variables, breakpoint)]));
  }
  return value;
}
/** Layout comparison runs after variable resolution: geometry/visibility are scalar. */
type ResolvedTreeNode = TreeNode extends infer Node ? Node extends TreeNode
  ? Omit<Node,'width'|'height'|'visible'|'children'|'layout'> & {width?:number;height?:number;visible?:boolean;children?:ResolvedTreeNode[];layout?:Omit<Layout,'padding'|'gap'|'counterGap'> & {padding?:Partial<Record<'top'|'right'|'bottom'|'left',number>>;gap?:number;counterGap?:number}}
  : never : never;
function renderedText(node: ResolvedTreeNode): Text | undefined {
  switch (node.kind) {
    case 'text': return node.text;
    case 'frame': case 'image': case 'svg': case 'instance': return undefined;
    default: return assertNever(node);
  }
}
export interface LayoutRow { node: ResolvedTreeNode; box: { x: number | null; y: number | null; width: number | null; height: number | null } }
export function layoutNodes(tree: ResolvedTreeNode): LayoutRow[] {
  const rows: LayoutRow[] = [];
  const walk = (node: ResolvedTreeNode, x: number | null, y: number | null, width: number | null = node.width ?? null, height: number | null = node.height ?? null): void => {
    if (node.visible === false) return;
    width ??= node.width ?? null; height ??= node.height ?? null;
    rows.push({ node, box: { x, y, width, height } });
    const layout: Partial<NonNullable<ResolvedTreeNode['layout']>> = node.layout ?? {}, mode = layout.mode ?? 'NONE', kids = (node.children ?? []).filter((c: any) => c.visible !== false);
    if (mode === 'NONE') { for (const child of kids) walk(child, x === null ? null : x + (child.x ?? 0), y === null ? null : y + (child.y ?? 0)); return; }
    const pad = layout.padding ?? {}, left = pad.left ?? 0, top = pad.top ?? 0, innerW = width === null ? null : Math.max(0, width - left - (pad.right ?? 0)), innerH = height === null ? null : Math.max(0, height - top - (pad.bottom ?? 0)), horizontal = mode === 'HORIZONTAL', primary = horizontal ? innerW : innerH, cross = horizontal ? innerH : innerW, gap = layout.gap ?? 0;
    const flow = kids.filter((c: any) => !c.absolute), sizes: [number | null, number | null][] = flow.map((child: any) => [child.sizing === 'FILL' && !horizontal ? innerW : child.width ?? null, child.height ?? null]);
    const fills = flow.map((c: any, i: number) => horizontal && c.sizing === 'FILL' ? i : -1).filter((i: number) => i >= 0);
    if (fills.length && primary !== null && sizes.every((s, i) => fills.includes(i) || s[0] !== null)) { const remaining = primary - gap * Math.max(0, flow.length - 1) - sizes.reduce((n, s, i) => n + (fills.includes(i) ? 0 : s[0]!), 0); for (const i of fills) sizes[i]![0] = Math.max(0, remaining / fills.length); }
    const lines: { child: any; size: [number | null, number | null] }[][] = []; let line: { child: any; size: [number | null, number | null] }[] = [], used = 0;
    for (let i = 0; i < flow.length; i++) { const child = flow[i]!, size = sizes[i]!, extent = size[horizontal ? 0 : 1]; if (layout.wrap && line.length && primary !== null && extent !== null && used + gap + extent > primary + 0.01) { lines.push(line); line = []; used = 0; } line.push({ child, size }); used += (line.length > 1 ? gap : 0) + (extent ?? 0); }
    if (line.length) lines.push(line);
    let crossCursor: number | null = 0;
    for (const current of lines) {
      const extents = current.map(r => r.size[horizontal ? 0 : 1]), crosses = current.map(r => r.size[horizontal ? 1 : 0]), known = extents.every(v => v !== null), occupied = known ? extents.reduce((n, v) => n + v!, 0) + gap * Math.max(0, current.length - 1) : null, spare = primary !== null && occupied !== null ? Math.max(0, primary - occupied) : null, align = layout.primaryAlign ?? 'MIN';
      let cursor: number | null = align === 'MIN' ? 0 : align === 'CENTER' ? spare === null ? null : spare / 2 : spare;
      const spacing = align === 'SPACE_BETWEEN' && spare !== null && current.length > 1 ? spare / (current.length - 1) : 0, lineCross = crosses.every(v => v !== null) ? Math.max(...crosses as number[]) : null, availableCross = layout.wrap ? lineCross : cross;
      for (const { child, size: [w, h] } of current) {
        const extent = horizontal ? w : h, across = horizontal ? h : w, counter = layout.counterAlign ?? 'MIN'; let offset: number | null = 0;
        if (counter !== 'MIN') { const free = availableCross !== null && across !== null ? availableCross - across : null; offset = counter === 'CENTER' ? free === null ? null : free / 2 : free; }
        const px = horizontal ? cursor : offset, py = horizontal ? crossCursor === null || offset === null ? null : crossCursor + offset : cursor;
        walk(child, x === null || px === null ? null : x + left + px, y === null || py === null ? null : y + top + py, w, h);
        cursor = cursor !== null && extent !== null ? cursor + extent + gap + spacing : null;
      }
      crossCursor = crossCursor !== null && lineCross !== null ? crossCursor + lineCross + (layout.counterGap ?? 0) : null;
    }
    for (const child of kids.filter((c: any) => c.absolute)) walk(child, x === null ? null : x + (child.x ?? 0), y === null ? null : y + (child.y ?? 0));
  };
  walk(tree, 0, 0); return rows;
}
export function metric(checks: Record<string, any>[]) { return { passed: checks.filter(c => c.pass === true).length, total: checks.length, unmeasured: checks.filter(c => c.pass === null).length, checks }; }
export function numericCheck(source: string, property: string, expected: unknown, actual: unknown, tolerance: number) {
  const measured = typeof expected === 'number' && typeof actual === 'number';
  return { source, property, expected: expected ?? null, actual: actual ?? null, pass: measured ? Math.abs((expected as number) - (actual as number)) <= tolerance : null as boolean | null };
}
export function alignment(value: any) { return ({ start: 'LEFT', end: 'RIGHT', left: 'LEFT', right: 'RIGHT', center: 'CENTER', justify: 'JUSTIFIED' } as Record<string, string>)[value] ?? value; }
export function compare(tree: Record<string, any>, spec: Record<string, any>): Record<string, any> {
  const reports: Record<string, any> = {};
  for (const [key, measurement] of Object.entries(spec.measurements ?? {}) as [string, any][]) {
    const [breakpoint = '', state = ''] = key.split(':');
    if (measurement.error || !measurement.nodes?.length) { reports[key] = { status: 'unmeasured', reason: measurement.error || 'no nodes' }; continue; }
    if (state !== 'default' || !(tree.measured ?? []).includes(breakpoint)) { reports[key] = { status: 'unmeasured', reason: 'build tree has no measured mode for this state' }; continue; }
    const nodes = measurement.nodes.filter((n: any) => visible(n)), rootBox = measurement.nodes[0].box, resolved = resolveVariables(tree.tree, tree.variables ?? {}, breakpoint), rendered = layoutNodes(resolved), bySource = new Map<string, LayoutRow[]>();
    for (const row of rendered) { const source = row.node.source; if (source) bySource.set(source, [...(bySource.get(source) ?? []), row]); }
    const geometry: any[] = [], fonts: any[] = [], aligns: any[] = [], runs: any[] = [], images: any[] = [], inline = nodes.filter((n: any) => n.inlineText);
    for (const node of nodes) {
      const path = node.path, candidates = bySource.get(path) ?? [], row = candidates[0], consumed = inline.some((n: any) => path.startsWith(n.path + '/'));
      if (!consumed) for (const property of ['x', 'y', 'width', 'height'] as const) { const expected = node.box[property] - (property === 'x' || property === 'y' ? rootBox[property] : 0), check = numericCheck(path, property, expected, row?.box[property], GEOMETRY_TOLERANCE); if (!row) check.pass = false; geometry.push(check); }
      const texts = rendered.flatMap(r => { if (![path, path + '#label'].includes(r.node.source)) return []; const text = renderedText(r.node); return text ? [text] : []; }), leafText = node.inlineText || (!nodes.some((n: any) => n.path.startsWith(path + '/')) ? node.text : null);
      if (leafText && !consumed && !iconGlyph(leafText)) {
        const text: Partial<Text> & {runs?:{text?:string}[]} = texts[0] ?? {}, font = numericCheck(path, 'fontSize', px(node.computed?.fontSize), text.size, FONT_TOLERANCE); if (!texts.length) font.pass = false; fonts.push(font);
        const expectedAlign = alignment(node.computed?.textAlign ?? 'start'); aligns.push({ source: path, expected: expectedAlign, actual: text.align ?? null, pass: expectedAlign === text.align });
        const styles = new Set(nodes.filter((n: any) => n.path === path || (node.inlineText && n.path.startsWith(path + '/') && n.text)).map((n: any) => JSON.stringify(['fontWeight', 'fontStyle', 'color', 'textDecorationLine'].map(p => n.computed?.[p])))), expectedRuns = (node.textRuns ?? node.runs ?? []).length || Math.max(1, styles.size), actualRuns = (text.runs ?? []).length || (Object.keys(text).length ? 1 : 0);
        runs.push({ source: path, expected: expectedRuns, actual: actualRuns, basis: node.textRuns?.length || node.runs?.length ? 'recorded runs' : 'distinct measured inline styles', pass: expectedRuns === actualRuns, flattened: expectedRuns > actualRuns });
      }
      const src = node.image?.src, background = node.computed?.backgroundImage ?? 'none', match = /url\(['"]?(.*?)['"]?\)/.exec(background);
      for (const expected of [src, match?.[1]].filter(Boolean)) { const actual = candidates.map(r => r.node.src || r.node.backgroundImage?.src); images.push({ source: path, expected, pass: actual.includes(expected) || (String(expected).startsWith('data:image/svg+xml') && candidates.some(r => r.node.kind === 'svg')) }); }
    }
    reports[key] = { status: 'measured', geometry: metric(geometry), fontSize: metric(fonts), textAlignment: metric(aligns), textRunCount: metric(runs), imagesPresent: metric(images), nodeCount: { measured: nodes.length, built: rendered.length, delta: rendered.length - nodes.length } };
  }
  return reports;
}
