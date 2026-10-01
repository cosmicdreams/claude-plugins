/**
 * Build ONE responsive master for one component from a responsive.py tree.
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
function expand(node, styles = ARGS.styles) {
  if (node.ts !== undefined) { node.text = { ...styles[node.ts], characters: node.chars }; delete node.ts; delete node.chars; }
  if (node.layout) {
    const [t, r, b, l] = node.layout.pad || [0, 0, 0, 0];
    node.layout.padding = { top: t, right: r, bottom: b, left: l };
    delete node.layout.pad;
  }
  (node.children || []).forEach((child) => expand(child, styles));
  return node;
}
if (ARGS.styles) expand(ARGS.tree);
/* Other layouts the site renders this component in (a card with fewer fields inside another
   block), each compacted with its own text styles. */
for (const alt of ARGS.alternates || []) expand(alt.tree, alt.styles);

const page = await figma.getNodeByIdAsync(ARGS.pageId);
await figma.setCurrentPageAsync(page);

/* ---- Breakpoint collection and this component's variables (idempotent by name). */
const collections = await figma.variables.getLocalVariableCollectionsAsync();
let col = collections.find((c) => c.name === ARGS.collection);
const order = ['Desktop', 'Tablet', 'Mobile'];
if (!col) {
  col = figma.variables.createVariableCollection(ARGS.collection);
  col.renameMode(col.modes[0].modeId, ARGS.modeNames.Desktop);
  col.addMode(ARGS.modeNames.Tablet);
  col.addMode(ARGS.modeNames.Mobile);
}
const modeId = {};
for (const role of order) {
  const m = col.modes.find((x) => x.name === ARGS.modeNames[role]);
  if (!m) throw new Error(`Breakpoint collection has no mode ${ARGS.modeNames[role]}`);
  modeId[role] = m.modeId;
}
const existing = (await figma.variables.getLocalVariablesAsync()).filter((v) => v.variableCollectionId === col.id);
const byName = Object.fromEntries(existing.map((v) => [v.name, v]));
const SCOPE = [
  [/\/(width|height)$/, ['WIDTH_HEIGHT']], [/\/(gap|column-gap|row-gap|spacer-\d+)$/, ['GAP']],
  [/\/padding-/, ['GAP']], [/\/size$/, ['FONT_SIZE']], [/\/lineheight$/, ['LINE_HEIGHT']],
  [/\/letterspacing$/, ['LETTER_SPACING']],
];
const vars = {};
for (const [name, spec] of Object.entries(ARGS.variables)) {
  let v = byName[name];
  if (!v) v = figma.variables.createVariable(name, col, spec.type);
  /* Measured per breakpoint from the live site; the code computes these, it does not declare them. */
  v.description = 'Measured from the live site at each breakpoint; no CSS custom property '
    + 'declares this value, so there is no code name.';
  for (const role of order) v.setValueForMode(modeId[role], spec.values[role]);
  if (spec.type !== 'BOOLEAN') {
    const hit = SCOPE.find(([re]) => re.test(name));
    v.scopes = hit ? hit[1] : [];
  }
  vars[name] = v;
}
const isVar = (v) => v && typeof v === 'object' && v.var;
const num = (v) => (isVar(v) ? ARGS.variables[v.var].values.Desktop : v);
const bind = (node, field, v) => {
  if (v === undefined || v === null) return;
  if (isVar(v)) { node.setBoundVariable(field, vars[v.var]); report.bound++; return; }
  /* width and height are read-only properties: a plain size goes through resize(). */
  if (field === 'width') node.resize(Math.max(1, v), node.height);
  else if (field === 'height') node.resize(node.width, Math.max(1, v));
  else node[field] = v;
};

/* ---- Fonts and colours: fixed rules: nearest available weight, colours bound by code syntax. */
const WEIGHT_STYLES = { 100: ['Thin'], 200: ['ExtraLight', 'Extra Light'], 300: ['Light'], 400: ['Regular'],
  500: ['Medium'], 600: ['SemiBold', 'Semi Bold'], 700: ['Bold'], 800: ['ExtraBold', 'Extra Bold'], 900: ['Black'] };
const fams = {};
for (const f of await figma.listAvailableFontsAsync()) (fams[f.fontName.family] ||= new Set()).add(f.fontName.style);
/* CSS names a font by its web-font id (`articulat-cf`); Figma by its family (`Articulat CF`). */
const famKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const famByKey = {};
for (const name of Object.keys(fams)) famByKey[famKey(name)] ||= name;
function resolveFont(family, weight, italic) {
  const fam = fams[family] ? family : (famByKey[famKey(family)] || 'Inter');
  if (fam === 'Inter' && famKey(family) !== 'inter' && !report.missingFonts.includes(family)) report.missingFonts.push(family);
  const styles = fams[fam];
  const ws = Object.keys(WEIGHT_STYLES).map(Number).sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight) || a - b);
  for (const w of ws) for (const base of WEIGHT_STYLES[w]) {
    const n = italic ? (base === 'Regular' ? 'Italic' : `${base} Italic`) : base;
    if (styles.has(n)) return { family: fam, style: n };
  }
  return { family: fam, style: [...styles][0] };
}
const codeVars = {};
for (const v of await figma.variables.getLocalVariablesAsync()) {
  const m = v.codeSyntax && v.codeSyntax.WEB && v.codeSyntax.WEB.match(/var\(\s*(--[\w-]+)/);
  if (m) codeVars[m[1]] = v;
}
const hexRgb = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const report = { created: 0, bound: 0, literal: 0, variables: Object.keys(vars).length, fonts: {}, missingFonts: [], nested: [], nestedMismatch: [], images: [], svgFailures: [], fellBack: [] };
function paint(c) {
  let p = { type: 'SOLID', color: hexRgb(c.hex), opacity: c.opacity ?? 1 };
  const v = c.var && codeVars[c.var];
  if (v) { p = figma.variables.setBoundVariableForPaint(p, 'color', v); report.bound++; } else report.literal++;
  return p;
}
function style(node, s) {
  node.fills = s.fill ? [paint(s.fill)] : [];
  if (s.stroke) {
    node.strokes = [paint(s.stroke.color)]; node.strokeAlign = 'INSIDE';
    node.strokeTopWeight = s.stroke.top; node.strokeRightWeight = s.stroke.right;
    node.strokeBottomWeight = s.stroke.bottom; node.strokeLeftWeight = s.stroke.left;
  }
  if (s.radius) [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius] = s.radius;
  if (s.effects) node.effects = s.effects.map((e) => ({ type: e.type, visible: true, blendMode: 'NORMAL', spread: e.spread, radius: e.blur,
    offset: { x: e.x, y: e.y }, color: { ...hexRgb(e.color.hex), a: e.color.opacity } }));
  if (s.opacity !== undefined) node.opacity = s.opacity;
}

function layout(node, L) {
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
function size(node, spec, parentAuto, isText) {
  const single = isText && spec.text && spec.text.singleLine && spec.sizing !== 'FILL';
  const auto = !isText && node.layoutMode && node.layoutMode !== 'NONE';
  /* An image or vector leaf takes its measured width variable even where it fills: inside an
     instance switched to another mode, Figma re-stretches a filling frame but leaves a filling
     rectangle at the master's width (one site's photo: 436.5px in a 335px mobile instance). */
  const leaf = spec.kind === 'image' || spec.kind === 'svg';
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
let mastersBySource = null;
async function masterFor(sourceId) {
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

async function build(spec, parent, parentAuto) {
  let node;
  const w0 = Math.max(1, num(spec.width) || 1), h0 = Math.max(1, num(spec.height) || 1);
  let master = spec.instanceOf ? await masterFor(spec.instanceOf) : null;
  if (master) {
    /* An instance takes this rendering's own words and pictures as overrides, the way a
       designer fills a card instance; the master shows another rendering's content. Only when
       the structures match (same text layers and images, in order); otherwise this rendering
       is built as it stands, and the mismatch is recorded. */
    const texts = [], images = [];
    (function walk(s) {
      if (s.kind === 'text') texts.push(s);
      else if (s.kind === 'image' && s.src && !String(s.src).startsWith('capture:')) images.push(s);
      (s.children || []).forEach(walk);
    })(spec);
    const counts = (n) => [n.findAll((x) => x.type === 'TEXT').length,
      n.findAll((x) => x.type === 'RECTANGLE' && x.getSharedPluginData('designlab', 'image') === '1').length];
    const variants = master.type === 'COMPONENT_SET' ? master.children : [master];
    const fits = variants.find((v) => { const [t, i] = counts(v); return t === texts.length && i === images.length; });
    const inst = (fits || (master.type === 'COMPONENT_SET' ? master.defaultVariant : master)).createInstance();
    const instTexts = inst.findAll((n) => n.type === 'TEXT');
    const instImages = inst.findAll((n) => n.type === 'RECTANGLE' && n.getSharedPluginData('designlab', 'image') === '1');
    if (instTexts.length === texts.length && instImages.length === images.length) {
      for (let i = 0; i < texts.length; i++) {
        const t = instTexts[i];
        if (t.characters === texts[i].text.characters) continue;
        const fonts = t.fontName === figma.mixed ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName];
        for (const f of fonts) await figma.loadFontAsync(f);
        t.characters = texts[i].text.characters;
      }
      images.forEach((img, i) => report.images.push({ id: instImages[i].id, src: img.src, fit: img.fit }));
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
    const font = resolveFont(t.family, t.weight, t.italic);
    await figma.loadFontAsync(font);
    report.fonts[`${t.family} ${t.weight}`] = `${font.family} ${font.style}`;
    node = figma.createText();
    node.fontName = font;
    node.characters = t.characters;
    bind(node, 'fontSize', t.size);
    if (t.lineHeight) { if (isVar(t.lineHeight)) node.setBoundVariable('lineHeight', vars[t.lineHeight.var]); else node.lineHeight = { unit: 'PIXELS', value: t.lineHeight }; }
    if (t.letterSpacing) { if (isVar(t.letterSpacing)) node.setBoundVariable('letterSpacing', vars[t.letterSpacing.var]); else node.letterSpacing = { unit: 'PIXELS', value: t.letterSpacing }; }
    node.textAlignHorizontal = t.align || 'LEFT';
    node.textCase = t.case || 'ORIGINAL';
    if (t.underline) node.textDecoration = 'UNDERLINE';
    node.fills = [paint(t.color)];
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
    style(node, spec);
    node.fills = [{ type: 'SOLID', color: { r: 0.87, g: 0.87, b: 0.87 } }];
    node.setSharedPluginData('designlab', 'image', '1');   // so an instance can find its pictures
    report.images.push({ id: node.id, src: spec.src, fit: spec.fit });
  } else {
    node = figma.createFrame();
    node.resize(w0, h0);
    node.clipsContent = Boolean(spec.clip);
    style(node, spec);
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
  size(node, spec, parentAuto && !absolute, spec.kind === 'text');
  if (spec.visible !== undefined) { if (isVar(spec.visible)) node.setBoundVariable('visible', vars[spec.visible.var]); else node.visible = spec.visible; }
  report.created++;
  if (spec.kind === 'frame' && !master) {
    const auto = spec.layout && spec.layout.mode !== 'NONE';
    for (const child of spec.children || []) await build(child, node, auto);
  }
  return node;
}

/* ---- The master: the root element's frame settings live on the component itself. */
/* A master still parked on the page came from an attempt that was never recorded; replace it
   so a retried step leaves one master, not two. Masters already placed in a block are kept. */
for (const old of page.children.filter((n) => (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') && n.name === ARGS.name)) old.remove();
async function makeMaster(tree, name) {
  const component = figma.createComponent();
  component.name = name;
  /* The inventory id, so a master nesting this one can say which source component it nests. */
  component.setSharedPluginData('designlab', 'sourceId', ARGS.id || '');
  component.description = ARGS.description || '';
  component.clipsContent = Boolean(tree.clip);
  component.resize(Math.max(1, num(tree.width)), Math.max(1, num(tree.height)));
  style(component, tree);
  layout(component, tree.layout);
  page.appendChild(component);
  component.x = ARGS.x;
  component.y = ARGS.y;
  const rootAuto = tree.layout && tree.layout.mode !== 'NONE';
  for (const child of tree.children || []) await build(child, component, rootAuto);
  component.resize(Math.max(1, num(tree.width)), component.height);
  if (rootAuto) {
    if (tree.layout.mode === 'VERTICAL') { component.counterAxisSizingMode = 'FIXED'; component.primaryAxisSizingMode = 'AUTO'; }
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
let owner = component;
const axes = { ...(ARGS.variant || {}) };
if (alternates.length) axes.Layout = 'Captured';
if (Object.keys(axes).length) {
  const name = (values) => Object.entries(values).map(([k, v]) => `${k}=${v}`).join(', ');
  component.name = name(axes);
  for (const alt of alternates) {
    alt.node.name = name({ ...Object.fromEntries(Object.keys(axes).map((k) => [k, 'As captured'])), Layout: alt.label });
  }
  owner = figma.combineAsVariants([component, ...alternates.map((a) => a.node)], page);
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
