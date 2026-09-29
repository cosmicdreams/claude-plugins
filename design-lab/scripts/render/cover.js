/**
 * The Cover: one 1440 × 900 poster for the library's recipient, which is also the file thumbnail.
 *
 * ARGS = { pageId, headline, subtitle, total: { value, label },
 *          tiers: [{ key, value, label }], provenance: {..}, version }
 * Dark neutral ground, 80 of margin. The site's name and one generic line at the top; at the
 * bottom the number of components, a bar that is that total split into exact shares by category,
 * and one tile per category in the same color. The categories add up to the total. Provenance is
 * stored as hidden plugin data on the document and on the cover, for refreshes and the benchmark
 * report; no page draws it.
 */
/* BEGIN bar helpers — pure, tested by tests/test_render_pipeline.py */
/* A fixed palette, the same on every run and never the site's brand: four distinct hues of similar
   weight from the Okabe-Ito set, which stays distinguishable under the common color-vision
   deficiencies, so every segment is seen and none reads as empty. Vermilion is reserved for
   retirement candidates, should the Cover ever show them: it reads as a recommendation to remove. */
const TIER_COLORS = { 'High Use': '#E69F00', 'Medium Use': '#56B4E9', 'Low Use': '#009E73', 'Other': '#CC79A7',
  'Retirement Candidates': '#D55E00' };
function tierColor(key) { return TIER_COLORS[key] || TIER_COLORS.Other; }
function barWidths(values, width) {
  const total = values.reduce((s, v) => s + v, 0);
  if (!total) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * width);
  const widths = exact.map(Math.floor);
  let left = width - widths.reduce((s, w) => s + w, 0);
  exact.map((e, i) => [e - widths[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { widths[i] += 1; left -= 1; } });
  return widths;
}
/* END bar helpers */
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
const totalRow = stack('HORIZONTAL', { name: 'Total', gap: KIT.space.m, align: 'BASELINE' });
add(totalRow, text(ARGS.total.value, 'coverTotal', { name: 'Value' }), text(ARGS.total.label, 'coverUnit', { name: 'Label' }));
lower.appendChild(totalRow);

const tiers = ARGS.tiers || [];
const total = tiers.reduce((s, t) => s + Number(t.value), 0);
if (tiers.length && total > 0) {
  /* The bar is the total: its full width is 100%, and each category's segment is its exact share,
     rounded by largest remainder so the widths add up to the bar to the pixel. No gaps, which would
     steal width from the shares; the colors separate the segments. */
  const bar = stack('HORIZONTAL', { name: 'Tier bar', width: inner, height: 16, radius: 8 });
  bar.clipsContent = true;
  barWidths(tiers.map((t) => Number(t.value)), inner).forEach((w, i) => {
    if (w > 0) bar.appendChild(stack('HORIZONTAL', { name: `Tier bar / ${tiers[i].key}`, width: w, height: 16, fill: tierColor(tiers[i].key) }));
  });
  lower.appendChild(bar);
}
if (tiers.length) {
  const gap = KIT.space.l;
  const tileW = Math.floor((inner - gap * (tiers.length - 1)) / tiers.length);
  const row = stack('HORIZONTAL', { name: 'Tiers', gap, width: inner });
  tiers.forEach((t) => {
    /* Each tile wears its segment's color on its top edge, so the bar reads without a legend. */
    const tile = stack('VERTICAL', { name: `Tier / ${t.key}`, gap: KIT.space.s, width: tileW, pad: { t: KIT.space.m, r: 0, b: 0, l: 0 } });
    tile.strokes = solid(tierColor(t.key));
    tile.strokeTopWeight = 4; tile.strokeRightWeight = 0; tile.strokeBottomWeight = 0; tile.strokeLeftWeight = 0;
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
