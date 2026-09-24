/**
 * Prepare one component tier page: a header panel and an empty `Components` stack that
 * component_block.js fills. Idempotent: re-running refreshes the header text and keeps
 * any blocks already placed.
 *
 * ARGS = { pageId, title, summary: [line], thresholds, emptyLine? }
 * `emptyLine` is shown instead of blocks when the tier has no components, because an empty
 * page must still say why it is empty.
 */
await loadKitFonts();
const page = await onPage(ARGS.pageId);
return await atomic(page, [], async () => {

let root = page.children.find((n) => n.getSharedPluginData('designlab', 'role') === 'tier-root');
if (!root) {
  root = stack('VERTICAL', { name: ARGS.title, gap: KIT.space.block, pad: KIT.space.page });
  tag(root, 'role', 'tier-root');
  page.appendChild(root);
  root.x = 0;
  root.y = 0;
}
root.name = ARGS.title;

for (const old of root.children.filter((n) => n.getSharedPluginData('designlab', 'role') === 'tier-header')) old.remove();
const inner = KIT.width.page - 2 * KIT.space.panel;
const header = stack('VERTICAL', { name: 'Page header', width: KIT.width.page, pad: KIT.space.panel, gap: KIT.space.m, fill: KIT.surface.panel, radius: KIT.radius.panel, stroke: KIT.surface.rule });
tag(header, 'role', 'tier-header');
add(header,
  text('Components', 'eyebrow', { name: 'Eyebrow' }),
  fillWidth(text(ARGS.title.replace(/^Components — /, ''), 'title', { name: 'Title', width: inner })),
  ARGS.summary.map((line, i) => fillWidth(text(line, 'body', { name: `Summary ${i + 1}`, width: inner }))),
  ARGS.thresholds ? text(ARGS.thresholds, 'small', { name: 'Thresholds', width: inner }) : null);
root.insertChild(0, header);

let components = page.findOne((n) => n.getSharedPluginData('designlab', 'role') === 'components');
if (!components) {
  components = stack('VERTICAL', { name: 'Components', gap: KIT.space.block });
  tag(components, 'role', 'components');
  root.appendChild(components);
}
if (components.parent !== root) root.appendChild(components);

for (const old of components.children.filter((n) => n.getSharedPluginData('designlab', 'role') === 'empty')) old.remove();
if (ARGS.emptyLine) {
  const empty = text(ARGS.emptyLine, 'body', { name: 'Empty', width: KIT.width.page });
  tag(empty, 'role', 'empty');
  components.appendChild(empty);
}
return { rootId: root.id, headerId: header.id, componentsId: components.id };
});
