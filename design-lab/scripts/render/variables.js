/**
 * Create or reconcile the variable collections from variable-plan.json.
 *
 * ARGS = { collections: { <name>: { modes: [..], variables: [{ name, type, hex?, aliasOf?,
 *          valuesByMode?, codeName?, scopes }] } } }
 * Matched by name, so a re-run updates values, scopes and code syntax in place instead of
 * duplicating. Aliases resolve after every variable exists. Variables this plan does not name
 * are reported, not deleted. Code syntax is written only where the source has a code name:
 * an invented one sends a developer looking for something that is not there.
 */
const hex6 = (h) => {
  const s = h.replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6);
  const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
  return { r: parseInt(full.slice(0, 2), 16) / 255, g: parseInt(full.slice(2, 4), 16) / 255, b: parseInt(full.slice(4, 6), 16) / 255, a };
};
const existing = await figma.variables.getLocalVariableCollectionsAsync();
const all = await figma.variables.getLocalVariablesAsync();
const report = { collections: {}, created: 0, updated: 0, unplanned: [], aliasMisses: [] };
const byName = {};

for (const [cname, spec] of Object.entries(ARGS.collections)) {
  let col = existing.find((c) => c.name === cname) || figma.variables.createVariableCollection(cname);
  /* Modes: rename the first, add the rest, in plan order. */
  spec.modes.forEach((m, i) => {
    if (i < col.modes.length) col.renameMode(col.modes[i].modeId, m);
    else col.addMode(m);
  });
  const modeId = Object.fromEntries(col.modes.map((m) => [m.name, m.modeId]));
  const inCol = all.filter((v) => v.variableCollectionId === col.id);
  for (const v of spec.variables) {
    let variable = inCol.find((x) => x.name === v.name);
    if (!variable) { variable = figma.variables.createVariable(v.name, col, v.type); report.created++; }
    else report.updated++;
    variable.scopes = v.scopes || [];
    if (v.codeName) variable.setVariableCodeSyntax('WEB', `var(${v.codeName})`);
    byName[v.name] = { variable, spec: v, modeId };
  }
  const planned = new Set(spec.variables.map((v) => v.name));
  for (const x of inCol) if (!planned.has(x.name)) report.unplanned.push(`${cname}/${x.name}`);
  report.collections[cname] = { id: col.id, modes: col.modes.map((m) => m.name), variables: spec.variables.length };
}

for (const { variable, spec, modeId } of Object.values(byName)) {
  for (const [mode, id] of Object.entries(modeId)) {
    if (spec.aliasOf) {
      const target = byName[spec.aliasOf];
      if (!target) { report.aliasMisses.push(`${spec.name} -> ${spec.aliasOf}`); continue; }
      variable.setValueForMode(id, figma.variables.createVariableAlias(target.variable));
    } else if (spec.type === 'COLOR') {
      const raw = (spec.valuesByMode && spec.valuesByMode[mode]) || spec.hex;
      variable.setValueForMode(id, hex6(raw));
    } else {
      const raw = spec.valuesByMode ? (spec.valuesByMode[mode] ?? Object.values(spec.valuesByMode)[0]) : spec.value;
      variable.setValueForMode(id, spec.type === 'FLOAT' ? Number(raw) : String(raw));
    }
  }
}
return report;
