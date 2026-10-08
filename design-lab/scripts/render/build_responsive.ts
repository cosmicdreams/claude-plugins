import { assertNever } from '../../src/assert-never.ts';
import type { BuildResponsiveArgs, RenderTree, ExpandedRenderTree, TreeText, Layout, Color, RenderReport, BindingValue, BindingNode, StyledNode, SizedNode } from "../../src/figma/types.ts";
import { DL_API, KIT, ROLES, rgb, solid, loadKitFonts, text, stack, add, fillWidth, chip, rule, table, section, tag, onPage, clearTagged, atomic } from "../../src/figma/types.ts";
export async function template(ARGS: BuildResponsiveArgs) {
// DESIGN_LAB_TEMPLATE_BEGIN
/**
 * Build ONE responsive master for one component from a responsive.ts tree.
 *
 * ARGS = { pageId, x, y, id, name, description, collection, modeNames: { Desktop, Tablet, Mobile },
 *          variables: { <name>: { type, values: { Desktop, Tablet, Mobile } } }, tree }
 * A value in the tree is either a plain number/boolean or { var: <name> }; a variable
 * reference is bound, so resizing an instance and switching the Breakpoint mode reproduces
 * the component at that width. Desktop is the collection's default mode, so the master
 * itself shows the desktop rendering. Colours still bind by code syntax, as in
 * the earlier per-breakpoint builder.
 */
/* Expand the compact payload form (spec_to_tree.compact): shared text styles and padding
   arrays back into the full tree. */
function expand(node: RenderTree, styles = ARGS.styles): asserts node is ExpandedRenderTree {
  // Mutation uses an optional view; the input union still requires text or ts/chars.
  const wire: {text?:TreeText;ts?:number;chars?:string} = node;
  switch (node.kind) {
    case 'text': case 'frame': case 'image': case 'svg': case 'instance':
      if (wire.ts !== undefined) { wire.text = { ...styles![wire.ts]!, characters: wire.chars! }; delete wire.ts; delete wire.chars; }
      break;
    default: assertNever(node);
  }
  if (node.layout) {
    const [t, r, b, l] = node.layout.pad || [0, 0, 0, 0];
    node.layout.padding = { top: t, right: r, bottom: b, left: l };
    delete node.layout.pad;
  }
  (node.children || []).forEach((child) => expand(child, styles));
}
if (ARGS.styles) expand(ARGS.tree);
/* Other layouts the site renders this component in (a card with fewer fields inside another
   block), each compacted with its own text styles. */
for (const alt of ARGS.alternates || []) expand(alt.tree, alt.styles);

const page = await figma.getNodeByIdAsync(ARGS.pageId) as PageNode;
await figma.setCurrentPageAsync(page);

/* ---- Breakpoint collection and this component's variables (idempotent by name). */
const collections = await DL_API.collections();
let col = collections.find((c) => c.name === ARGS.collection);
const order: ('Desktop'|'Tablet'|'Mobile')[] = ['Desktop', 'Tablet', 'Mobile'];
if (!col) {
  col = DL_API.createCollection(ARGS.collection);
  /* Marked as design-lab's, so a rebuild's wipe removes it and nothing it did not create. */
  col.setSharedPluginData('designlab', 'collection', ARGS.collection);
  col.renameMode(col.modes[0]!.modeId, ARGS.modeNames.Desktop);
  col.addMode(ARGS.modeNames.Tablet);
  col.addMode(ARGS.modeNames.Mobile);
}
// A Core collection created from invariant tokens can acquire width modes on first use.
if (col.modes.length === 1 && col.modes[0]!.name !== ARGS.modeNames.Desktop) {
  const original = col.modes[0]!.modeId;
  col.renameMode(original, ARGS.modeNames.Desktop);
  const added = [col.addMode(ARGS.modeNames.Tablet), col.addMode(ARGS.modeNames.Mobile)];
  for (const variable of await DL_API.variables()) {
    if (variable.variableCollectionId === col.id)
      for (const id of added) variable.setValueForMode(id, variable.valuesByMode[original]!);
  }
}
const modeId: Record<string,string> = {};
for (const role of order) {
  const m = col.modes.find((x) => x.name === ARGS.modeNames[role]);
  if (!m) throw new Error(`Breakpoint collection has no mode ${ARGS.modeNames[role]}`);
  modeId[role]! = m.modeId;
}
const existing = (await DL_API.variables()).filter((v) => v.variableCollectionId === col.id);
const byName = Object.fromEntries(existing.map((v) => [v.name, v]));
const SCOPE = [
  [/\/(width|height)$/, ['WIDTH_HEIGHT']], [/\/(gap|column-gap|row-gap|spacer-\d+)$/, ['GAP']],
  [/\/padding-/, ['GAP']], [/\/size$/, ['FONT_SIZE']], [/\/lineheight$/, ['LINE_HEIGHT']],
  [/\/letterspacing$/, ['LETTER_SPACING']],
] satisfies [RegExp,VariableScope[]][];
const vars: Record<string,Variable> = {};
for (const [name, spec] of Object.entries(ARGS.variables)) {
  let v = byName[name]!;
  if (!v) v = DL_API.createVariable(name, col, spec.type);
  /* Measured per breakpoint from the live site; the code computes these, it does not declare them. */
  v.description = 'Measured from the live site at each breakpoint; no CSS custom property '
    + 'declares this value, so there is no code name.';
  for (const role of order) v.setValueForMode(modeId[role]!, spec.values[role]!);
  if (spec.type !== 'BOOLEAN') {
    const hit = SCOPE.find(([re]) => re.test(name));
    v.scopes = hit ? hit[1] : [];
  }
  vars[name]! = v;
}
const isVar = (v: BindingValue): v is {var:string} => (v && typeof v === 'object' && v.var) as unknown as boolean;
const num = (v: BindingValue): number => (isVar(v) ? ARGS.variables[v.var]!.values.Desktop : v) as number;
const bind = (node: BindingNode, field: VariableBindableNodeField|VariableBindableTextField|VariableBindableTextField, v: BindingValue) => {
  if (v === undefined || v === null) return;
  if (isVar(v)) { node.setBoundVariable(field, vars[v.var]!); report.bound++; return; }
  /* width and height are read-only properties: a plain size goes through resize(). */
  if (field === 'width') node.resize(Math.max(1, v as number), node.height);
  else if (field === 'height') node.resize(node.width, Math.max(1, v as number));
  else (node as unknown as Record<VariableBindableNodeField|VariableBindableTextField,number|boolean>)[field] = v;
};

/* ---- Fonts: the run's font plan (fonts.json, made at connect) first, then name matching against
   what this Figma can draw with. A family Figma lacks is drawn in the plan's stand-in, never silently. */
const FONTS = ARGS.fonts || null;
const fams: Record<string,Set<string>> = {};
for (const f of await DL_API.fonts()) (fams[f.fontName.family]! ||= new Set()).add(f.fontName.style);
/* CSS names a font by its web-font id (`articulat-cf`); Figma by its family (`Articulat CF`). */
const famKey = (name: unknown) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const famByKey: Record<string,string> = {};
for (const name of Object.keys(fams)) famByKey[famKey(name)]! ||= name;
/* A family as Figma has it: exactly, ignoring case and punctuation, or with a trial or web suffix. */
function findFamily(name: string|null|undefined) {
  if (!name) return null;
  if (fams[name]!) return name;
  const key = famKey(name);
  if (famByKey[key]!) return famByKey[key]!;
  for (const suffix of ['trial', 'web', 'pro', 'std', 'text']) {
    if (famByKey[key + suffix]!) return famByKey[key + suffix]!;
    if (key.endsWith(suffix) && famByKey[key.slice(0, -suffix.length)]!) return famByKey[key.slice(0, -suffix.length)]!;
  }
  return null;
}
/* Style names compared generously: Semibold, Semi Bold and SemiBold are one face; so are Book and
   Regular, Demi and SemiBold, Oblique and Italic. The style's own spelling is tried first, so a
   family with both Heavy and Black keeps them apart. */
const SYNONYMS: [string,string][] = [['ultralight', 'extralight'], ['ultrabold', 'extrabold'], ['demibold', 'semibold'], ['demi', 'semibold'],
  ['book', 'regular'], ['normal', 'regular'], ['roman', 'regular'], ['oblique', 'italic']];
const strict = (style: string|null|undefined) => String(style || '').toLowerCase().replace(/[^a-z]/g, '');
function canon(style: string) {
  let k = strict(style);
  for (const [from, to] of SYNONYMS) if (k.includes(from) && !k.includes(to)) k = k.replace(from, to);
  return k === 'regularitalic' ? 'italic' : k;
}
const WEIGHT_NAMES: Record<number,string[]> = { 100: ['thin'], 200: ['extralight'], 300: ['light'], 400: ['regular'], 500: ['medium'], 600: ['semibold'],
  700: ['bold'], 800: ['extrabold'], 900: ['black', 'heavy'] };
const styleFor = (base: string, italic?: boolean) => (italic ? (base === 'regular' ? 'italic' : `${base}italic`) : base);
function pickStyle(fam: string, wanted: string|null, weight: number, italic?: boolean) {
  const styles = [...fams[fam]!];
  const byStrict: Record<string,string> = {};
  const byCanon: Record<string,string> = {};
  for (const s of styles) { byStrict[strict(s)]! ||= s; byCanon[canon(s)]! ||= s; }
  if (wanted && (byStrict[wanted]! || byCanon[wanted]!)) return { style: byStrict[wanted]! || byCanon[wanted]!, exact: true };
  const ws = Object.keys(WEIGHT_NAMES).map(Number).sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight) || a - b);
  for (const w of ws) for (const base of WEIGHT_NAMES[w]!) {
    const s = byCanon[styleFor(base, italic)]!;
    if (s) return { style: s, exact: !wanted && w === weight };
  }
  return { style: styles[0]!!, exact: false };
}
const covered = (ranges: number[][], text: string) => [...String(text || '')].every((ch) => /\s/.test(ch)
  || ranges.some(([a, b]) => ch.codePointAt(0)!! >= a! && ch.codePointAt(0)!! <= b!));
async function resolveFont(t: TreeText): Promise<FontName> {
  /* The family the visitor saw: the plan names it for this stack (a never-served first family is
     skipped, as the browser skips it; text a family's unicode-range leaves out goes to the next). */
  const entry = FONTS && FONTS.stacks && FONTS.stacks[t.stack!];
  let seen = (entry && (entry.family || entry.icon)) || t.family;
  if (entry && entry.ranges && !covered(entry.ranges, t.characters)) seen = entry.otherwise || seen;
  if (entry && entry.icon) {
    /* An icon font is not text: drawn as it comes, and counted, never reported as a missing font. */
    report.iconText[entry.icon] = (report.iconText[entry.icon] || 0) + 1;
    const fam = (findFamily(entry.icon) || findFamily('Inter') || Object.keys(fams)[0]!)!;
    return { family: fam!, style: pickStyle(fam!, null, t.weight, t.italic).style };
  }
  const plan = FONTS && FONTS.families && FONTS.families[famKey(seen)];
  let fam = findFamily(plan ? plan.family : seen);
  const standIn = !!(plan && plan.standIn) || !fam;
  if (!fam) fam = findFamily('Inter') || Object.keys(fams)[0]!;
  const named = (plan && plan.display) || seen;
  if (standIn && famKey(named) !== famKey(fam) && !report.missingFonts.includes(named)) report.missingFonts.push(named);
  if (standIn) report.standIns[named] = fam;
  const key = `${t.weight}|${t.italic ? 1 : 0}`;
  const face = plan && plan.faces && plan.faces[key];
  const onAxis = plan && plan.variable && plan.variable[key];
  /* A named weight (400, 700) asks for its style by name; anything between asks for none, so a
     variable family draws it on its weight axis instead of snapping to a neighbour. */
  const wanted = face ? canon(face) : (!onAxis && t.weight % 100 === 0
    ? styleFor(WEIGHT_NAMES[t.weight]! ? WEIGHT_NAMES[t.weight]![0]! : 'regular', t.italic) : null);
  const picked = pickStyle(fam!, wanted, t.weight, t.italic);
  const font: {family:string;style:string;variationSettings?:Record<string,number>} = { family: fam!, style: picked.style! };
  if (!picked.exact && typeof figma.getFontFamilyVariationAxes === 'function') {
    try {
      const axes = await figma.getFontFamilyVariationAxes(fam!);
      if (axes && axes.some((a) => ((a as unknown as {tag?: string}).tag || a) === 'wght')) font.variationSettings = { wght: t.weight };
    } catch (e) { /* static family */ }
  }
  if (!picked.exact && !font.variationSettings) report.styleFallbacks[`${named} ${t.weight}${t.italic ? ' italic' : ''}`] = `${fam} ${picked.style}`;
  return font;
}
const codeVars: Record<string,Variable> = {};
for (const v of await DL_API.variables()) {
  const m = v.codeSyntax && v.codeSyntax.WEB && v.codeSyntax.WEB.match(/var\(\s*(--[\w-]+)/);
  if (m) codeVars[m[1]!] = v;
}
const hexRgb = (h: string) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const report: RenderReport = { created: 0, bound: 0, literal: 0, variables: Object.keys(vars).length, fonts: {}, missingFonts: [], standIns: {}, styleFallbacks: {}, iconText: {}, nested: [], nestedMismatch: [], images: [], svgFailures: [], fellBack: [] };
function paint(c: Color) {
  let p: SolidPaint = { type: 'SOLID', color: hexRgb(c.hex), opacity: c.opacity ?? 1 };
  const v = c.var && codeVars[c.var]!;
  if (v) { p = figma.variables.setBoundVariableForPaint(p, 'color', v); report.bound++; } else report.literal++;
  return p;
}
function style(node: StyledNode, s: ExpandedRenderTree) {
  node.fills = s.fill ? [paint(s.fill)] : [];
  if (s.stroke) {
    node.strokes = [paint(s.stroke.color!)]; node.strokeAlign = 'INSIDE';
    node.strokeTopWeight = s.stroke.top!; node.strokeRightWeight = s.stroke.right!;
    node.strokeBottomWeight = s.stroke.bottom!; node.strokeLeftWeight = s.stroke.left!;
  }
  if (s.radius) [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius] = s.radius as [number,number,number,number];
  if (s.effects) node.effects = s.effects.map((e) => ({ type: e.type, visible: true, blendMode: 'NORMAL', spread: e.spread, radius: e.blur,
    offset: { x: e.x, y: e.y }, color: { ...hexRgb(e.color.hex), a: e.color.opacity ?? 1 } }));
  if (s.opacity !== undefined) node.opacity = s.opacity;
}

function layout(node: FrameNode|ComponentNode, L?: Layout) {
  if (!L || L.mode === 'NONE') return;
  node.layoutMode = L.mode;
  node.layoutWrap = L.wrap ? 'WRAP' : 'NO_WRAP';
  bind(node, 'itemSpacing', L.gap || 0);
  if (L.wrap) bind(node, 'counterAxisSpacing', L.counterGap || 0);
  const p = L.padding || {};
  bind(node, 'paddingTop', p.top || 0); bind(node, 'paddingRight', p.right || 0);
  bind(node, 'paddingBottom', p.bottom || 0); bind(node, 'paddingLeft', p.left || 0);
  node.primaryAxisAlignItems = L.primaryAlign || 'MIN';
  node.counterAxisAlignItems = L.counterAlign || 'MIN';
}

/* Size a node once it has a parent: FILL in auto layout, else a fixed (possibly bound)
   width; auto layout frames hug their height, everything else takes its measured height. */
function size(node: SizedNode, spec: ExpandedRenderTree, parentAuto: boolean|undefined, isText: boolean) {
  const single = isText && spec.text && spec.text.singleLine && spec.sizing !== 'FILL';
  const auto = !isText && node.layoutMode && node.layoutMode !== 'NONE';
  /* An image or vector leaf takes its measured width variable even where it fills: inside an
     instance switched to another mode, Figma re-stretches a filling frame but leaves a filling
     rectangle at the master's width (one site's photo: 436.5px in a 335px mobile instance). */
  const leaf = spec.kind === 'image' || spec.kind === 'svg';
  /* A label the site draws on one line at every width, filling a row (a button, a link with an
     icon): a stand-in font wider than the site's would wrap it inside the row's fixed box and
     clip the second line. It hugs its words and stays on one line instead. */
  if (isText && parentAuto && spec.sizing === 'FILL' && spec.text && spec.text.singleLine
      && node.parent && (node.parent as FrameNode).layoutMode === 'HORIZONTAL') {
    /* Only when the drawn font actually wraps it at the measured width: a label that fits keeps
       filling its row exactly as measured. */
    const line = typeof spec.text.lineHeight === 'number' ? spec.text.lineHeight : (node.fontSize as number) * 1.4;
    if (node.height > line * 1.5) {
      node.textAutoResize = 'WIDTH_AND_HEIGHT';
      node.layoutSizingHorizontal = 'HUG';
      /* A centred or right-aligned label alone in its row keeps its place once it hugs. */
      const along = ({ CENTER: 'CENTER', RIGHT: 'MAX' } as Record<string,'CENTER'|'MAX'>)[spec.text.align!];
      if (along && (node.parent as FrameNode).children.length === 1) (node.parent as FrameNode).primaryAxisAlignItems = along;
      return;
    }
  }
  if (parentAuto && spec.sizing === 'FILL' && !(leaf && isVar(spec.width))) node.layoutSizingHorizontal = 'FILL';
  else if (!single) {
    /* A bound width only holds on a FIXED axis; auto layout frames otherwise hug. */
    if (parentAuto) node.layoutSizingHorizontal = 'FIXED';
    else if (auto) { if (node.layoutMode === 'HORIZONTAL') node.primaryAxisSizingMode = 'FIXED'; else node.counterAxisSizingMode = 'FIXED'; }
    bind(node, 'width', spec.width);
  }
  if (isText) return;
  /* A frame with a visible box (fill, border, shadow) keeps its measured height at every width:
     the box is what the eye compares. Invisible containers hug their content. */
  const visibleBox = !!(spec.fill || spec.stroke || spec.effects);
  if (auto && visibleBox) {
    if (parentAuto) node.layoutSizingVertical = 'FIXED';
    else if (node.layoutMode === 'VERTICAL') node.primaryAxisSizingMode = 'FIXED';
    else node.counterAxisSizingMode = 'FIXED';
    bind(node, 'height', spec.height);
  } else if (auto && parentAuto) node.layoutSizingVertical = 'HUG';
  else if (auto) {
    if (node.layoutMode === 'VERTICAL') node.primaryAxisSizingMode = 'AUTO';
    else node.counterAxisSizingMode = 'AUTO';
  } else bind(node, 'height', spec.height);
}

/* Masters already in the file, by source id, so a child component's rendering inside this one
   becomes an instance of it (a link inside a banner is an instance of the link). */
let mastersBySource: Record<string,ComponentNode|ComponentSetNode>|null = null;
async function masterFor(sourceId: string) {
  const known = (ARGS.masters || {})[sourceId];
  if (known) {
    const node = await figma.getNodeByIdAsync(known);
    if (node && (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET')) return node;
  }
  if (!mastersBySource) {
    await figma.loadAllPagesAsync();
    mastersBySource = {};
    for (const n of figma.root.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] })) {
      if (n.type === 'COMPONENT' && n.parent && n.parent.type === 'COMPONENT_SET') continue;
      const id = n.getSharedPluginData('designlab', 'sourceId');
      if (id && id !== ARGS.id) mastersBySource[id] = n;
    }
  }
  return mastersBySource[sourceId] || null;
}

async function build(spec: ExpandedRenderTree, parent: FrameNode|ComponentNode, parentAuto: boolean|undefined): Promise<SceneNode> {
  let node!: FrameNode|RectangleNode|TextNode|InstanceNode;
  const w0 = Math.max(1, num(spec.width) || 1), h0 = Math.max(1, num(spec.height) || 1);
  let master = spec.instanceOf ? await masterFor(spec.instanceOf) : null;
  if (master) {
    /* An instance takes this rendering's own words and pictures as overrides, the way a
       designer fills a card instance; the master shows another rendering's content. Only when
       the structures match (same text layers and images, in order); otherwise this rendering
       is built as it stands, and the mismatch is recorded. */
    const texts: Extract<ExpandedRenderTree,{kind:"text"}>[] = [], images: Extract<ExpandedRenderTree,{kind:"image"}>[] = [];
    (function walk(s: ExpandedRenderTree) {
      if (s.kind === 'text') texts.push(s);
      else if (s.kind === 'image' && s.src && !String(s.src).startsWith('capture:')) images.push(s);
      (s.children || []).forEach(walk);
    })(spec);
    const counts = (n: ComponentNode) => [n.findAll((x) => x.type === 'TEXT').length,
      n.findAll((x) => x.type === 'RECTANGLE' && x.getSharedPluginData('designlab', 'image') === '1').length];
    const variants = (master.type === 'COMPONENT_SET' ? master.children : [master]) as ComponentNode[];
    const fits = variants.find((v) => { const [t, i] = counts(v); return t === texts.length && i === images.length; });
    const inst = (fits || (master.type === 'COMPONENT_SET' ? master.defaultVariant : master)).createInstance();
    const instTexts = inst.findAll((n) => n.type === 'TEXT') as TextNode[];
    const instImages = inst.findAll((n) => n.type === 'RECTANGLE' && n.getSharedPluginData('designlab', 'image') === '1');
    if (instTexts.length === texts.length && instImages.length === images.length) {
      for (let i = 0; i < texts.length; i++) {
        const t = instTexts[i]!;
        if (t.characters === texts[i]!.text.characters) continue;
        const fonts = t.fontName === figma.mixed ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName];
        for (const f of fonts) await DL_API.loadFont(f);
        t.characters = texts[i]!.text.characters;
      }
      images.forEach((img, i) => report.images.push({ id: instImages[i]!.id, src: img.src, fit: img.fit }));
      node = inst;
      node.resize(w0, h0);
      report.nested.push({ sourceId: spec.instanceOf, id: node.id });
    } else {
      inst.remove();
      report.nestedMismatch.push({ sourceId: spec.instanceOf, name: spec.name,
        texts: [texts.length, instTexts.length], images: [images.length, instImages.length] });
      master = null;
    }
  }
  if (master) {
    // the instance above
  } else if (spec.kind === 'text') {
    const t = spec.text;
    const font = await resolveFont(t);
    await DL_API.loadFont({ family: font.family, style: font.style });
    report.fonts[`${t.family} ${t.weight}`] = `${font.family} ${font.style}`;
    node = figma.createText();
    /* A Figma without variable-font support refuses variationSettings: draw the named style. */
    try { node.fontName = font; } catch (e) { node.fontName = { family: font.family, style: font.style }; }
    node.characters = t.characters;
    bind(node, 'fontSize', t.size);
    if (t.lineHeight) { if (isVar(t.lineHeight)) node.setBoundVariable('lineHeight', vars[t.lineHeight.var]!); else node.lineHeight = { unit: 'PIXELS', value: t.lineHeight }; }
    if (t.letterSpacing) { if (isVar(t.letterSpacing)) node.setBoundVariable('letterSpacing', vars[t.letterSpacing.var]!); else node.letterSpacing = { unit: 'PIXELS', value: t.letterSpacing }; }
    node.textAlignHorizontal = t.align || 'LEFT';
    node.textCase = t.case || 'ORIGINAL';
    if (t.underline) node.textDecoration = 'UNDERLINE';
    node.fills = [paint(t.color!)];
    node.textAutoResize = t.singleLine && spec.sizing !== 'FILL' ? 'WIDTH_AND_HEIGHT' : 'HEIGHT';
    if (node.textAutoResize === 'HEIGHT') node.resize(w0, node.height);
  } else if (spec.kind === 'svg') {
    try { node = figma.createNodeFromSvg(spec.svg); } catch (e) { report.svgFailures.push(spec.name); node = figma.createFrame(); node.fills = []; }
    node.resize(w0, h0);
    /* An imported SVG keeps Figma's default names (`Vector`, `Group`); name its parts after the icon. */
    let part = 0;
    for (const child of node.findAll(() => true)) {
      if (/^(Frame|Group|Rectangle|Ellipse|Vector|Line|Polygon|Star)( \d+)?$/.test(child.name)) child.name = `${spec.name} part ${++part}`;
    }
  } else if (spec.kind === 'image') {
    node = figma.createRectangle();
    node.resize(w0, h0);
    style(node as StyledNode, spec);
    node.fills = [{ type: 'SOLID', color: { r: 0.87, g: 0.87, b: 0.87 } }];
    node.setSharedPluginData('designlab', 'image', '1');   // so an instance can find its pictures
    report.images.push({ id: node.id, src: spec.src, fit: spec.fit });
  } else {
    node = figma.createFrame();
    node.resize(w0, h0);
    node.clipsContent = Boolean(spec.clip);
    style(node as StyledNode, spec);
    /* A CSS background image: the images step fills this frame from the site's own file. */
    if (spec.backgroundImage) report.images.push({ id: node.id, src: spec.backgroundImage.src, fit: spec.backgroundImage.fit === 'contain' ? 'FIT' : 'FILL' });
    layout(node, spec.layout);
    if (spec.layout && spec.layout.fellBack) report.fellBack.push(spec.name);
  }
  node.name = spec.name;
  parent.appendChild(node);
  /* Absolutely positioned on the site (a card laid over a photo, a decorative pseudo-element):
     out of the auto layout flow, at its measured offset. */
  const absolute = Boolean(spec.absolute && parentAuto);
  if (absolute) node.layoutPositioning = 'ABSOLUTE';
  if (!parentAuto || absolute) { node.x = spec.x || 0; node.y = spec.y || 0; }
  size(node as SizedNode, spec, parentAuto && !absolute, spec.kind === 'text');
  if (spec.visible !== undefined) { if (isVar(spec.visible)) node.setBoundVariable('visible', vars[spec.visible.var]!); else node.visible = spec.visible; }
  report.created++;
  if (spec.kind === 'frame' && !master) {
    const auto = spec.layout && spec.layout.mode !== 'NONE';
    for (const child of spec.children || []) await build(child, node as FrameNode, auto);
  }
  return node;
}

/* ---- The master: the root element's frame settings live on the component itself. */
/* A master still parked on the page came from an attempt that was never recorded; replace it
   so a retried step leaves one master, not two. Masters already placed in a block are kept. */
const previousOwner = (ARGS.existingComponentId ? await figma.getNodeByIdAsync(ARGS.existingComponentId) : null) as ComponentNode|ComponentSetNode|null;
if (ARGS.existingComponentId && !previousOwner) throw new Error('The previous master is missing; rebuild in a fresh file');
const wantsSet = Object.keys(ARGS.variant || {}).length > 0 || (ARGS.alternates || []).length > 0;
if (previousOwner && previousOwner.type !== (wantsSet ? 'COMPONENT_SET' : 'COMPONENT')) {
  throw new Error('The component/set shape changed; rebuild in a fresh file to preserve existing instance references');
}
const reusable = (previousOwner ? (previousOwner.type === 'COMPONENT_SET' ? [...previousOwner.children] : [previousOwner]) : []) as ComponentNode[];
if (previousOwner && reusable.length !== 1 + (ARGS.alternates || []).length) {
  throw new Error('The variant layout count changed; rebuild in a fresh file');
}
// Preserve variant identities only when their ordered labels still match.
if (previousOwner?.type === 'COMPONENT_SET') {
  const axes = { ...(ARGS.variant || {}) };
  if ((ARGS.alternates || []).length) axes.Layout = 'Captured';
  const label = (values: Record<string,string>) => Object.entries(values).map(([k, v]) => `${k}=${v}`).join(', ');
  const expected = [label(axes), ...(ARGS.alternates || []).map(a => label({
    ...Object.fromEntries(Object.keys(axes).map(k => [k, 'As captured'])), Layout: a.label }))];
  if (reusable.some((v, i) => v.name !== expected[i])) throw new Error('Variant identities changed; rebuild in a fresh file');
}
let reuseIndex = 0;
for (const old of page.children.filter((n) => n !== previousOwner && (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') && n.name === ARGS.name)) old.remove();
function assertExpanded(node: RenderTree): asserts node is ExpandedRenderTree {
  if (node.kind === 'text' && !node.text) throw new Error(`text node ${node.source} was not expanded`);
  for (const child of node.children ?? []) assertExpanded(child);
}

async function makeMaster(tree: RenderTree, name: string) {
  // Expansion above restored text styles; verify that contract before drawing.
  assertExpanded(tree);
  const component = reusable[reuseIndex++] || figma.createComponent();
  for (const child of [...component.children]) child.remove();
  // Reused roots must not retain a border, layout or binding absent from the new capture.
  for (const [field, value] of Object.entries(component.boundVariables || {})) {
    if (value && !Array.isArray(value) && value.type === 'VARIABLE_ALIAS') component.setBoundVariable(field as VariableBindableNodeField, null);
  }
  component.layoutMode = 'NONE';
  component.strokes = []; component.effects = []; component.cornerRadius = 0; component.opacity = 1;
  component.name = name;
  /* The inventory id, so a master nesting this one can say which source component it nests. */
  component.setSharedPluginData('designlab', 'sourceId', ARGS.id || '');
  component.description = ARGS.description || '';
  component.clipsContent = Boolean(tree.clip);
  component.resize(Math.max(1, num(tree.width)), Math.max(1, num(tree.height)));
  style(component, tree);
  layout(component, tree.layout);
  if (!reusable.includes(component)) page.appendChild(component);
  component.x = ARGS.x;
  component.y = ARGS.y;
  const rootAuto = tree.layout && tree.layout.mode !== 'NONE';
  for (const child of tree.children || []) await build(child, component, rootAuto);
  component.resize(Math.max(1, num(tree.width)), component.height);
  if (rootAuto) {
    if (tree.layout!.mode === 'VERTICAL') { component.counterAxisSizingMode = 'FIXED'; component.primaryAxisSizingMode = 'AUTO'; }
    else { component.primaryAxisSizingMode = 'FIXED'; component.counterAxisSizingMode = 'AUTO'; }
  } else {
    bind(component, 'height', tree.height);
  }
  /* The root's own width is usually the value that varies most between breakpoints; bound, an
     instance switched to Tablet or Mobile takes that width without being resized by hand. */
  if (isVar(tree.width)) bind(component, 'width', tree.width);
  return component;
}
const component = await makeMaster(ARGS.tree, ARGS.name);
if (ARGS.tree.visible !== undefined) report.notes = ['root visibility varies by width'];
const alternates = [];
for (const alt of ARGS.alternates || []) alternates.push({ label: alt.label, node: await makeMaster(alt.tree, ARGS.name) });
/* Planned variant axes, and any other layout the site renders: the master is the captured
   variant inside a set named for the component, each other layout a sibling variant (`Layout`),
   so a parent can nest whichever its rendering is. */
let owner: ComponentNode|ComponentSetNode = component;
const axes = { ...(ARGS.variant || {}) };
if (alternates.length) axes.Layout = 'Captured';
if (Object.keys(axes).length) {
  const name = (values: Record<string,string>) => Object.entries(values).map(([k, v]) => `${k}=${v}`).join(', ');
  component.name = name(axes);
  for (const alt of alternates) {
    alt.node.name = name({ ...Object.fromEntries(Object.keys(axes).map((k) => [k, 'As captured'])), Layout: alt.label });
  }
  owner = previousOwner || figma.combineAsVariants([component, ...alternates.map((a) => a.node)], page);
  if (previousOwner) for (const v of [component, ...alternates.map(a => a.node)]) owner.appendChild(v);
  owner.name = ARGS.name;
  owner.description = ARGS.description || '';
  owner.setSharedPluginData('designlab', 'sourceId', ARGS.id || '');
  owner.x = ARGS.x;
  owner.y = ARGS.y;
  /* The captured variant first and at the origin: it is the default, the one the block shows. */
  let x = 0;
  for (const v of [component, ...alternates.map((a) => a.node)]) { v.x = x; v.y = 0; x += v.width + 40; }
  owner.resizeWithoutConstraints(x - 40, Math.max(...owner.children.map((v) => v.height)));
}
return { componentId: owner.id, variantId: component.id, collectionId: col.id, width: component.width, height: component.height, ...report };

// DESIGN_LAB_TEMPLATE_END
}
