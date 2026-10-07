import type { Spec, MeasuredNode } from './generated/spec.ts';
import type { TreeNode } from './generated/tree.ts';
import { roundDecimal } from './json.ts';
import type { Measured } from './capture/types.ts';
export function signature(tree: TreeNode): [number, number] {
  let texts = 0, images = 0; const stack = [tree];
  while (stack.length) { const node = stack.pop()!; if (node.kind === 'text') texts++; else if (node.kind === 'image' && node.src && !node.src.startsWith('capture:')) images++; stack.push(...node.children ?? []); }
  return [texts, images];
}
function shown(box: MeasuredNode['box'], width: number, height: number): number {
  const w = Math.max(0, Math.min(box.x + box.width, width) - Math.max(box.x, 0)), h = Math.max(0, Math.min(box.y + box.height, height) - Math.max(box.y, 0));
  return w * h / Math.max(1, box.width * box.height);
}
export function subtree(spec: Spec, child: string): [Record<string, Measured>, Record<string, MeasuredNode['box']>] | null {
  const shownAt = new Map<string, number[]>();
  const measurements = Object.entries(spec.measurements).filter((entry): entry is [string, Measured] => Array.isArray(entry[1]['nodes']));
  for (const [, m] of measurements) {
    const frame = m.rootBox ?? m.nodes[0]?.box;
    for (const n of m.nodes) if (n.attributes?.['data-design-lab-child'] === child) { const values = shownAt.get(n.path) ?? []; values.push(shown(n.box, frame?.width ?? 0, frame?.height ?? 0)); shownAt.set(n.path, values); }
  }
  const everywhere = [...shownAt].filter(([, values]) => values.length === measurements.length).map(([path, values]) => [path, Math.min(...values)] as const);
  everywhere.sort((a, b) => b[1] - a[1]); const chosen = everywhere[0]; if (!chosen || chosen[1] < 0.8) return null;
  const derived: Record<string, Measured> = {}, boxes: Record<string, MeasuredNode['box']> = {};
  for (const [key, m] of measurements) {
    const root = m.nodes.find(n => n.path === chosen[0])!, ox = root.box.x, oy = root.box.y, cut = root.path.lastIndexOf('/');
    const nodes = m.nodes.filter(n => n.path === root.path || n.path.startsWith(root.path + '/')).map(n => ({ ...n, path: n.path.slice(cut), box: { ...n.box, x: roundDecimal(n.box.x - ox, 2), y: roundDecimal(n.box.y - oy, 2) } }));
    const byPath = new Map(m.nodes.map(n => [n.path, n])); let backdrop = m.backdrop, up = root.path.slice(0, cut);
    while (up) { const color = byPath.get(up)?.computed['backgroundColor'] ?? ''; if (color && color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color)) { backdrop = color; break; } up = up.slice(0, up.lastIndexOf('/')); }
    derived[key] = { rootBox: { width: root.box.width, height: root.box.height }, nodes, backdrop }; boxes[key.split(':')[0]!] = root.box;
  }
  return measurements.length ? [derived, boxes] : null;
}
export function childrenFirst<T extends { id: string }>(built: T[], components: { id: string; slots?: { accepts?: string[] }[] }[]): T[] {
  const by = new Map(components.map(c => [c.id, c])), wanted = new Map(built.map(b => [b.id, b])), out: T[] = [], seen = new Set<string>();
  const visit = (id: string, path = new Set<string>()): void => {
    if (seen.has(id) || path.has(id) || !wanted.has(id)) return;
    const next = new Set([...path, id]); for (const slot of by.get(id)?.slots ?? []) for (const child of slot.accepts ?? []) visit(child, next);
    seen.add(id); out.push(wanted.get(id)!);
  };
  for (const b of built) visit(b.id); return out;
}
export interface VariantOption { value?: string; label?: string }
export function variantValues(fields: { name: string; options?: VariantOption[] }[], axes: { field: string; label?: string }[], nodes: Pick<MeasuredNode, 'classes'>[]): { axis: string; field: string; value: string | null; others: (string | undefined)[] }[] {
  const by = new Map(fields.map(f => [f.name, f])), words = nodes.slice(0, 8).flatMap(n => (n.classes ?? []).map(cls => cls.toLowerCase().split(/[-_]+/)));
  const synonyms: Record<string, string[]> = { left: ['start'], right: ['end'], center: ['middle'] }, generic = new Set(['none', 'default', 'auto', 'normal', 'inherit']);
  return axes.filter(a => a.field !== 'Breakpoint').map(axis => {
    const options = by.get(axis.field)?.options ?? [], fieldWords = new Set(axis.field.toLowerCase().split(/[-_]+/).filter(w => w !== 'field'));
    const hits = options.filter(option => {
      const value = String(option.value ?? '').toLowerCase(), names = [value.split(/[-_]+/), ...(synonyms[value] ?? []).map(s => [s])];
      return words.some(parts => names.some(name => name.length && !(name.length === 1 && !name[0]) && parts.some((_, i) => i + name.length <= parts.length && name.every((w, j) => parts[i + j] === w)) && (!generic.has(value) || parts.some(w => fieldWords.has(w)))));
    });
    const seen = hits.length === 1 ? hits[0] : undefined;
    return { axis: axis.label || axis.field, field: axis.field, value: seen ? seen.label || seen.value || null : null, others: options.filter(o => o !== seen).map(o => o.label || o.value) };
  });
}
