/**
 * One Foundations page: a 1440-wide panel of specimens, every specimen bound to its variable.
 *
 * ARGS = { pageId, title, intro: [line], sections: [
 *   { kind: 'color', title, note, swatches: [{ variable, label, value, code, alias }] },
 *   { kind: 'type-family', title, note, families: [{ variable, family, code, sample }] },
 *   { kind: 'type-scale', title, note, rows: [{ label, family, weight, size, lineHeight, spec, sample, measured }] },
 *   { kind: 'spacing', title, note, steps: [{ variable, label, value, code }] },
 *   { kind: 'radius', title, note, steps: [{ variable, label, value, code }] },
 *   { kind: 'shadow', title, note, steps: [{ label, css, code, effect }] },
 * ] }
 * Variables are resolved by name. A specimen whose variable is missing is drawn with its
 * literal value and reported, never silently.
 */
await loadKitFonts();
const page = await onPage(ARGS.pageId);
return await atomic(page, [], async () => {
clearTagged(page, 'role', 'foundation');

const vars = await figma.variables.getLocalVariablesAsync();
const byName = Object.fromEntries(vars.map((v) => [v.name, v]));
const missing = [];
const W = KIT.width.page, inner = W - 2 * KIT.space.page;

const root = stack('VERTICAL', { name: ARGS.title, width: W, pad: KIT.space.page, gap: KIT.space.page, fill: KIT.surface.panel, radius: KIT.radius.panel, stroke: KIT.surface.rule });
tag(root, 'role', 'foundation');
page.appendChild(root);
root.x = 0; root.y = 0;

const head = stack('VERTICAL', { name: 'Header', gap: KIT.space.m, width: inner });
add(head, text('Foundations', 'eyebrow', { name: 'Eyebrow' }),
  fillWidth(text(ARGS.title.replace(/^Foundations — /, ''), 'title', { name: 'Title', width: inner })),
  ARGS.intro.map((l, i) => fillWidth(text(l, 'body', { name: `Intro ${i + 1}`, width: inner }))));
root.appendChild(head);

const bindFill = (node, name, hex) => {
  const v = byName[name];
  let p = { type: 'SOLID', color: rgb(hex) };
  if (v) p = figma.variables.setBoundVariableForPaint(p, 'color', v); else missing.push(name);
  node.fills = [p];
};

for (const sec of ARGS.sections) {
  const body = [];
  if (sec.note) body.push(text(sec.note, 'body', { name: 'Note', width: inner }));
  if (sec.kind === 'color') {
    const grid = stack('HORIZONTAL', { name: 'Swatches', gap: KIT.space.l, rowGap: KIT.space.xl, wrap: true, width: inner });
    for (const s of sec.swatches) {
      const card = stack('VERTICAL', { name: s.variable, gap: KIT.space.s, width: 152 });
      const chipNode = figma.createRectangle();
      chipNode.name = 'Swatch';
      chipNode.resize(152, 96);
      chipNode.cornerRadius = KIT.radius.swatch;
      chipNode.strokes = solid(KIT.surface.rule); chipNode.strokeWeight = 1; chipNode.strokeAlign = 'INSIDE';
      bindFill(chipNode, s.variable, s.value);
      add(card, chipNode,
        text(s.label, 'bodyStrong', { name: 'Label', width: 152 }),
        text(s.alias ? `${s.value} · → ${s.alias}` : s.value, 'code', { name: 'Value', width: 152 }),
        text(s.code || 'no code name', 'code', { name: 'Code', width: 152 }));
      grid.appendChild(card);
    }
    body.push(grid);
  } else if (sec.kind === 'type-family') {
    for (const f of sec.families) {
      let family = f.family, style = 'Regular';
      try { await figma.loadFontAsync({ family, style }); } catch (e) { family = KIT.font; missing.push(`font ${f.family}`); }
      const row = stack('VERTICAL', { name: f.variable, gap: KIT.space.s, width: inner, pad: { t: KIT.space.m, r: 0, b: KIT.space.m, l: 0 } });
      const sample = figma.createText();
      sample.fontName = { family, style };
      sample.characters = f.sample;
      sample.fontSize = 40;
      sample.lineHeight = { unit: 'PIXELS', value: 48 };
      sample.fills = solid(KIT.ink.strong);
      sample.name = 'Sample';
      add(row, text(f.variable, 'eyebrow', { name: 'Variable' }), sample,
        text(`${f.family} · ${f.code || 'no code name'}`, 'code', { name: 'Spec' }), rule(inner));
      body.push(row);
    }
  } else if (sec.kind === 'type-scale') {
    for (const r of sec.rows) {
      let family = r.family, style = r.style || 'Regular';
      try { await figma.loadFontAsync({ family, style }); } catch (e) { family = KIT.font; style = 'Regular'; await figma.loadFontAsync({ family, style }); missing.push(`font ${r.family} ${r.style}`); }
      const row = stack('VERTICAL', { name: r.label, gap: KIT.space.s, width: inner, pad: { t: KIT.space.m, r: 0, b: KIT.space.m, l: 0 } });
      const sample = figma.createText();
      sample.fontName = { family, style };
      sample.characters = r.sample;
      sample.fontSize = r.size;
      if (r.lineHeight) sample.lineHeight = { unit: 'PIXELS', value: r.lineHeight };
      sample.fills = solid(KIT.ink.strong);
      sample.name = 'Sample';
      add(row, text(r.label, 'eyebrow', { name: 'Label' }), sample, text(r.spec, 'code', { name: 'Spec' }), rule(inner));
      body.push(row);
    }
  } else if (sec.kind === 'spacing') {
    for (const s of sec.steps) {
      const row = stack('HORIZONTAL', { name: s.variable, gap: KIT.space.l, align: 'CENTER', width: inner });
      const bar = figma.createRectangle();
      bar.name = 'Bar';
      bar.resize(Math.max(1, s.value), 16);
      bar.cornerRadius = 3;
      bar.fills = solid('#6366f1');
      const v = byName[s.variable];
      if (v) bar.setBoundVariable('width', v); else missing.push(s.variable);
      const label = stack('HORIZONTAL', { name: 'Label', width: 240 });
      add(label, text(s.label, 'bodyStrong', { name: 'Name' }));
      add(row, label, text(`${s.value}px`, 'code', { name: 'Value' }), bar, text(s.code || 'no code name', 'code', { name: 'Code' }));
      body.push(row);
    }
  } else if (sec.kind === 'radius' || sec.kind === 'shadow') {
    const grid = stack('HORIZONTAL', { name: 'Specimens', gap: KIT.space.xl, rowGap: KIT.space.xl, wrap: true, width: inner });
    for (const s of sec.steps) {
      const card = stack('VERTICAL', { name: s.variable || s.label, gap: KIT.space.s, width: 152 });
      const box = figma.createRectangle();
      box.name = 'Specimen';
      box.resize(120, 120);
      box.fills = solid(KIT.surface.panel);
      box.strokes = solid(KIT.surface.rule); box.strokeWeight = 1;
      if (sec.kind === 'radius') {
        box.cornerRadius = s.value;
        const v = byName[s.variable];
        if (v) for (const k of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) box.setBoundVariable(k, v);
        else missing.push(s.variable);
      } else if (s.effect) {
        box.effects = [s.effect];
      }
      add(card, box, text(s.label, 'bodyStrong', { name: 'Label', width: 152 }),
        text(sec.kind === 'radius' ? `${s.value}px` : s.css, 'code', { name: 'Value', width: 152 }),
        text(s.code || 'no code name', 'code', { name: 'Code', width: 152 }));
      grid.appendChild(card);
    }
    body.push(grid);
  }
  root.appendChild(section(sec.title, inner, body));
}
return { rootId: root.id, missing };
});
