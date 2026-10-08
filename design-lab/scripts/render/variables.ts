import type { VariablesArgs } from '../../src/figma/types.ts';
import { DL_API } from '../../src/figma/types.ts';
export async function template(ARGS: VariablesArgs) {
  // DESIGN_LAB_TEMPLATE_BEGIN
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
  const hex6 = (h: string) => {
    // Custom properties may hold rgb()/rgba() rather than hex, e.g. a translucent border.
    const rgb = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(h.trim());
    if (rgb) {
      const unit = (c: string) => Math.min(1, c.endsWith('%') ? parseFloat(c) / 100 : parseFloat(c) / 255);
      const alpha = rgb[4]! === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
      return { r: unit(rgb[1]!), g: unit(rgb[2]!), b: unit(rgb[3]!), a: alpha };
    }
    const s = h.replace('#', '');
    const full =
      s.length === 3
        ? s
            .split('')
            .map((c) => c + c)
            .join('')
        : s.slice(0, 6);
    const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
    return {
      r: parseInt(full.slice(0, 2), 16) / 255,
      g: parseInt(full.slice(2, 4), 16) / 255,
      b: parseInt(full.slice(4, 6), 16) / 255,
      a,
    };
  };
  const existing = await DL_API.collections();
  const all = await DL_API.variables();
  const report: {
    collections: Record<string, { id: string; modes: string[]; variables: number }>;
    created: number;
    updated: number;
    unplanned: string[];
    aliasMisses: string[];
  } = { collections: {}, created: 0, updated: 0, unplanned: [], aliasMisses: [] };
  /* Keyed by collection and name: one name may exist in two collections, and neither copy may
   overwrite the other. Aliases resolve by name to the first collection that declares it. */
  const entries: {
    variable: Variable;
    spec: VariablesArgs['collections'][string]['variables'][number];
    modeId: Record<string, string>;
  }[] = [];
  const byName: Record<string, (typeof entries)[number]> = {};

  for (const [cname, spec] of Object.entries(ARGS.collections)) {
    let col = existing.find((c) => c.name === cname);
    if (!col) {
      col = DL_API.createCollection(cname);
      /* Only a collection this step created is marked: a same-named one someone made stays theirs. */
      col.setSharedPluginData('designlab', 'collection', cname);
    }
    /* Modes: rename the first, add the rest, in plan order. */
    spec.modes.forEach((m, i) => {
      if (i < col.modes.length) col.renameMode(col.modes[i]!.modeId, m);
      else col.addMode(m);
    });
    const modeId = Object.fromEntries(col.modes.map((m) => [m.name, m.modeId]));
    const inCol = all.filter((v) => v.variableCollectionId === col.id);
    for (const v of spec.variables) {
      let variable = inCol.find((x) => x.name === v.name);
      if (!variable) {
        variable = DL_API.createVariable(v.name, col, v.type);
        report.created++;
      } else report.updated++;
      variable.scopes = v.scopes || [];
      if (v.codeName) variable.setVariableCodeSyntax('WEB', `var(${v.codeName})`);
      const entry = { variable, spec: v, modeId };
      entries.push(entry);
      if (!byName[v.name]!) byName[v.name] = entry;
    }
    const planned = new Set(spec.variables.map((v) => v.name));
    for (const x of inCol) if (!planned.has(x.name)) report.unplanned.push(`${cname}/${x.name}`);
    report.collections[cname] = { id: col.id, modes: col.modes.map((m) => m.name), variables: spec.variables.length };
  }

  for (const { variable, spec, modeId } of entries) {
    for (const [mode, id] of Object.entries(modeId)) {
      if (spec.aliasOf) {
        const target = byName[spec.aliasOf]!;
        if (!target) {
          report.aliasMisses.push(`${spec.name} -> ${spec.aliasOf}`);
          continue;
        }
        variable.setValueForMode(id, figma.variables.createVariableAlias(target.variable));
      } else if (spec.type === 'COLOR') {
        const raw = (spec.valuesByMode && spec.valuesByMode[mode]) || spec.hex;
        variable.setValueForMode(id, hex6(raw as string));
      } else {
        const raw = spec.valuesByMode ? (spec.valuesByMode[mode] ?? Object.values(spec.valuesByMode)[0]) : spec.value;
        variable.setValueForMode(id, spec.type === 'FLOAT' ? Number(raw) : String(raw));
      }
    }
  }
  return report;

  // DESIGN_LAB_TEMPLATE_END
}
