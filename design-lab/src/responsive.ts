import { isEntrypoint } from './entrypoint.ts';
import type { Spec, MeasuredNode } from './generated/spec.ts';
import type { Tree, TreeNode, Layout, Text, VariableBinding } from './generated/tree.ts';
import * as st from './spec-to-tree.ts';
import type { Box, Index, Padding, PseudoGeometry, PseudoImage, Rect } from './spec-to-tree.ts';
import { sorted } from './json.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeArtifact } from './contracts.ts';
import { LookupError, at, lastOf, pick } from './lookup.ts';
export const MODES = ['desktop', 'tablet', 'mobile'];
export const MODE_NAMES: Record<string, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };
const TOL = st.TOLERANCE;
export const slug = (text: string): string =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'node';
/** A geometry lookup found nothing: names the breakpoint and path (or quantity) that was missing. */
export class GeometryError extends LookupError {
  readonly breakpoint: string | null;
  readonly path: string | null;
  constructor(message: string, breakpoint: string | null = null, path: string | null = null) {
    super(message);
    this.name = 'GeometryError';
    this.breakpoint = breakpoint;
    this.path = path;
  }
}
const pathIndex = (path: string): string => {
  const index = /\[(\d+)\]$/.exec(path)?.[1];
  if (index === undefined) throw new GeometryError(`path "${path}" does not end in an [index]`, null, path);
  return index;
};
const iconSrc = (icon: PseudoImage, path: string, which: string): string => {
  if (icon.src === undefined)
    throw new GeometryError(`the ${which} icon of "${path}" has neither svg nor src`, null, path);
  return icon.src;
};
const first = <T>(doc: Record<string, T>): T => at(Object.values(doc), 0, 'first per-breakpoint value');
const per = <T, R>(doc: Record<string, T>, fn: (value: T, key: string) => R): Record<string, R> =>
  Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, fn(v, k)]));
type Stacking = [number, number];
const compare = (a: Stacking, b: Stacking): number => (a[0] !== b[0] ? a[0] - b[0] : a[1] !== b[1] ? a[1] - b[1] : 0);
const fnum = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));
type Scalar = number | boolean | string;
type Value<T extends Scalar = number> = T | VariableBinding;
type Slot = Record<'width' | 'padLeft' | 'padTop', Value>;
export class Merge {
  label: string;
  key: string;
  bps: string[];
  nodes: Record<string, Record<string, MeasuredNode>> = {};
  index: Record<string, Index> = {};
  widths: Record<string, number> = {};
  variables: Tree['variables'] = {};
  slotted: Record<string, Record<string, Slot>> = {};
  private readonly stacking = new WeakMap<TreeNode, Stacking>();
  fallbacks: string[] = [];
  notes: string[] = [];
  rootPath: string;
  rootBlock: string | null;
  constructor(spec: Spec, label: string, key: string) {
    this.label = label;
    this.key = key;
    this.bps = MODES.filter((bp) => {
      const m = spec.measurements[`${bp}:default`];
      return m && !('error' in m);
    });
    for (const bp of this.bps) {
      const m = pick(spec.measurements, `${bp}:default`, `measurement for breakpoint "${bp}"`);
      if (!('nodes' in m) || !Array.isArray(m.nodes)) throw new Error('measurement has no nodes');
      const nodes = m.nodes;
      this.nodes[bp] = Object.fromEntries(nodes.map((n) => [n.path, n]));
      this.index[bp] = st.buildIndex(nodes);
      this.widths[bp] =
        (m.rootBox as { width: number } | undefined)?.width ??
        at(nodes, 0, `nodes measured at breakpoint "${bp}"`).box.width;
    }
    const firstBp = this.bps[0],
      root = firstBp === undefined ? undefined : Object.values(this.nodes[firstBp] ?? {})[0];
    if (!root) throw new Error('no successful default measurement');
    this.rootPath = root.path;
    this.rootBlock = root.classes.find((c) => !c.includes('__') && !c.includes('--')) ?? null;
  }
  value<T extends Scalar>(
    perBp: Record<string, T | null>,
    name: string,
    kind: 'FLOAT' | 'BOOLEAN' | 'STRING' = 'FLOAT',
  ): Value<T> | null {
    const vals: Record<string, T> = Object.fromEntries(
      this.bps.flatMap((bp) => {
        const v = perBp[bp];
        return v === undefined || v === null ? [] : [[bp, v]];
      }),
    );
    if (!Object.keys(vals).length) return null;
    if (new Set(Object.values(vals).map((v) => JSON.stringify(v))).size === 1) return first(vals);
    const variable = `${this.key}/${name}`;
    this.variables[variable] = {
      type: kind,
      values: Object.fromEntries(
        MODES.map((bp) => [pick(MODE_NAMES, bp, 'mode name'), vals[bp] ?? vals['desktop'] ?? first(vals)]),
      ),
    };
    return { var: variable };
  }
  /** A value every caller needs: `value()` is null only when no breakpoint measured one. */
  need<T extends Scalar>(
    perBp: Record<string, T | null>,
    name: string,
    kind: 'FLOAT' | 'BOOLEAN' | 'STRING' = 'FLOAT',
  ): Value<T> {
    const v = this.value(perBp, name, kind);
    if (v === null) throw new GeometryError(`no breakpoint has a value for "${this.key}/${name}"`);
    return v;
  }
  table(bp: string): Record<string, MeasuredNode> {
    return pick(this.nodes, bp, 'measured nodes');
  }
  indexFor(bp: string): Index {
    return pick(this.index, bp, 'child index');
  }
  maybeNode(bp: string, path: string): MeasuredNode | undefined {
    return this.table(bp)[path];
  }
  visibleNode(bp: string, path: string): MeasuredNode | undefined {
    const node = this.maybeNode(bp, path);
    return node && st.visible(node) ? node : undefined;
  }
  nodeAt(bp: string, path: string): MeasuredNode {
    const node = this.maybeNode(bp, path);
    if (!node) throw new GeometryError(`no measured node at "${path}" in the "${bp}" breakpoint`, bp, path);
    return node;
  }
  refNode(path: string): MeasuredNode {
    return this.nodeAt(this.refBp(path), path);
  }
  slotFor(path: string, kid: string): Slot {
    const slot = this.slotted[path]?.[kid];
    if (!slot) throw new GeometryError(`no slot for "${kid}" inside "${path}"`, null, kid);
    return slot;
  }
  visibleIn(path: string): Record<string, boolean> {
    return Object.fromEntries(this.bps.map((bp) => [bp, !!this.visibleNode(bp, path)]));
  }
  box(bp: string, path: string): Box {
    return this.nodeAt(bp, path).box;
  }
  childrenOf(bp: string, path: string): MeasuredNode[] {
    return (this.indexFor(bp)[path] ?? []).flatMap((k) =>
      st.passthrough(k, !!this.indexFor(bp)[k.path]?.length) ? this.childrenOf(bp, k.path) : [k],
    );
  }
  kids(bp: string, path: string): MeasuredNode[] {
    const visible = this.childrenOf(bp, path).filter(st.visible),
      flow = visible.filter((k) => !st.positionedOut(k));
    return flow.length ? flow : visible;
  }
  visualOrder(path: string, kidPaths: string[]): string[] {
    const orders: string[][] = [];
    for (const bp of this.bps) {
      if (!this.visibleNode(bp, path)) continue;
      if (!kidPaths.every((k) => this.visibleIn(k)[bp])) return kidPaths;
      const rows: string[][] = [];
      for (const k of [...kidPaths].sort((a, b) => this.box(bp, a).y - this.box(bp, b).y)) {
        const b = this.box(bp, k),
          row = rows.at(-1);
        if (row && b.y < Math.max(...row.map((r) => this.box(bp, r).y + this.box(bp, r).height)) - TOL) row.push(k);
        else rows.push([k]);
      }
      orders.push(rows.flatMap((row) => row.sort((a, b) => this.box(bp, a).x - this.box(bp, b).x)));
    }
    return orders.length &&
      orders.every((o) => JSON.stringify(o) === JSON.stringify(orders[0])) &&
      JSON.stringify(orders[0]) !== JSON.stringify(kidPaths)
      ? at(orders, 0, 'visual orders')
      : kidPaths;
  }
  positionedKids(kidPaths: string[]): string[] {
    const out = kidPaths.filter((k) => st.positionedOut(this.refNode(k)));
    return out.length < kidPaths.length ? out : [];
  }
  pseudoBox(path: string, which: 'before' | 'after', chain: string): TreeNode | null {
    const by: Record<string, PseudoGeometry> = {};
    for (const bp of this.bps) {
      const node = this.visibleNode(bp, path),
        box = node ? st.pseudoGeometry(node, which) : null;
      if (!box || !node) continue;
      const root = this.box(bp, this.rootPath),
        ox = node.box.x - root.x,
        oy = node.box.y - root.y;
      const left = Math.max(box.x, -ox),
        top = Math.max(box.y, -oy),
        right = Math.min(box.x + box.width, root.width - ox),
        bottom = Math.min(box.y + box.height, root.height - oy);
      if (right <= left || bottom <= top) continue;
      by[bp] = { ...box, x: st.r2(left), y: st.r2(top), width: st.r2(right - left), height: st.r2(bottom - top) };
    }
    if (!Object.keys(by).length) return null;
    const ref = by['desktop'] ?? first(by),
      name = `${this.nameFor(path, chain)[1]}-${which}`;
    const out: TreeNode = {
      kind: 'frame',
      name: 'Decoration',
      source: `${path}::${which}`,
      sizing: 'FIXED',
      absolute: true,
      x: ref.x,
      y: ref.y,
      fill: ref.fill,
      width: this.need(
        per(by, (b) => b.width),
        `${name}/width`,
      ),
      height: this.need(
        per(by, (b) => b.height),
        `${name}/height`,
      ),
      layout: { mode: 'NONE' },
      children: [],
    };
    this.stacking.set(out, ref.stacking);
    if (Object.keys(by).length !== this.bps.length)
      out.visible = this.need(Object.fromEntries(this.bps.map((bp) => [bp, bp in by])), `${name}/visible`, 'BOOLEAN');
    return out;
  }
  childPaths(path: string): string[] {
    const seen = new Set<string>();
    for (const bp of this.bps)
      for (const kid of this.childrenOf(bp, path))
        if (Object.values(this.visibleIn(kid.path)).some(Boolean)) seen.add(kid.path);
    return [...seen].sort((a, b) => Number(pathIndex(a)) - Number(pathIndex(b)));
  }
  refBp(path: string): string {
    const vis = this.visibleIn(path),
      bp = this.bps.find((b) => vis[b]);
    if (bp === undefined)
      throw new GeometryError(
        `"${path}" is visible in none of the measured breakpoints (${this.bps.join(', ')})`,
        null,
        path,
      );
    return bp;
  }
  nameFor(path: string, chain: string): [string, string] {
    const name = (path === this.rootPath ? this.label : st.nodeName(this.refNode(path), this.rootBlock)) || 'Container';
    const index = pathIndex(path);
    return [name, chain ? `${slug(name)}-${index}` : slug(name)];
  }
  convert(path: string, parentInner: Record<string, number> | null, chain: string): TreeNode | null {
    const vis = this.visibleIn(path);
    if (!Object.values(vis).some(Boolean)) return null;
    const rb = this.refBp(path),
      node = this.nodeAt(rb, path),
      [name, vchain] = this.nameFor(path, chain);
    const out: TreeNode = { kind: 'frame', name, source: path, sizing: 'FIXED' };
    const childOf = node.attributes?.['data-design-lab-child'];
    if (childOf) out.instanceOf = childOf;
    if (!Object.values(vis).every(Boolean)) out.visible = this.need(vis, `${vchain}/visible`, 'BOOLEAN');
    const widths = Object.fromEntries(this.bps.filter((bp) => vis[bp]).map((bp) => [bp, this.box(bp, path).width]));
    const heights = Object.fromEntries(this.bps.filter((bp) => vis[bp]).map((bp) => [bp, this.box(bp, path).height]));
    const fill =
      parentInner !== null &&
      Object.entries(widths)
        .filter(([bp]) => bp in parentInner)
        .every(([bp, width]) => Math.abs(width - pick(parentInner, bp, 'parent inner width')) <= TOL);
    out.sizing = fill ? 'FILL' : 'FIXED';
    out.width = this.need(per(widths, st.r2), `${vchain}/width`);
    out.height = this.need(per(heights, st.r2), `${vchain}/height`);
    out.x = st.r2(node.box.x);
    out.y = st.r2(node.box.y);
    if (st.clips(node.computed)) out.clip = true;
    if (['iframe', 'video', 'canvas', 'object', 'embed'].includes(node.tag)) {
      const shots: TreeNode[] = this.bps
        .filter((bp) => vis[bp])
        .map((bp) => {
          const b = this.box(bp, path),
            shot: TreeNode = {
              kind: 'image',
              name: `Embed · ${MODE_NAMES[bp]}`,
              source: `${path}#${bp}`,
              sizing: 'FILL',
              width: st.r2(b.width),
              height: st.r2(b.height),
              src: `capture:${bp}:${[b.x, b.y, b.width, b.height].map((v) => fnum(st.r2(v))).join(',')}`,
              fit: 'FILL',
              x: 0,
              y: 0,
            };
          if (Object.values(vis).filter(Boolean).length > 1)
            shot.visible = this.need(
              Object.fromEntries(this.bps.map((m) => [m, m === bp])),
              `${vchain}/embed-${bp}`,
              'BOOLEAN',
            );
          return shot;
        });
      if (shots.length === 1) {
        const { visible: _v, source: _s, name: _n, ...rest } = at(shots, 0, 'embed captures');
        return { ...out, ...rest, name: 'Embed' };
      }
      return {
        ...out,
        kind: 'frame',
        name: 'Embed',
        clip: true,
        layout: {
          mode: 'VERTICAL',
          gap: 0,
          primaryAlign: 'MIN',
          counterAlign: 'MIN',
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        },
        children: shots,
      };
    }
    const masked = st.maskedLeaf(node, !!this.childPaths(path).length);
    if (masked) return { ...out, kind: 'svg', name: 'Icon', svg: masked };
    if (node.svg) return { ...out, kind: 'svg', svg: node.svg };
    if (node.image?.src.startsWith('data:image/svg+xml')) {
      const comma = node.image.src.indexOf(','),
        head = node.image.src.slice(0, comma),
        data = node.image.src.slice(comma + 1);
      return {
        ...out,
        kind: 'svg',
        svg: head.includes(';base64') ? Buffer.from(data, 'base64').toString('utf8') : decodeURIComponent(data),
      };
    }
    if (node.image)
      return {
        ...out,
        kind: 'image',
        src: node.image.src,
        fit: node.computed['objectFit'] === 'contain' ? 'FIT' : 'FILL',
        ...st.styleOf(node),
      };
    let kidPaths = this.childPaths(path);
    const chars = node.inlineText || (!kidPaths.length ? node.text : null);
    if (chars && !kidPaths.length && st.iconGlyph(chars))
      return {
        ...out,
        kind: 'image',
        name: 'Icon',
        fit: 'FIT',
        src: `capture:${rb}:${[node.box.x, node.box.y, node.box.width, node.box.height].map((v) => fnum(st.r2(v))).join(',')}`,
      };
    const style = st.styleOf(node),
      shape = st.clipShape(node.computed['clipPath'], node.box.width, node.box.height);
    if (shape && !kidPaths.length && style.fill)
      return { ...out, kind: 'svg', name, svg: st.shapeSvg(shape, node.box.width, node.box.height, style.fill) };
    if (chars && (node.inlineText || !kidPaths.length)) {
      const icons = { before: st.pseudoImage(node, 'before'), after: st.pseudoImage(node, 'after') };
      if (icons.before || icons.after) return this.textWithIcons(out, path, chars, vchain, style, icons);
      const text = this.text(path, chars, vchain),
        pads = this.padding(path);
      if (!Object.keys(style).length && !Object.values(pads).some((p) => Object.values(p).some(Boolean)))
        return { ...out, kind: 'text', text };
      return {
        ...out,
        ...style,
        kind: 'frame',
        layout: {
          mode: 'VERTICAL',
          gap: 0,
          counterAlign: text.align === 'CENTER' ? 'CENTER' : text.align === 'RIGHT' ? 'MAX' : 'MIN',
          padding: this.paddingValue(pads, vchain),
        },
        children: [
          { name: 'Label', kind: 'text', text, source: path + '#label', sizing: text['singleLine'] ? 'FIXED' : 'FILL' },
        ],
      };
    }
    const positioned = this.positionedKids(kidPaths);
    kidPaths = this.visualOrder(
      path,
      kidPaths.filter((k) => !positioned.includes(k)),
    );
    const reordered = this.reorderedStack(path, kidPaths, vchain, style, out);
    if (reordered) {
      reordered.children = this.stackIn(reordered.children ?? [], this.placed(path, positioned, node, rb, vchain));
      return reordered;
    }
    const [layout, spacers] = this.layout(path, kidPaths, vchain);
    if (layout.mode === 'NONE')
      kidPaths.sort((a, b) => compare(st.stacking(this.refNode(a)), st.stacking(this.refNode(b))));
    const inner = Object.fromEntries(
      this.bps
        .filter((bp) => vis[bp])
        .map((bp) => [bp, this.box(bp, path).width - this.pads(bp, path).left - this.pads(bp, path).right]),
    );
    const children: TreeNode[] = [];
    kidPaths.forEach((kp, i) => {
      if (layout.slots) {
        const child = this.convert(kp, null, vchain);
        if (!child) return;
        const slot = this.slotFor(path, kp);
        const wrapper: TreeNode = {
          kind: 'frame',
          name: `Slot · ${child.name}`,
          sizing: 'FIXED',
          width: slot.width,
          ...(child.height !== undefined ? { height: child.height } : {}),
          source: kp + '#slot',
          layout: {
            mode: 'HORIZONTAL',
            gap: 0,
            primaryAlign: 'MIN',
            counterAlign: 'MIN',
            padding: { top: slot.padTop, right: 0, bottom: 0, left: slot.padLeft },
          },
          children: [child],
        };
        if ('visible' in child) {
          wrapper.visible = child.visible;
          delete child.visible;
        }
        children.push(wrapper);
        return;
      }
      const child = this.convert(kp, layout.mode !== 'NONE' ? inner : null, vchain);
      if (!child) return;
      if (layout.mode === 'NONE') {
        child.x = kp in this.table(rb) ? st.r2(this.box(rb, kp).x - node.box.x) : 0;
        child.y = kp in this.table(rb) ? st.r2(this.box(rb, kp).y - node.box.y) : 0;
      }
      children.push(child);
      const spacer = spacers && i < spacers.length ? spacers[i] : null;
      if (spacer !== null && spacer !== undefined)
        children.push({
          kind: 'frame',
          name: 'Spacer',
          sizing: 'FILL',
          width: 1,
          height: spacer,
          layout: { mode: 'NONE' },
          children: [],
          source: kp + '#spacer',
        });
    });
    return {
      ...out,
      kind: 'frame',
      ...style,
      layout,
      children: this.stackIn(children, this.placed(path, positioned, node, rb, vchain)),
    };
  }
  placed(path: string, positioned: string[], node: MeasuredNode, rb: string, chain: string): TreeNode[] {
    const out: TreeNode[] = [];
    for (const kp of positioned) {
      const child = this.convert(kp, null, chain);
      if (!child) continue;
      child.absolute = true;
      child.x = kp in this.table(rb) ? st.r2(this.box(rb, kp).x - node.box.x) : 0;
      child.y = kp in this.table(rb) ? st.r2(this.box(rb, kp).y - node.box.y) : 0;
      this.stacking.set(child, st.stacking(this.refNode(kp)));
      out.push(child);
    }
    for (const which of ['before', 'after'] as const) {
      const box = this.pseudoBox(path, which, chain);
      if (box) which === 'before' ? out.unshift(box) : out.push(box);
    }
    return out;
  }
  stackIn(children: TreeNode[], placed: TreeNode[]): TreeNode[] {
    const key = (child: TreeNode): Stacking => {
      const stacking = this.stacking.get(child);
      if (stacking) return stacking;
      const source = (child.source ?? '').split('#')[0]?.split('::')[0] ?? '',
        node = this.bps.map((bp) => this.maybeNode(bp, source)).find(Boolean);
      return node ? st.stacking(node) : [1, 0];
    };
    const out = [...children];
    for (const item of placed) {
      const k = key(item),
        ahead = item.source?.endsWith('::before'),
        position = out.findIndex((c) => (ahead ? compare(key(c), k) >= 0 : compare(key(c), k) > 0));
      out.splice(position < 0 ? out.length : position, 0, item);
    }
    for (const item of out) this.stacking.delete(item);
    return out;
  }
  reorderedStack(
    path: string,
    kidPaths: string[],
    chain: string,
    style: Partial<TreeNode>,
    out: TreeNode,
  ): TreeNode | null {
    if (kidPaths.length < 2) return null;
    const orders: Record<string, string[]> = {};
    let domIsStack = true;
    for (const bp of this.bps) {
      if (!this.visibleNode(bp, path)) continue;
      const vis = kidPaths.filter((k) => this.visibleIn(k)[bp]),
        visual = [...vis].sort(
          (a, b) => this.box(bp, a).y - this.box(bp, b).y || this.box(bp, a).x - this.box(bp, b).x,
        );
      const stacked = (seq: string[]): boolean =>
        seq
          .slice(1)
          .every(
            (b, i) =>
              this.box(bp, b).y >=
              this.box(bp, at(seq, i, 'stacked order')).y + this.box(bp, at(seq, i, 'stacked order')).height - TOL,
          );
      if (!stacked(visual)) return null;
      domIsStack &&= stacked(vis);
      orders[bp] = visual;
    }
    if (domIsStack || Object.keys(orders).length < 2) return null;
    const bps = Object.keys(orders),
      base = at(bps, 0, 'ordered breakpoints');
    let merged = pick(orders, base, 'visual order').map((path) => ({ path, bps: new Set([base]) }));
    for (const bp of bps.slice(1)) {
      const target = pick(orders, bp, 'visual order'),
        seq = merged.map((m) => m.path),
        table = Array.from({ length: seq.length + 1 }, () => new Array<number>(target.length + 1).fill(0));
      const cell = (i: number, j: number): number => at(at(table, i, 'order table'), j, 'order table row');
      for (let i = seq.length - 1; i >= 0; i--)
        for (let j = target.length - 1; j >= 0; j--)
          at(table, i, 'order table')[j] =
            seq[i] === target[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1));
      const result: typeof merged = [];
      let i = 0,
        j = 0;
      while (i < seq.length || j < target.length) {
        if (i < seq.length && j < target.length && seq[i] === target[j]) {
          const entry = at(merged, i, 'merged order');
          entry.bps.add(bp);
          result.push(entry);
          i++;
          j++;
        } else if (j < target.length && (i === seq.length || cell(i, j + 1) >= cell(i + 1, j))) {
          result.push({ path: at(target, j, 'visual order'), bps: new Set([bp]) });
          j++;
        } else {
          result.push(at(merged, i, 'merged order'));
          i++;
        }
      }
      merged = result;
    }
    const pads = this.padding(path),
      inner = Object.fromEntries(
        bps.map((bp) => [
          bp,
          this.box(bp, path).width - pick(pads, bp, 'padding').left - pick(pads, bp, 'padding').right,
        ]),
      ),
      children: TreeNode[] = [],
      seen: Record<string, number> = {};
    for (const m of merged) {
      const kp = m.path;
      seen[kp] = (seen[kp] ?? 0) + 1;
      const child = this.convert(kp, inner, chain);
      if (!child) continue;
      const name = `${this.nameFor(kp, chain)[1]}-${seen[kp]}`,
        tops: Record<string, number> = {};
      for (const bp of m.bps) {
        const order = pick(orders, bp, 'visual order'),
          position = order.indexOf(kp),
          before = position ? at(order, position - 1, 'visual order') : null,
          above =
            before !== null
              ? this.box(bp, before).y + this.box(bp, before).height
              : this.box(bp, path).y + pick(pads, bp, 'padding').top;
        tops[bp] = st.r2(Math.max(0, this.box(bp, kp).y - above));
      }
      const slot: TreeNode = {
        kind: 'frame',
        name: `Slot · ${child.name}`,
        sizing: 'FILL',
        width: this.need(per(inner, st.r2), `${chain}/inner-width`),
        ...(child.height !== undefined ? { height: child.height } : {}),
        source: `${kp}#order-${seen[kp]}`,
        layout: {
          mode: 'VERTICAL',
          gap: 0,
          primaryAlign: 'MIN',
          counterAlign: 'MIN',
          padding: { top: this.need(tops, `${name}/order-top`), right: 0, bottom: 0, left: 0 },
        },
        children: [child],
      };
      delete child.visible;
      if (m.bps.size !== bps.length)
        slot.visible = this.need(
          Object.fromEntries(this.bps.map((bp) => [bp, m.bps.has(bp)])),
          `${name}/order-visible`,
          'BOOLEAN',
        );
      children.push(slot);
    }
    return {
      ...out,
      ...style,
      kind: 'frame',
      layout: {
        mode: 'VERTICAL',
        gap: 0,
        primaryAlign: 'MIN',
        counterAlign: 'MIN',
        padding: this.paddingValue(pads, chain),
      },
      children,
    };
  }
  textWithIcons(
    out: TreeNode,
    path: string,
    chars: string,
    chain: string,
    style: Partial<TreeNode>,
    icons: Record<'before' | 'after', PseudoImage | null>,
  ): TreeNode {
    const text = this.text(path, chars, chain),
      children: TreeNode[] = [];
    let gap = 0;
    for (const which of ['before', 'after'] as const) {
      if (which === 'after')
        children.push({
          name: 'Label',
          kind: 'text',
          text,
          source: path + '#label',
          sizing: text['singleLine'] ? 'FIXED' : 'FILL',
        });
      const icon = icons[which];
      if (!icon) continue;
      children.push({
        name: 'Icon',
        source: `${path}::${which}`,
        sizing: 'FIXED',
        width: icon.width,
        height: icon.height,
        x: 0,
        y: 0,
        ...(icon.svg ? { kind: 'svg', svg: icon.svg } : { kind: 'image', src: iconSrc(icon, path, which), fit: 'FIT' }),
      });
      gap = Math.max(gap, icon.gap);
    }
    return {
      ...out,
      ...style,
      kind: 'frame',
      layout: {
        mode: 'HORIZONTAL',
        gap,
        primaryAlign: text.align === 'CENTER' ? 'CENTER' : text.align === 'RIGHT' ? 'MAX' : 'MIN',
        counterAlign: 'CENTER',
        padding: this.paddingValue(this.padding(path), chain),
      },
      children,
    };
  }
  pads(bp: string, path: string): Padding {
    return st.padding(this.nodeAt(bp, path));
  }
  padding(path: string): Record<string, Padding> {
    return Object.fromEntries(
      this.bps.filter((bp) => this.visibleNode(bp, path)).map((bp) => [bp, this.pads(bp, path)]),
    );
  }
  paddingValue(
    pads: Record<string, Padding>,
    chain: string,
    extraTop: Record<string, number> = {},
  ): NonNullable<Layout['padding']> {
    return Object.fromEntries(
      st.SIDES.map((side) => [
        side,
        this.value(
          per(pads, (p, bp) => st.r2(p[side] + (side === 'top' ? (extraTop[bp] ?? 0) : 0))),
          `${chain}/padding-${side}`,
        ),
      ]),
    );
  }
  text(path: string, chars: string, chain: string): Text {
    const by = Object.fromEntries(
        this.bps.filter((bp) => this.visibleNode(bp, path)).map((bp) => [bp, st.textOf(this.nodeAt(bp, path), chars)]),
      ),
      base = { ...(by['desktop'] ?? first(by)) };
    const measured = (prop: 'size' | 'lineHeight' | 'letterSpacing') => per(by, (t) => t[prop] as number | null);
    base.size = this.need(measured('size'), `${chain}/size`);
    base.lineHeight = this.value(measured('lineHeight'), `${chain}/lineheight`);
    base.letterSpacing = this.need(measured('letterSpacing'), `${chain}/letterspacing`);
    base['singleLine'] = Object.values(by).every((t) => t['singleLine']);
    if (new Set(Object.values(by).map((t) => t.align)).size > 1)
      this.notes.push(`${chain}: text alignment differs by width; desktop alignment kept`);
    return base;
  }
  layout(path: string, kidPaths: string[], chain: string): [Layout, (Value | null)[] | null] {
    const shown = this.bps.filter((bp) => this.visibleNode(bp, path)),
      stacked = !!shown.length && shown.every((bp) => st.gridTracks(this.nodeAt(bp, path)) === 1);
    const by = Object.fromEntries(
        shown.map((bp) => [bp, st.inferLayout(this.nodeAt(bp, path), this.kids(bp, path), stacked)]),
      ),
      pads = this.padding(path);
    if (!kidPaths.length) return [{ mode: 'NONE', padding: this.paddingValue(pads, chain) }, null];
    if (
      kidPaths.some((k) =>
        shown.some((bp) => {
          const kid = this.maybeNode(bp, k);
          return kid && st.translated(kid);
        }),
      )
    )
      return [{ mode: 'NONE', padding: this.paddingValue(pads, chain) }, null];
    const modes = per(by, (l) => l.mode);
    if (Object.values(modes).includes('NONE')) return this.slotFlow(path, kidPaths, chain, pads);
    const padding = this.paddingValue(
        pads,
        chain,
        per(by, (l, bp) => l.padding.top - pick(pads, bp, 'padding').top),
      ),
      dirs = new Set(Object.values(modes)),
      wraps = Object.values(by).some((l) => l.wrap),
      ref = by['desktop'] ?? first(by);
    if (dirs.size === 1 && dirs.has('VERTICAL') && !Object.values(by).some((l) => l.spacers))
      return [
        {
          mode: 'VERTICAL',
          gap: this.need(
            per(by, (l) => l.gap ?? 0),
            `${chain}/gap`,
          ),
          counterAlign: ref.counterAlign ?? 'MIN',
          primaryAlign: 'MIN',
          padding,
        },
        null,
      ];
    if (dirs.size === 1 && dirs.has('VERTICAL') && kidPaths.every((k) => shown.every((bp) => this.visibleIn(k)[bp]))) {
      const n = kidPaths.length,
        gapsPer: Record<string, number[]> = {};
      for (const bp of shown) {
        if (kidPaths.filter((k) => this.visibleIn(k)[bp]).length !== n) {
          this.fallbacks.push(chain);
          return [{ mode: 'NONE', fellBack: true, padding: this.paddingValue(pads, chain) }, null];
        }
        const boxes = kidPaths.map((k) => this.box(bp, k));
        gapsPer[bp] = boxes.slice(1).map((b, i) => {
          const above = at(boxes, i, 'sibling boxes');
          return st.r2(Math.max(0, b.y - (above.y + above.height)));
        });
      }
      const spacers = Array.from({ length: n - 1 }, (_, i) =>
        this.value(
          per(gapsPer, (g) => at(g, i, 'spacer gaps')),
          `${chain}/spacer-${i + 1}`,
        ),
      );
      return [
        { mode: 'VERTICAL', gap: 0, counterAlign: ref.counterAlign ?? 'MIN', primaryAlign: 'MIN', padding },
        spacers,
      ];
    }
    if (dirs.size === 1 && dirs.has('HORIZONTAL') && !wraps) {
      if (new Set(Object.values(by).map((l) => l.primaryAlign ?? 'MIN')).size > 1)
        this.notes.push(`${chain}: horizontal alignment differs by width; desktop alignment kept`);
      return [
        {
          mode: 'HORIZONTAL',
          gap: this.need(
            per(by, (l) => l.gap ?? 0),
            `${chain}/gap`,
          ),
          primaryAlign: ref.primaryAlign ?? 'MIN',
          counterAlign: ref.counterAlign ?? 'MIN',
          padding,
        },
        null,
      ];
    }
    if (dirs.size > 1 || Object.values(by).some((l) => l.mode === 'VERTICAL' && (l.primaryAlign ?? 'MIN') !== 'MIN'))
      return this.slotFlow(path, kidPaths, chain, pads);
    const colGap = per(by, (l) => Math.max(0, (l.mode === 'HORIZONTAL' ? (l.gap ?? 0) : 0) - 1)),
      rowGap = per(by, (l) => (l.mode === 'HORIZONTAL' ? (l.counterGap ?? 0) : (l.gap ?? 0))),
      primary = [
        ...new Set(
          Object.values(by)
            .filter((l) => l.mode === 'HORIZONTAL')
            .map((l) => l.primaryAlign ?? 'MIN'),
        ),
      ].sort();
    return [
      {
        mode: 'HORIZONTAL',
        wrap: true,
        gap: this.need(colGap, `${chain}/column-gap`),
        counterGap: this.need(rowGap, `${chain}/row-gap`),
        primaryAlign: primary[0] ?? 'MIN',
        counterAlign: 'MIN',
        padding,
      },
      null,
    ];
  }
  slotFlow(path: string, kidPaths: string[], chain: string, pads: Record<string, Padding>): [Layout, null] {
    const by: Record<string, Record<string, { width: number; padLeft: number; padTop: number }>> = {};
    for (const bp of this.bps) {
      if (!this.visibleNode(bp, path)) continue;
      const box = this.box(bp, path),
        p = pick(pads, bp, 'padding'),
        left = st.r2(box.x + p.left),
        top = st.r2(box.y + p.top),
        right = st.r2(box.x + box.width - p.right);
      const vis = kidPaths.filter((k) => this.visibleIn(k)[bp]),
        rel: Rect[] = vis.map((k) => {
          const b = this.box(bp, k);
          return [st.r2(b.x), st.r2(b.y), st.r2(b.width), st.r2(b.height)];
        }),
        rows = readingRows(rel);
      if (!rows) {
        if (vis.some((k) => st.positionedOut(this.nodeAt(bp, k))))
          return [{ mode: 'NONE', padding: this.paddingValue(pads, chain) }, null];
        this.fallbacks.push(chain);
        return [{ mode: 'NONE', fellBack: true, padding: this.paddingValue(pads, chain) }, null];
      }
      const slots: Record<string, { width: number; padLeft: number; padTop: number }> = {};
      let above = top;
      for (const row of rows) {
        let cursor = left;
        row.forEach((i, pos) => {
          const [x, y, w] = at(rel, i, 'relative boxes'),
            width = pos === row.length - 1 ? Math.max(right - cursor, x + w - cursor) : x + w - cursor;
          slots[at(vis, i, 'visible kids')] = {
            width: st.r2(width),
            padLeft: st.r2(Math.max(0, x - cursor)),
            padTop: st.r2(Math.max(0, y - above)),
          };
          cursor = x + w;
        });
        above = Math.max(
          ...row.map((i) => {
            const [, y, , h] = at(rel, i, 'relative boxes');
            return y + h;
          }),
        );
      }
      by[bp] = slots;
    }
    const slotted: Record<string, Slot> = {};
    this.slotted[path] = slotted;
    for (const k of kidPaths) {
      const name = this.nameFor(k, chain)[1],
        vals = per(Object.fromEntries(Object.entries(by).filter(([, s]) => k in s)), (s) => pick(s, k, 'slot'));
      slotted[k] = {
        width: this.need(
          per(vals, (v) => v.width),
          `${name}/slot-width`,
        ),
        padLeft: this.need(
          per(vals, (v) => v.padLeft),
          `${name}/slot-left`,
        ),
        padTop: this.need(
          per(vals, (v) => v.padTop),
          `${name}/slot-top`,
        ),
      };
    }
    return [
      {
        mode: 'HORIZONTAL',
        wrap: true,
        gap: 0,
        counterGap: 0,
        slots: true,
        primaryAlign: 'MIN',
        counterAlign: 'MIN',
        padding: this.paddingValue(pads, chain),
      },
      null,
    ];
  }
}
export function readingRows(boxes: Rect[]): number[][] | null {
  const rows: number[][] = [];
  for (let i = 0; i < boxes.length; i++) {
    const [x, y] = at(boxes, i, 'row boxes');
    const row = rows.at(-1);
    if (row) {
      const [px, py, pw, ph] = at(boxes, lastOf(row, 'reading row'), 'row boxes');
      if (x >= px + pw - TOL && y < py + ph - TOL) {
        row.push(i);
        continue;
      }
      if (
        y <
          Math.max(
            ...row.map((j) => {
              const [, top, , height] = at(boxes, j, 'row boxes');
              return top + height;
            }),
          ) -
            TOL &&
        x < px
      )
        return null;
    }
    rows.push([i]);
  }
  return rows;
}
export function build(spec: Spec, label: string, key?: string | null): Tree {
  const m = new Merge(spec, label, key || slug(spec.machineName || spec.component || label)),
    tree = m.convert(m.rootPath, null, '');
  if (!tree) throw new Error('root is not visible');
  tree.sizing = 'FIXED';
  if (spec.machineName === null) throw new GeometryError(`spec for "${spec.component}" has no machineName`);
  return {
    component: spec.component,
    machineName: spec.machineName,
    label,
    modes: MODES.map((bp) => pick(MODE_NAMES, bp, 'mode name')),
    measured: m.bps,
    widths: Object.fromEntries(
      m.bps.map((bp) => [pick(MODE_NAMES, bp, 'mode name'), pick(m.widths, bp, 'root width')]),
    ),
    variables: sorted(m.variables) as Tree['variables'],
    fallbacks: [...new Set(m.fallbacks)].sort(),
    notes: m.notes,
    tree,
  };
}
if (isEntrypoint(import.meta.url)) {
  const args = process.argv.slice(2),
    get = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
  const specPath = args[0];
  if (specPath === undefined) throw new Error('usage: responsive.ts SPEC.json [--label NAME] [--key KEY] [--out FILE]');
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as Spec,
    label = get('--label') ?? spec.component;
  const tree = build(spec, label, args.includes('--key') ? get('--key') : undefined),
    out = get('--out');
  if (out !== undefined) writeArtifact('tree', out, tree);
  else console.log(JSON.stringify(tree, null, 1));
}
