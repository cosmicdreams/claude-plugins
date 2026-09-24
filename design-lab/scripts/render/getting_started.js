/**
 * The Getting Started page: orientation, coverage, the index, known gaps and provenance.
 * Rebuilt whole on every run; it holds no state of its own.
 *
 * ARGS = { pageId, title, what, whatNot,
 *   coverage: { columns: [..], rows: [[..]] },
 *   organisation: [line], thresholds: { columns, rows },
 *   blockGuide: [[section, meaning]],
 *   index: [{ placements, label, machine, tier, type, status, setId, blockId }],
 *   gaps: [line], changelog: [[date, entry]], provenance: [line], regenerate: [command] }
 * Index names link to the component set, Documentation links to its block; a row that was
 * not built links to nothing rather than to a placeholder.
 */
await loadKitFonts();
const page = await onPage(ARGS.pageId);
return await atomic(page, [], async () => {
clearTagged(page, 'role', 'getting-started');

const W = KIT.width.page, inner = W - 2 * KIT.space.page;
const root = stack('VERTICAL', { name: 'Getting Started', width: W, pad: KIT.space.page, gap: KIT.space.page, fill: KIT.surface.panel, radius: KIT.radius.panel, stroke: KIT.surface.rule });
tag(root, 'role', 'getting-started');
page.appendChild(root);
root.x = 0; root.y = 0;

const head = stack('VERTICAL', { name: 'Header', gap: KIT.space.m, width: inner });
add(head, text('Getting started', 'eyebrow', { name: 'Eyebrow' }),
  fillWidth(text(ARGS.title, 'title', { name: 'Title', width: inner })),
  fillWidth(text(ARGS.what, 'body', { name: 'What', width: 880 })),
  fillWidth(text(ARGS.whatNot, 'small', { name: 'What not', width: 880 })));
root.appendChild(head);

const cols = (spec, total) => {
  const fixed = spec.reduce((s, c) => s + (c.width || 0), 0);
  const flex = spec.filter((c) => !c.width).length;
  return spec.map((c) => ({ ...c, width: c.width || Math.floor((total - fixed) / Math.max(1, flex)) }));
};

root.appendChild(section('Coverage', inner, table(cols(ARGS.coverage.columns, inner), ARGS.coverage.rows, { name: 'Coverage' })));

root.appendChild(section('How this file is organised', inner,
  ARGS.organisation.map((l, i) => text(l, 'body', { name: `Organisation ${i + 1}`, width: 880 })),
  table(cols(ARGS.thresholds.columns, 640), ARGS.thresholds.rows, { name: 'Thresholds' })));

root.appendChild(section('What each component block shows', inner,
  table([{ title: 'Section', width: 220 }, { title: 'What it tells you', width: inner - 220 }], ARGS.blockGuide, { name: 'Block guide' })));

const idx = ARGS.index.map((r) => [
  { text: String(r.placements), role: 'cellCode' },
  r.setId ? { text: `${r.label}`, link: { type: 'NODE', value: r.setId } } : r.label,
  { text: r.machine, role: 'cellCode' },
  r.tier, r.type, r.status,
  r.blockId ? { text: 'Open', link: { type: 'NODE', value: r.blockId } } : '—',
]);
root.appendChild(section('Index', inner,
  text('Sorted by placements within tier. The name opens the component; Open jumps to its documentation.', 'small', { name: 'Index note', width: inner }),
  table(cols([{ title: 'Placements', width: 110 }, { title: 'Component', width: 240 }, { title: 'Machine name', width: 260 }, { title: 'Tier' }, { title: 'Type', width: 150 }, { title: 'Status', width: 190 }, { title: 'Docs', width: 80 }], inner), idx, { name: 'Index' })));

root.appendChild(section('Known gaps', inner, ARGS.gaps.length
  ? ARGS.gaps.map((l, i) => text(`${i + 1}. ${l}`, 'body', { name: `Gap ${i + 1}`, width: inner }))
  : [text('None. Every expectation in the standard is met or has no source to meet it from.', 'body', { name: 'No gaps', width: inner })]));

if (ARGS.changelog && ARGS.changelog.length) {
  root.appendChild(section('Changelog', inner, table([{ title: 'Date', width: 160, role: 'cellCode' }, { title: 'Change', width: inner - 160 }], ARGS.changelog, { name: 'Changelog' })));
}

root.appendChild(section('Provenance and regeneration', inner,
  ARGS.provenance.map((l, i) => text(l, 'body', { name: `Provenance ${i + 1}`, width: inner })),
  ARGS.regenerate.map((c, i) => text(`${i + 1}. ${c}`, 'code', { name: `Command ${i + 1}`, width: inner }))));

return { rootId: root.id, rows: idx.length, height: root.height };
});
