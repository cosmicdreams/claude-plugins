/**
 * The Cover: one 1440 × 900 poster, which is also the file thumbnail.
 *
 * ARGS = { pageId, eyebrow, headline, lede, stats: [{ key, value, label, note }],
 *          provenance: [line], version }
 * Dark neutral ground, 80 of margin, headline block at the top, stat tiles in one row, the
 * provenance block pinned to the bottom. Four to six stats; more are refused by layout.py.
 */
await loadKitFonts();
const page = await onPage(ARGS.pageId);
return await atomic(page, [], async () => {
clearTagged(page, 'role', 'cover');

const W = 1440, H = 900, M = KIT.space.page;
const cover = stack('VERTICAL', { name: 'Cover', width: W, height: H, pad: M, fill: KIT.surface.dark, justify: 'SPACE_BETWEEN' });
tag(cover, 'role', 'cover');
page.appendChild(cover);
cover.x = 0;
cover.y = 0;

const inner = W - 2 * M;
const top = stack('VERTICAL', { name: 'Title', gap: KIT.space.l, width: inner });
add(top,
  text(ARGS.eyebrow, 'eyebrowDk', { name: 'Eyebrow' }),
  fillWidth(text(ARGS.headline, 'display', { name: 'Headline', width: inner })),
  text(ARGS.lede, 'lede', { name: 'Lede', width: 880 }));

const tileW = Math.floor((inner - KIT.space.l * (ARGS.stats.length - 1)) / ARGS.stats.length);
const stats = stack('HORIZONTAL', { name: 'Stats', gap: KIT.space.l, width: inner });
for (const s of ARGS.stats) {
  const tile = stack('VERTICAL', { name: `Stat / ${s.key}`, gap: KIT.space.s, width: tileW, pad: { t: KIT.space.l, r: 0, b: 0, l: 0 } });
  tile.strokes = solid('#3f3f46');
  tile.strokeTopWeight = 1; tile.strokeRightWeight = 0; tile.strokeBottomWeight = 0; tile.strokeLeftWeight = 0;
  add(tile,
    text(s.value, 'statValue', { name: 'Value' }),
    text(s.label, 'statLabel', { name: 'Label', width: tileW }),
    s.note ? text(s.note, 'statNote', { name: 'Note', width: tileW }) : null);
  stats.appendChild(tile);
}

const prov = stack('VERTICAL', { name: 'Provenance', gap: KIT.space.xs, width: inner });
add(prov, ARGS.provenance.map((line, i) => text(line, 'provDark', { name: `Provenance ${i + 1}`, width: inner })));

const lower = stack('VERTICAL', { name: 'Lower', gap: KIT.space.xxl, width: inner });
add(lower, stats, prov);
add(cover, top, lower);
page.setSharedPluginData('designlab', 'version', ARGS.version || '');
return { coverId: cover.id, width: cover.width, height: cover.height };
});
