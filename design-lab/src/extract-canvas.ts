import { join, resolve, relative as rel, sep } from 'node:path';
import { configSync, docroot } from './detect.ts';
import { load, extract as extractSdc, KIND } from './extract-sdc.ts';
import type { Entry } from './extract-sdc.ts';
import type { Components } from './generated/components.ts';
import type { JsonValue } from './generated/components.ts';
type Problem = NonNullable<Components['problems']>[number];
type CanvasYaml = {
  configEntityTypeId?: string;
  name?: string;
  items?: string[];
  source_local_id?: string;
  id?: string;
  label?: string;
  active_version?: string;
  versioned_properties?: { active?: { settings?: { prop_field_definitions?: Record<string, unknown> } } };
};
type CanvasProperty = { field_type?: string; required?: boolean; field_widget?: string; default_value?: unknown };
import { validate } from './contracts.ts';
export function extract(root: string): Components {
  const abs = resolve(root),
    web = docroot(abs),
    cfg = configSync(abs);
  if (!cfg) throw new Error('Canvas configuration directory not found');
  const raw = extractSdc(abs),
    byName = new Map(raw.components.map((c) => [c.id, c])),
    folders = new Map<string, [string, string]>();
  const fs = awaitImportFs();
  for (const n of fs
    .readdirSync(cfg)
    .filter((n: string) => n.startsWith('canvas.folder.') && n.endsWith('.yml'))
    .sort()) {
    const p = join(cfg, n),
      d = load(p) as CanvasYaml;
    if (d.configEntityTypeId !== 'component') continue;
    for (const item of d.items || [])
      if (!folders.has(item)) folders.set(item, [d.name as string, rel(abs, p).split(sep).join('/')]);
  }
  const components: Entry[] = [],
    problems: Problem[] = [...(raw.problems ?? [])];
  for (const n of fs
    .readdirSync(cfg)
    .filter((n: string) => n.startsWith('canvas.component.sdc.') && n.endsWith('.yml'))
    .sort()) {
    const p = join(cfg, n),
      d = load(p) as CanvasYaml,
      sourceId = d.source_local_id || '',
      sepAt = sourceId.indexOf(':'),
      provider = sepAt < 0 ? '' : sourceId.slice(0, sepAt),
      machine = sepAt < 0 ? '' : sourceId.slice(sepAt + 1);
    if (!provider || !isDir(join(web, 'themes/custom', provider))) continue;
    const base = byName.get(machine);
    if (!base) {
      problems.push({
        kind: 'missing-source-sdc',
        detail: sourceId,
        sourceRef: rel(abs, p).split(sep).join('/'),
      });
      continue;
    }
    const c = structuredClone(base),
      configRef = rel(abs, p).split(sep).join('/');
    Object.assign(c, {
      id: d.id || `sdc.${provider}.${machine}`,
      machineName: machine,
      sourceSdcId: sourceId,
      label: d.label || c.label,
      componentVersion: d.active_version,
      canvasRef: configRef,
    });
    const folder = folders.get(c.id);
    if (folder)
      Object.assign(c, {
        group: folder[0],
        folder: folder[0],
        folderRef: folder[1],
      });
    c.provenance = {
      definition: c.sourceRef,
      label: d.label ? configRef : c.sourceRef,
      componentVersion: configRef,
      group: folder ? folder[1] : c.sourceRef,
    };
    const defs = d.versioned_properties?.active?.settings?.prop_field_definitions || {},
      fields = new Map(c.fields.map((f) => [f.name, f]));
    for (const [name, rawSpec] of Object.entries(defs)) {
      const spec = rawSpec as CanvasProperty;
      if (!spec || typeof spec !== 'object') continue;
      let f = fields.get(name);
      if (!f) {
        f = {
          name,
          label: name,
          kind: 'text',
          sourceWidget: null,
          required: false,
          default: null,
          options: null,
          showWhen: null,
          tokenFamily: null,
          uid: name,
        };
        c.fields.push(f);
        fields.set(name, f);
      }
      const type = spec.field_type;
      if (type) {
        f.kind = type.startsWith('list_')
          ? 'enum'
          : type.startsWith('entity_reference')
            ? 'reference'
            : KIND[type] || f.kind || 'text';
        f.canvasFieldType = type;
      }
      f.required = !!spec.required;
      f.sourceWidget = spec.field_widget || f.sourceWidget || null;
      let value = spec.default_value;
      if (Array.isArray(value) && value.length === 1 && value[0] && typeof value[0] === 'object')
        value = value[0].value ?? value[0];
      f.default =
        value === undefined || JSON.stringify(value) === '{}' || JSON.stringify(value) === '[]'
          ? null
          : (value as JsonValue);
      f.provenance = {
        label: c.sourceRef,
        options: c.sourceRef,
        kind: type ? configRef : c.sourceRef,
        required: configRef,
        default: configRef,
        sourceWidget: configRef,
      };
    }
    for (const f of c.fields)
      f.provenance ??= Object.fromEntries(
        ['label', 'options', 'kind', 'required', 'default', 'sourceWidget'].map((k) => [k, c.sourceRef]),
      );
    components.push(c);
  }
  const document: Components = {
    standardVersion: raw.standardVersion,
    toolVersion: raw.toolVersion,
    generatedAt: raw.generatedAt,
    source: {
      strategy: 'canvas',
      root: abs,
      config: cfg,
      ...(raw.source.parser !== undefined ? { sdcParser: raw.source.parser } : {}),
    },
    components,
    problems,
  };
  const errors = validate('components', document);
  if (errors.length) throw new Error('invalid Canvas inventory: ' + errors.join('; '));
  return document;
}
import { readdirSync, statSync } from 'node:fs';
function awaitImportFs() {
  return { readdirSync };
}
function isDir(p: string) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
