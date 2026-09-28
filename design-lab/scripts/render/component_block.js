/**
 * Place one built component set in its documentation block on its tier page.
 *
 * ARGS = {
 *   pageId, setId, id, order,
 *   doc: { label, machine, tier, purpose, chips: [], facts: [[k, v, link?]],
 *          properties: [[name, type, values, default]], fields: [[field, kind, required, figma]],
 *          relations: [line], notes: [line] },
 *   columns: [{ label, width }],          // one per variant, narrow to wide
 *   evidence: [{ label, width, height }], // one per capture, same order as columns
 *   captured: 'YYYY-MM-DD'
 * }
 *
 * The block is a frame named `Human Label · machine_name`, tagged with the component id and
 * its index order, inside the page's `Components` stack. Re-running replaces the block and
 * keeps the set. Blocks are re-sorted by order after every insert, so a resumed run lands
 * in the same place as an uninterrupted one. Returns the evidence rectangle ids for
 * upload_assets, and what the master measurably is (`native`): figma_receipts.py derives the
 * build record's native-component validation from it rather than asserting it.
 */
await loadKitFonts();
const page = await onPage(ARGS.pageId);
return await atomic(page, [ARGS.setId], async () => {
const set = await figma.getNodeByIdAsync(ARGS.setId);
if (!set || (set.type !== 'COMPONENT_SET' && set.type !== 'COMPONENT')) throw new Error(`not a component: ${ARGS.setId}`);

const stackNode = page.findOne((n) => n.getSharedPluginData('designlab', 'role') === 'components');
if (!stackNode) throw new Error('tier page has no Components stack; run tier_page first');

/* Keep the set, drop any previous block for this component. */
page.appendChild(set);
for (const old of stackNode.children.filter((n) => n.getSharedPluginData('designlab', 'component') === ARGS.id)) old.remove();

const D = ARGS.doc;
const W = KIT.width.doc;
const inner = W - 2 * KIT.space.panel;

const block = stack('HORIZONTAL', { name: `${D.label} · ${D.machine}`, gap: KIT.space.page, align: 'MIN' });
tag(block, 'component', ARGS.id);
tag(block, 'order', String(ARGS.order).padStart(5, '0'));

/* Documentation panel. */
const doc = stack('VERTICAL', { name: `Documentation · ${D.machine}`, width: W, pad: KIT.space.panel, gap: KIT.space.xl, fill: KIT.surface.panel, radius: KIT.radius.panel, stroke: KIT.surface.rule });
const head = stack('VERTICAL', { name: 'Head', gap: KIT.space.s, width: inner });
add(head,
  text(`Component · ${D.tier}`, 'eyebrow', { name: 'Tier' }),
  fillWidth(text(D.label, 'title', { name: 'Label', width: inner })),
  text(D.machine, 'code', { name: 'Machine name' }));
if (D.purpose) add(head, fillWidth(text(D.purpose, 'body', { name: 'Purpose', width: inner })));
if (D.chips && D.chips.length) {
  const chips = stack('HORIZONTAL', { name: 'Chips', gap: KIT.space.s, wrap: true, width: inner });
  add(chips, D.chips.map(chip));
  head.appendChild(chips);
}
doc.appendChild(head);

doc.appendChild(section('Usage', inner, table(
  [{ title: 'Fact', width: 176 }, { title: 'Value', width: inner - 176 }],
  D.facts.map(([k, v, link]) => [k, link ? { text: v, link: { type: 'URL', value: link } } : v]),
  { name: 'Facts' })));

if (D.properties && D.properties.length) {
  doc.appendChild(section('Figma properties', inner, table(
    [{ title: 'Property', width: 136 }, { title: 'Type', width: 96, role: 'cellCode' }, { title: 'Values', width: inner - 136 - 96 - 88 }, { title: 'Default', width: 88 }],
    D.properties, { name: 'Properties' })));
}

doc.appendChild(section('Fields', inner, D.fields && D.fields.length
  ? table(
    [{ title: 'Field', width: 150, role: 'cellCode' }, { title: 'Kind', width: 84 }, { title: 'Required', width: 104 }, { title: 'In Figma', width: inner - 338 }],
    D.fields, { name: 'Fields' })
  : text('This component has no authored fields.', 'body', { name: 'No fields', width: inner })));

if (D.relations && D.relations.length) {
  doc.appendChild(section('Relationships', inner, D.relations.map((line, i) => text(line, 'body', { name: `Relation ${i + 1}`, width: inner }))));
}
if (D.notes && D.notes.length) {
  doc.appendChild(section('Notes', inner, D.notes.map((line, i) => text(line, 'body', { name: `Note ${i + 1}`, width: inner }))));
}
block.appendChild(doc);

/* Specimen: breakpoint labels, then ONE component shown at every width — the master at
   desktop and instances of it resized to tablet and mobile with their Breakpoint mode set —
   then the live captures in the same columns. Nothing is drawn twice. */
const SET_PAD = 40;
const SET_GAP = 80;
const specimen = stack('VERTICAL', { name: 'Specimen', gap: KIT.space.l });
const labels = stack('HORIZONTAL', { name: 'Breakpoints', gap: SET_GAP, pad: { t: 0, r: 0, b: 0, l: SET_PAD } });
for (const col of ARGS.columns) {
  const cell = stack('HORIZONTAL', { name: col.label, width: col.width });
  add(cell, text(col.label, 'column', { name: 'Breakpoint' }));
  labels.appendChild(cell);
}
specimen.appendChild(labels);
const shown = stack('HORIZONTAL', { name: 'Component at each width', gap: SET_GAP, pad: SET_PAD, fill: '#ffffff', align: 'MIN' });
const collection = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === ARGS.collection);
const shownNodes = [];
for (const col of ARGS.columns) {
  if (col.master) { shown.appendChild(set); shownNodes.push(set); continue; }
  const inst = set.createInstance();
  inst.name = `${set.name} · ${col.label}`;
  shown.appendChild(inst);
  if (collection) {
    const mode = collection.modes.find((m) => m.name === col.mode);
    if (mode) inst.setExplicitVariableModeForCollection(collection, mode.modeId);
  }
  inst.resize(col.width, inst.height);
  shownNodes.push(inst);
}
specimen.appendChild(shown);

const evidenceIds = [];
if (ARGS.evidence && ARGS.evidence.length) {
  specimen.appendChild(stack('HORIZONTAL', { name: 'Live reference', pad: { t: KIT.space.l, r: 0, b: 0, l: SET_PAD } }));
  specimen.children[specimen.children.length - 1].appendChild(
    text(`Live reference · captured ${ARGS.captured}`, 'eyebrow', { name: 'Title' }));
  const row = stack('HORIZONTAL', { name: 'Captures', gap: SET_GAP, pad: { t: 0, r: 0, b: 0, l: SET_PAD }, align: 'MIN' });
  for (const ev of ARGS.evidence) {
    const r = figma.createRectangle();
    r.name = `Capture · ${ev.label}`;
    r.resize(ev.width, ev.height);
    r.fills = solid(KIT.surface.sunken);
    r.strokes = solid(KIT.surface.rule);
    r.strokeWeight = 1;
    r.strokeAlign = 'OUTSIDE';
    row.appendChild(r);
    evidenceIds.push(r.id);
  }
  specimen.appendChild(row);
}
block.appendChild(specimen);

/* The Assets panel's jump from component to documentation (standard section 4.3). */
if (ARGS.fileKey) set.documentationLinks = [{ uri: `https://www.figma.com/design/${ARGS.fileKey}?node-id=${block.id.replace(':', '-')}` }];

/* Insert in index order. */
stackNode.appendChild(block);
const ordered = [...stackNode.children]
  .filter((n) => n.getSharedPluginData('designlab', 'order'))
  .sort((a, b) => a.getSharedPluginData('designlab', 'order').localeCompare(b.getSharedPluginData('designlab', 'order')));
const firstBlockIndex = stackNode.children.findIndex((n) => n.getSharedPluginData('designlab', 'order'));
ordered.forEach((n, i) => stackNode.insertChild(firstBlockIndex + i, n));

/* Where each variant and each capture sits inside the specimen, so one screenshot of the
   specimen can be cut into matched pairs by figma_compare.py. */
const origin = specimen.absoluteBoundingBox;
const rel = (n) => { const b = n.absoluteBoundingBox; return { label: n.name, x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height }; };
const geometry = {
  specimen: { width: origin.width, height: origin.height },
  variants: shownNodes.map(rel),
  captures: evidenceIds.length ? specimen.children[specimen.children.length - 1].children.map(rel) : [],
};
/* Measured after the images step has filled the master, so an image fill is visible here. */
const hasImageFill = (n) => 'fills' in n && Array.isArray(n.fills) && n.fills.some((p) => p.type === 'IMAGE');
const nestedInstances = [];
for (const inst of set.findAllWithCriteria({ types: ['INSTANCE'] })) {
  const main = await inst.getMainComponentAsync();
  const owner = main && main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : main;
  nestedInstances.push({ instanceId: inst.id, mainComponentId: main ? main.id : null,
    sourceId: (owner && owner.getSharedPluginData('designlab', 'sourceId')) || null });
}
/* The Fields table as drawn: the first cell of every row, read back from the canvas. */
const fieldsTable = doc.findOne((n) => n.type === 'FRAME' && n.name === 'Fields' && n.children.some((c) => c.name === 'Header'));
const documentedFields = fieldsTable
  ? fieldsTable.children.filter((r) => /^Row \d+$/.test(r.name)).map((r) => {
    const cell = r.children[0] && r.children[0].findOne((n) => n.type === 'TEXT');
    return cell ? cell.characters : null;
  })
  : [];
const native = { nodeType: set.type, rootHasImageFill: hasImageFill(set), nestedInstances, documentedFields };
return { blockId: block.id, docId: doc.id, setId: set.id, specimenId: specimen.id, evidenceIds, geometry, native, width: block.width, height: block.height };
});
