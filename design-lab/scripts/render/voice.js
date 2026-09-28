/**
 * Foundations — Brand Voice & Language. Every statement on this page is measured from the
 * site's published copy; nothing is taken from a brand document and nothing is invented.
 *
 * ARGS = { pageId, lede, positioning: { line, supporting: [..], attribution } | null,
 *   stats: [{ value, label, qualifier }],
 *   sections: [{ title, rows: [{ kind: 'OBSERVED'|'WATCH', rule, evidence }] }],
 *   vocabulary: [{ phrase, count }], mechanics: [[rule, asPublished, notes]],
 *   inconsistencies: [line] }
 * Layout follows the Mass Save and Isaacson, Miller pages: corpus lede, positioning band,
 * evidence tiles, observed and watch rows per section, vocabulary chips, a mechanics table,
 * then published inconsistencies on their own panel so they never read as guidance.
 */
await loadKitFonts();
const page = await onPage(ARGS.pageId);
return await atomic(page, [], async () => {
clearTagged(page, 'role', 'foundation');

const W = KIT.width.page, inner = W - 2 * KIT.space.page;
const root = stack('VERTICAL', { name: 'Foundations · Brand Voice & Language', width: W, pad: KIT.space.page, gap: KIT.space.xxl + KIT.space.m, fill: KIT.surface.panel, radius: KIT.radius.panel, stroke: KIT.surface.rule });
tag(root, 'role', 'foundation');
page.appendChild(root);
root.x = 0; root.y = 0;

const head = stack('VERTICAL', { name: 'Header', gap: KIT.space.m, width: inner });
add(head, text('Foundations', 'eyebrow', { name: 'Eyebrow' }),
  fillWidth(text('Brand Voice & Language', 'title', { name: 'Title', width: inner })),
  fillWidth(text(ARGS.lede, 'body', { name: 'Lede', width: 960 })));
root.appendChild(head);

if (ARGS.positioning) {
  const band = stack('VERTICAL', { name: 'Positioning band', width: inner, pad: { t: 56, r: 64, b: 56, l: 64 }, gap: KIT.space.l, fill: KIT.surface.dark, radius: KIT.radius.panel });
  add(band, text(ARGS.positioning.line, 'bandLine', { name: 'Hero line', width: inner - 128 }),
    ARGS.positioning.supporting.length ? text(ARGS.positioning.supporting.map((l) => `“${l}”`).join('  ·  '), 'bandNote', { name: 'Supporting lines', width: inner - 128 }) : null,
    text(ARGS.positioning.attribution, 'eyebrowDk', { name: 'Attribution' }));
  root.appendChild(band);
}

if (ARGS.stats.length) {
  const tiles = stack('HORIZONTAL', { name: 'Evidence stats', gap: KIT.space.l, width: inner });
  const tw = Math.floor((inner - KIT.space.l * (ARGS.stats.length - 1)) / ARGS.stats.length);
  for (const s of ARGS.stats) {
    const t = stack('VERTICAL', { name: `Stat · ${s.label}`, width: tw, pad: KIT.space.l, gap: KIT.space.xs, fill: KIT.surface.sunken, radius: 8 });
    add(t, text(s.value, 'stat', { name: 'Value' }), text(s.label, 'bodyStrong', { name: 'Label', width: tw - 48 }),
      s.qualifier ? text(s.qualifier, 'small', { name: 'Qualifier', width: tw - 48 }) : null);
    tiles.appendChild(t);
  }
  root.appendChild(tiles);
}

const KIND_W = 112, RULE_W = 600, EV_W = inner - KIND_W - RULE_W;
for (const sec of ARGS.sections) {
  if (!sec.rows.length) continue;
  const rows = sec.rows.map((r, i) => {
    const row = stack('HORIZONTAL', { name: `Row ${i + 1}`, width: inner, pad: { t: 14, r: 0, b: 14, l: 0 } });
    row.strokes = solid(KIT.surface.rule); row.strokeTopWeight = 1; row.strokeBottomWeight = 0; row.strokeLeftWeight = 0; row.strokeRightWeight = 0; row.strokeAlign = 'INSIDE';
    const k = stack('HORIZONTAL', { name: 'Kind', width: KIND_W });
    add(k, text(r.kind, r.kind === 'WATCH' ? 'watch' : 'observed', { name: 'Kind' }));
    const ru = stack('HORIZONTAL', { name: 'Rule', width: RULE_W, pad: { t: 0, r: KIT.space.l, b: 0, l: 0 } });
    add(ru, text(r.rule, 'body', { name: 'Rule', width: RULE_W - KIT.space.l }));
    const ev = stack('HORIZONTAL', { name: 'Evidence', width: EV_W });
    add(ev, text(r.evidence, 'quote', { name: 'Evidence', width: EV_W }));
    return add(row, k, ru, ev);
  });
  root.appendChild(section(sec.title, inner, rows));
}

if (ARGS.vocabulary.length) {
  const chips = stack('HORIZONTAL', { name: 'Phrases', gap: KIT.space.s, rowGap: KIT.space.s, wrap: true, width: inner });
  add(chips, ARGS.vocabulary.map((v) => chip(`${v.phrase} · ${v.count}`)));
  root.appendChild(section('Vocabulary the site returns to', inner,
    text('Phrases that recur in body copy across the site, with the number of pages that use them.', 'small', { name: 'Note', width: inner }), chips));
}

if (ARGS.mechanics.length) {
  root.appendChild(section('Mechanics', inner, table(
    [{ title: 'Rule', width: 240 }, { title: 'As published', width: inner - 240 - 360 }, { title: 'Notes', width: 360 }],
    ARGS.mechanics, { name: 'Mechanics' })));
}

if (ARGS.inconsistencies.length) {
  const panel = stack('VERTICAL', { name: 'Inconsistencies', width: inner, pad: KIT.space.l, gap: KIT.space.s, fill: KIT.surface.defect, radius: 8 });
  add(panel, ARGS.inconsistencies.map((l, i) => text(`•  ${l}`, 'defect', { name: `Inconsistency ${i + 1}`, width: inner - 48 })));
  root.appendChild(section('Inconsistencies found in published copy', inner,
    text('Recorded as content defects, not as guidance.', 'small', { name: 'Note', width: inner }), panel));
}
return { rootId: root.id, height: root.height };
});
