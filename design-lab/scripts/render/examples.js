/**
 * The Examples page: real pages of the site recomposed from library INSTANCES, in the order
 * the site renders them, at desktop and at mobile. Nothing here is a component or a copy;
 * editing a master updates every example. The mobile column sets the Breakpoint collection
 * to its Mobile mode once, and every instance inside inherits it.
 *
 * ARGS = { pageId, collection, desktopMode, mobileMode,
 *   pages: [{ address, title, items: [{ componentId, label, desktop, mobile } | { missing: label }] }] }
 */
await loadKitFonts();
const page = await onPage(ARGS.pageId);
return await atomic(page, [], async () => {
clearTagged(page, 'role', 'examples');

const collection = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === ARGS.collection);
const modeOf = (name) => collection && collection.modes.find((m) => m.name === name);
const root = stack('VERTICAL', { name: 'Examples', gap: KIT.space.block, pad: KIT.space.page });
tag(root, 'role', 'examples');
page.appendChild(root);
root.x = 0; root.y = 0;

const head = stack('VERTICAL', { name: 'Page header', width: KIT.width.page, pad: KIT.space.panel, gap: KIT.space.m, fill: KIT.surface.panel, radius: KIT.radius.panel, stroke: KIT.surface.rule });
add(head, text('Examples', 'eyebrow', { name: 'Eyebrow' }),
  text('Pages built from the library', 'title', { name: 'Title', width: KIT.width.page - 80 }),
  text('Each page below is assembled from instances of the library components, in the order the live page renders them. Content is each component’s reference capture, not the page’s own copy. Change a component and every example follows.', 'body', { name: 'Lede', width: 960 }));
root.appendChild(head);

const ids = [];
for (const p of ARGS.pages) {
  const block = stack('VERTICAL', { name: `Example · ${p.address}`, gap: KIT.space.l });
  add(block, text(p.title, 'heading', { name: 'Title' }), text(p.address, 'code', { name: 'Address' }));
  const pair = stack('HORIZONTAL', { name: 'Widths', gap: KIT.space.page, align: 'MIN' });
  for (const [label, mode, key, width] of [['Desktop', ARGS.desktopMode, 'desktop', 1400], ['Mobile', ARGS.mobileMode, 'mobile', 375]]) {
    const col = stack('VERTICAL', { name: label, gap: KIT.space.m });
    add(col, text(`${label} · ${width}px`, 'column', { name: 'Label' }));
    const frame = stack('VERTICAL', { name: `${label} page`, width, fill: '#ffffff', align: 'CENTER' });
    const m = modeOf(mode);
    if (m) frame.setExplicitVariableModeForCollection(collection, m.modeId);
    for (const item of p.items) {
      if (item.missing) {
        const note = stack('HORIZONTAL', { name: `Not built · ${item.missing}`, width, pad: KIT.space.m, fill: KIT.surface.sunken, justify: 'CENTER' });
        add(note, text(`${item.missing} — not built`, 'small', { name: 'Note' }));
        frame.appendChild(note);
        continue;
      }
      const master = await figma.getNodeByIdAsync(item.componentId);
      if (!master) continue;
      const inst = master.createInstance();
      frame.appendChild(inst);
      inst.resize(Math.min(width, item[key] || master.width), inst.height);
      ids.push(inst.id);
    }
    add(col, frame);
    pair.appendChild(col);
  }
  block.appendChild(pair);
  root.appendChild(block);
}
return { rootId: root.id, instances: ids.length };
});
