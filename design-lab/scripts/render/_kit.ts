import type { KitArgs, Role, RoleName, TextOptions, StackOptions, Child, Column, TableCell } from "../../src/figma/types.ts";
import { DL_API } from "../../src/figma/types.ts";
export async function template(ARGS: KitArgs) {
// DESIGN_LAB_TEMPLATE_BEGIN
/**
 * design-lab documentation kit. Prepended to every render template at install time.
 *
 * The documentation chrome is neutral and fixed: one type ramp, one grey scale, one link
 * colour, 8-pixel spacing. It belongs to design-lab, not to the site, so the site's own
 * colours and fonts appear only inside the components and the foundation specimens, where
 * they are the subject. Every value lives here and nowhere else — a template that wants a
 * new size adds a role, it does not pass a number.
 */
const KIT = {
  font: 'Inter',
  mono: 'Roboto Mono',
  /* The Cover alone is set in IBM Plex Sans; cover.ts loads it and falls back to `font`. Kit
     style names map to Plex's own. */
  coverFont: { family: 'IBM Plex Sans', styles: { 'Semi Bold': 'SemiBold', 'Medium': 'Medium', 'Regular': 'Regular' } },
  coverInk: '#E6E8FF',
  ink: { strong: '#18181b', body: '#3f3f46', muted: '#71717a', faint: '#a1a1aa', inverse: '#ffffff' },
  surface: { page: '#f4f4f5', panel: '#ffffff', sunken: '#fafafa', rule: '#e4e4e7', chip: '#f4f4f5', dark: '#18181b', defect: '#fef2f2' },
  link: '#1d4ed8',
  radius: { panel: 12, chip: 999, swatch: 8 },
  space: { xs: 4, s: 8, m: 16, l: 24, xl: 32, xxl: 48, panel: 40, page: 80, block: 160 },
  width: { page: 1440, doc: 560 },
};

/* Text roles. [font, style, size, lineHeight, colour, letterSpacing, case] */
const ROLES: Record<RoleName,Role> = {
  display:   [KIT.font, 'Semi Bold', 72, 80, KIT.ink.inverse, -1.5, 'ORIGINAL'],
  lede:      [KIT.font, 'Regular', 20, 30, '#d4d4d8', 0, 'ORIGINAL'],
  eyebrowDk: [KIT.mono, 'Medium', 13, 16, KIT.ink.faint, 1.2, 'UPPER'],
  statNote:  [KIT.font, 'Regular', 12, 16, KIT.ink.faint, 0, 'ORIGINAL'],
  provDark:  [KIT.mono, 'Regular', 12, 18, KIT.ink.muted, 0, 'ORIGINAL'],
  coverTitle:[KIT.font, 'Semi Bold', 128, 128, KIT.ink.inverse, -4, 'ORIGINAL'],
  coverSub:  [KIT.font, 'Regular', 28, 36, KIT.coverInk, -0.2, 'ORIGINAL'],
  coverTotal:[KIT.font, 'Semi Bold', 176, 176, KIT.ink.inverse, -6, 'ORIGINAL'],
  coverUnit: [KIT.font, 'Medium', 48, 56, KIT.ink.inverse, -0.5, 'ORIGINAL'],
  coverTileValue: [KIT.font, 'Semi Bold', 44, 48, KIT.ink.inverse, -0.8, 'ORIGINAL'],
  coverTileLabel: [KIT.font, 'Medium', 16, 24, KIT.coverInk, 0.64, 'ORIGINAL'],
  title:     [KIT.font, 'Semi Bold', 40, 48, KIT.ink.strong, -0.6, 'ORIGINAL'],
  heading:   [KIT.font, 'Semi Bold', 24, 32, KIT.ink.strong, -0.2, 'ORIGINAL'],
  eyebrow:   [KIT.mono, 'Medium', 12, 16, KIT.ink.muted, 1.0, 'UPPER'],
  body:      [KIT.font, 'Regular', 14, 22, KIT.ink.body, 0, 'ORIGINAL'],
  bodyStrong:[KIT.font, 'Semi Bold', 14, 22, KIT.ink.strong, 0, 'ORIGINAL'],
  small:     [KIT.font, 'Regular', 12, 16, KIT.ink.muted, 0, 'ORIGINAL'],
  code:      [KIT.mono, 'Regular', 12, 16, KIT.ink.body, 0, 'ORIGINAL'],
  cell:      [KIT.font, 'Regular', 13, 20, KIT.ink.body, 0, 'ORIGINAL'],
  cellHead:  [KIT.mono, 'Medium', 11, 16, KIT.ink.muted, 0.8, 'UPPER'],
  cellCode:  [KIT.mono, 'Regular', 12, 20, KIT.ink.body, 0, 'ORIGINAL'],
  chip:      [KIT.font, 'Medium', 12, 16, KIT.ink.body, 0, 'ORIGINAL'],
  column:    [KIT.mono, 'Medium', 12, 16, KIT.ink.muted, 0.6, 'ORIGINAL'],
  bandLine:  [KIT.font, 'Regular', 32, 40, KIT.ink.inverse, -0.4, 'ORIGINAL'],
  bandNote:  [KIT.font, 'Regular', 14, 22, '#d4d4d8', 0, 'ORIGINAL'],
  stat:      [KIT.font, 'Semi Bold', 32, 40, KIT.ink.strong, -0.4, 'ORIGINAL'],
  observed:  [KIT.mono, 'Medium', 11, 16, '#15803d', 0.8, 'UPPER'],
  watch:     [KIT.mono, 'Medium', 11, 16, '#b91c1c', 0.8, 'UPPER'],
  defect:    [KIT.font, 'Regular', 13, 20, '#991b1b', 0, 'ORIGINAL'],
  quote:     [KIT.font, 'Regular', 13, 20, KIT.ink.muted, 0, 'ORIGINAL'],
};

const rgb = (hex: string) => ({
  r: parseInt(hex.slice(1, 3), 16) / 255,
  g: parseInt(hex.slice(3, 5), 16) / 255,
  b: parseInt(hex.slice(5, 7), 16) / 255,
});
const solid = (hex: string, opacity = 1): SolidPaint[] => [{ type: 'SOLID', color: rgb(hex), opacity }];

async function loadKitFonts() {
  const need = new Set(Object.values(ROLES).map(([f, s]) => `${f}|${s}`));
  await Promise.all([...need].map((k) => {
    const [family, style] = k.split('|') as [string,string];
    return DL_API.loadFont({ family, style });
  }));
}

/** A text node in a fixed role. width: fixed width with wrapping; omit to hug. */
function text(characters: unknown, role: RoleName, { name, width, link, align }: TextOptions = {}) {
  const [family, style, size, lh, colour, tracking, textCase] = ROLES[role]!;
  const t = figma.createText();
  t.fontName = { family, style };
  t.characters = String(characters);
  t.fontSize = size;
  t.lineHeight = { unit: 'PIXELS', value: lh };
  t.letterSpacing = { unit: 'PIXELS', value: tracking };
  t.textCase = textCase;
  t.fills = solid(link ? KIT.link : colour);
  if (align) t.textAlignHorizontal = align;
  if (link) {
    t.hyperlink = link;
    t.textDecoration = 'UNDERLINE';
  }
  t.name = name || String(characters).slice(0, 40);
  if (width) {
    t.textAutoResize = 'HEIGHT';
    t.resize(width, t.height);
  } else {
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
  }
  return t;
}

/** An auto layout frame. Hugs content unless width/height given. */
function stack(direction: 'VERTICAL'|'HORIZONTAL', { name, gap = 0, pad = 0, fill, radius, stroke, width, height, align = 'MIN', justify = 'MIN', wrap = false, rowGap }: StackOptions = {}) {
  const f = figma.createFrame();
  f.name = name || (direction === 'VERTICAL' ? 'Stack' : 'Row');
  f.layoutMode = direction;
  f.itemSpacing = gap;
  const p = typeof pad === 'number' ? { t: pad, r: pad, b: pad, l: pad } : pad;
  f.paddingTop = p.t; f.paddingRight = p.r; f.paddingBottom = p.b; f.paddingLeft = p.l;
  f.counterAxisAlignItems = align;
  f.primaryAxisAlignItems = justify;
  if (wrap) { f.layoutWrap = 'WRAP'; f.counterAxisSpacing = rowGap ?? gap; }
  f.fills = fill ? solid(fill) : [];
  if (radius) f.cornerRadius = radius;
  if (stroke) { f.strokes = solid(stroke); f.strokeWeight = 1; f.strokeAlign = 'INSIDE'; }
  f.clipsContent = false;
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  if (width || height) {
    f.resize(width || 100, height || 100);
    /* resize() sets both axes to FIXED; put back hugging on whichever axis has no size. */
    const vertical = direction === 'VERTICAL';
    f.primaryAxisSizingMode = (vertical ? height : width) ? 'FIXED' : 'AUTO';
    f.counterAxisSizingMode = (vertical ? width : height) ? 'FIXED' : 'AUTO';
  }
  return f;
}

/* Nodes that should fill their parent's width. Figma only accepts FILL once a node sits in
   an auto layout parent, so fillWidth marks the node and add() applies it after appending. */
const FILL = new Set<SceneNode>();

/** Append children in order, applying any pending fill-width once each is parented. */
function add<T extends BaseNode & ChildrenMixin>(parent: T, ...children: Child[]) {
  for (const c of (children as unknown as (SceneNode|null|undefined|false)[][]).flat(Infinity) as (SceneNode|null|undefined|false)[]) {
    if (!c) continue;
    parent.appendChild(c);
    if (FILL.has(c) && (parent as T & Partial<AutoLayoutMixin>).layoutMode && (parent as T & Partial<AutoLayoutMixin>).layoutMode !== 'NONE') (c as SceneNode & Pick<FrameNode,'layoutSizingHorizontal'>).layoutSizingHorizontal = 'FILL';
  }
  return parent;
}

function fillWidth<T extends SceneNode>(node: T) {
  FILL.add(node);
  return node;
}

function chip(label: string) {
  return add(stack('HORIZONTAL', { name: `Chip · ${label}`, pad: { t: 4, r: 10, b: 4, l: 10 }, fill: KIT.surface.chip, radius: KIT.radius.chip }),
    text(label, 'chip', { name: 'Label' }));
}

function rule(width: number) {
  const r = figma.createRectangle();
  r.name = 'Rule';
  r.resize(width, 1);
  r.fills = solid(KIT.surface.rule);
  return r;
}

/**
 * A table. columns: [{ title, width, role? }]; rows: [[cell, ...]] where a cell is a string
 * or { text, role, link }. Row height hugs; rules between rows.
 */
function table(columns: Column[], rows: TableCell[][], { name = 'Table', width }: {name?:string;width?:number} = {}) {
  const total = width || columns.reduce((s, c) => s + c.width, 0);
  const t = stack('VERTICAL', { name, width: total });
  const row = (cells: TableCell[], head: boolean, i: number) => {
    const r = stack('HORIZONTAL', { name: head ? 'Header' : `Row ${i + 1}`, pad: { t: 10, r: 0, b: 10, l: 0 }, gap: 0, fill: head ? KIT.surface.sunken : undefined });
    cells.forEach((cell, j) => {
      const c = typeof cell === 'object' && cell !== null ? cell : { text: cell };
      const role = head ? 'cellHead' : (c.role || columns[j]!.role || 'cell');
      const box = stack('HORIZONTAL', { name: columns[j]!.title, width: columns[j]!.width, pad: { t: 0, r: 12, b: 0, l: 12 } });
      add(box, fillWidth(text(c.text === undefined || c.text === null || c.text === '' ? '—' : c.text, role, { name: columns[j]!.title, width: columns[j]!.width - 24, link: c.link })));
      r.appendChild(box);
    });
    return r;
  };
  t.appendChild(row(columns.map((c) => c.title), true, -1));
  rows.forEach((cells, i) => {
    t.appendChild(rule(total));
    t.appendChild(row(cells, false, i));
  });
  return t;
}

/** A labelled section inside a panel: eyebrow, then content. */
function section(title: string, width: number, ...content: Child[]) {
  const s = stack('VERTICAL', { name: title, gap: KIT.space.m, width });
  add(s, text(title, 'eyebrow', { name: 'Section title' }));
  add(s, content);
  return s;
}

function tag<T extends BaseNode>(node: T, key: string, value: unknown) {
  node.setSharedPluginData('designlab', key, String(value));
  return node;
}

async function onPage(pageId: string) {
  const page = await figma.getNodeByIdAsync(pageId);
  if (!page || page.type !== 'PAGE') throw new Error(`not a page: ${pageId}`);
  await figma.setCurrentPageAsync(page);
  page.backgrounds = solid(KIT.surface.page);
  return page;
}

/** Remove what a previous run of the same template left, found by its design-lab key. */
function clearTagged(root: ChildrenMixin, key: string, value: unknown) {
  const found = root.findAll((n) => n.getSharedPluginData('designlab', key) === String(value));
  for (const n of found) if (!n.removed) n.remove();
  return found.length;
}

/**
 * Run a template body so that a failure leaves the page as it was: every page-level node
 * created during the call is removed before the error propagates. Nodes listed in `keep`
 * (for example a component set being moved) survive either way.
 */
async function atomic<T>(page: PageNode, keep: string[], body: () => Promise<T>) {
  const before = new Set(page.children.map((n) => n.id));
  try {
    return await body();
  } catch (e) {
    /* A kept node may have been moved inside something this call created: move it back to
       the page first, so the cleanup cannot delete it with its new parent. */
    for (const id of keep) {
      const n = await figma.getNodeByIdAsync(id);
      if (n && !n.removed && n.parent !== page) page.appendChild(n as SceneNode);
    }
    for (const n of [...page.children]) {
      if (!before.has(n.id) && !keep.includes(n.id) && !n.removed) n.remove();
    }
    throw e;
  }
}

// DESIGN_LAB_TEMPLATE_END
}
