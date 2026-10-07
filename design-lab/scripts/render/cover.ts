import type { CoverArgs, RoleName, Role } from "../../src/figma/types.ts";
import { DL_API, KIT, ROLES, rgb, solid, loadKitFonts, text, stack, add, fillWidth, chip, rule, table, section, tag, onPage, clearTagged, atomic } from "../../src/figma/types.ts";
export async function template(ARGS: CoverArgs) {
// DESIGN_LAB_TEMPLATE_BEGIN
/**
 * The Cover: one 1440 × 900 poster for the library's recipient, which is also the file thumbnail.
 *
 * ARGS = { pageId, ground, headline, subtitle, total: { value, label },
 *          tiers: [{ key, value, label, color }], provenance: {..}, version }
 * Name-only form, drawn during connect before the build: no `total` and no tiers.
 * It draws the ground and the title block alone, through the same fonts and layout; the build
 * later redraws the full Cover on the same page.
 * Navy ground, 80 of margin, every text in IBM Plex Sans. The site's name and one generic line at
 * the top; at the bottom the number of components, a bar that is that total split into exact
 * shares by category, and one tile per category in the same color. The categories add up to the
 * total. The ground and the category colors come from library_counts.ts (COVER_GROUND and
 * TIER_COLORS), the definition the benchmark report also draws from, so the two cannot drift.
 * Provenance is stored as hidden plugin data on the document and on the cover, for refreshes and
 * the benchmark report; no page draws it.
 */
/* BEGIN bar helpers — pure, tested by tests/test_render_pipeline.ts */
function barWidths(values: number[], width: number) {
  const total = values.reduce((s, v) => s + v, 0);
  if (!total) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * width);
  const widths = exact.map(Math.floor);
  let left = width - widths.reduce((s, w) => s + w, 0);
  exact.map((e, i): [number,number] => [e - widths[i]!, i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { widths[i]! += 1; left -= 1; } });
  return widths;
}
/* END bar helpers */
/* Every text on the Cover is IBM Plex Sans. If the font cannot be loaded (not installed, or not
   available to this Figma account), the Cover keeps the kit font instead, so the build never breaks
   over a typeface. Which one was used is returned, so connect can report it. */
const COVER_ROLES: RoleName[] = ['coverTitle', 'coverSub', 'coverTotal', 'coverUnit', 'coverTileValue', 'coverTileLabel'];
let plexLoaded = false;
try {
  const plex = KIT.coverFont;
  await Promise.all(Object.values(plex.styles).map((style) => DL_API.loadFont({ family: plex.family, style })));
  COVER_ROLES.forEach((role) => { ROLES[role]! = [plex.family, plex.styles[ROLES[role]![1]], ...ROLES[role]!.slice(2)] as Role; });
  plexLoaded = true;
} catch (e) {
  /* keep the kit font */
}
try {
  await loadKitFonts();
} catch (e) {
  throw new Error(`${plexLoaded ? 'the kit font' : 'IBM Plex Sans could not load and the fallback'} failed to load: ${e && (e as Error).message ? (e as Error).message : e}`);
}
const nameOnly = !ARGS.total;
const page = await onPage(ARGS.pageId);
return await atomic(page, [], async () => {
clearTagged(page, 'role', 'cover');

const W = 1440, H = 900, M = KIT.space.page;
const cover = stack('VERTICAL', { name: 'Cover', width: W, height: H, pad: M, fill: ARGS.ground, justify: 'SPACE_BETWEEN' });
tag(cover, 'role', 'cover');
page.appendChild(cover);
cover.x = 0;
cover.y = 0;

const inner = W - 2 * M;
const top = stack('VERTICAL', { name: 'Title', gap: KIT.space.l, width: inner });
add(top,
  fillWidth(text(ARGS.headline, 'coverTitle', { name: 'Headline', width: inner })),
  ARGS.subtitle ? text(ARGS.subtitle, 'coverSub', { name: 'Subtitle' }) : null);

const lower = nameOnly ? null : stack('VERTICAL', { name: 'Library', gap: KIT.space.xl, width: inner });
if (!nameOnly) {
const totalRow = stack('HORIZONTAL', { name: 'Total', gap: KIT.space.l, align: 'BASELINE' });
add(totalRow, text(ARGS.total!.value, 'coverTotal', { name: 'Value' }), text(ARGS.total!.label, 'coverUnit', { name: 'Label' }));
lower!.appendChild(totalRow);

const tiers = ARGS.tiers || [];
const total = tiers.reduce((s, t) => s + Number(t.value), 0);
if (tiers.length && total > 0) {
  /* The bar is the total: its full width is 100%, and each category's segment is its exact share,
     rounded by largest remainder so the widths add up to the bar to the pixel. No gaps, which would
     steal width from the shares; the colors separate the segments. */
  const bar = stack('HORIZONTAL', { name: 'Tier bar', width: inner, height: 16, radius: 8 });
  bar.clipsContent = true;
  barWidths(tiers.map((t) => Number(t.value)), inner).forEach((w, i) => {
    if (w > 0) bar.appendChild(stack('HORIZONTAL', { name: `Tier bar / ${tiers[i]!.key}`, width: w, height: 16, fill: tiers[i]!.color }));
  });
  lower!.appendChild(bar);
}
if (tiers.length) {
  const gap = KIT.space.l;
  const tileW = Math.floor((inner - gap * (tiers.length - 1)) / tiers.length);
  const row = stack('HORIZONTAL', { name: 'Tiers', gap, width: inner });
  tiers.forEach((t) => {
    /* Each tile wears its segment's color on its top edge, so the bar reads without a legend. */
    const tile = stack('VERTICAL', { name: `Tier / ${t.key}`, gap: KIT.space.s, width: tileW, pad: { t: KIT.space.m, r: 0, b: 0, l: 0 } });
    tile.strokes = solid(t.color);
    tile.strokeTopWeight = 4; tile.strokeRightWeight = 0; tile.strokeBottomWeight = 0; tile.strokeLeftWeight = 0;
    add(tile, text(t.value, 'coverTileValue', { name: 'Value' }), text(t.label, 'coverTileLabel', { name: 'Label', width: tileW }));
    row.appendChild(tile);
  });
  lower!.appendChild(row);
}
}
add(cover, top, lower);
const hidden = JSON.stringify(ARGS.provenance || {});
cover.setSharedPluginData('designlab', 'provenance', hidden);
figma.root.setSharedPluginData('designlab', 'provenance', hidden);
page.setSharedPluginData('designlab', 'version', ARGS.version || '');
return { coverId: cover.id, pageId: page.id, width: cover.width, height: cover.height, nameOnly,
  font: plexLoaded ? KIT.coverFont.family : KIT.font, fontLoaded: plexLoaded,
  pluginData: figma.root.getSharedPluginData('designlab', 'provenance') === hidden };
});

// DESIGN_LAB_TEMPLATE_END
}
