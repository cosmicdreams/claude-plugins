/**
 * The Cover: one 1440 × 900 poster for the library's recipient, which is also the file thumbnail.
 *
 * ARGS = { pageId, headline, subtitle, total: { value, label },
 *          tiers: [{ key, value, label }], provenance: {..}, version }
 * Dark neutral ground, 80 of margin. The site's name and one generic line at the top; at the
 * bottom the number of components, a bar split by usage tier, and one tile per tier. The tiers
 * add up to the total. Provenance is stored as hidden plugin data on the document and on the
 * cover, for refreshes and the benchmark report; no page draws it.
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
  fillWidth(text(ARGS.headline, 'coverTitle', { name: 'Headline', width: inner })),
  ARGS.subtitle ? text(ARGS.subtitle, 'coverSub', { name: 'Subtitle' }) : null);

const lower = stack('VERTICAL', { name: 'Library', gap: KIT.space.xl, width: inner });
const total = stack('HORIZONTAL', { name: 'Total', gap: KIT.space.m, align: 'BASELINE' });
add(total, text(ARGS.total.value, 'coverTotal', { name: 'Value' }), text(ARGS.total.label, 'coverUnit', { name: 'Label' }));
lower.appendChild(total);

const tiers = ARGS.tiers || [];
const sum = tiers.reduce((s, t) => s + Number(t.value), 0);
if (tiers.length && sum > 0) {
  /* One bar, split by tier in widths proportional to the counts: the breakdown at a glance. */
  const shades = ['#fafafa', '#a1a1aa', '#71717a', '#52525b', '#3f3f46', '#27272a'];
  const bar = stack('HORIZONTAL', { name: 'Tier bar', gap: 4, width: inner, height: 12 });
  let used = 0;
  const shown = tiers.filter((t) => Number(t.value) > 0);
  shown.forEach((t, i) => {
    const room = inner - 4 * (shown.length - 1);
    const w = i === shown.length - 1 ? room - used : Math.round(room * Number(t.value) / sum);
    used += w;
    const seg = stack('HORIZONTAL', { name: `Tier bar / ${t.key}`, width: Math.max(4, w), height: 12, radius: 3,
      fill: shades[tiers.indexOf(t) % shades.length] });
    bar.appendChild(seg);
  });
  lower.appendChild(bar);
}
if (tiers.length) {
  const gap = KIT.space.l;
  const tileW = Math.floor((inner - gap * (tiers.length - 1)) / tiers.length);
  const row = stack('HORIZONTAL', { name: 'Tiers', gap, width: inner });
  const shades = ['#fafafa', '#a1a1aa', '#71717a', '#52525b', '#3f3f46', '#27272a'];
  tiers.forEach((t, i) => {
    const tile = stack('VERTICAL', { name: `Tier / ${t.key}`, gap: KIT.space.s, width: tileW, pad: { t: KIT.space.m, r: 0, b: 0, l: 0 } });
    tile.strokes = solid(shades[i % shades.length]);
    tile.strokeTopWeight = 2; tile.strokeRightWeight = 0; tile.strokeBottomWeight = 0; tile.strokeLeftWeight = 0;
    add(tile, text(t.value, 'statValue', { name: 'Value' }), text(t.label, 'statLabel', { name: 'Label', width: tileW }));
    row.appendChild(tile);
  });
  lower.appendChild(row);
}
add(cover, top, lower);
const hidden = JSON.stringify(ARGS.provenance || {});
cover.setSharedPluginData('designlab', 'provenance', hidden);
figma.root.setSharedPluginData('designlab', 'provenance', hidden);
page.setSharedPluginData('designlab', 'version', ARGS.version || '');
return { coverId: cover.id, width: cover.width, height: cover.height };
});
