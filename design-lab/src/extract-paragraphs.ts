import { basename, resolve, relative as rel } from 'node:path';
import { loadYaml, walk } from './discovery-io.ts';
import { configSync } from './detect.ts';
import { toolVersion } from './figma-receipts.ts';
import type { Components } from './generated/components.ts';
import type { JsonValue } from './generated/components.ts';
type Entry = Components['components'][number];
type Field = Entry['fields'][number];
type Slot = Entry['slots'][number];
type Defect = Entry['defects'][number];
type Problem = NonNullable<Components['problems']>[number];
type DrupalYaml = {
  [key: string]: unknown;
  id?: string;
  field_name?: string;
  field_type?: string;
  label?: string;
  description?: string;
  status?: string | null;
  required?: boolean;
  cardinality?: number | null;
  default_value?: Array<Record<string, unknown>>;
  settings?: { allowed_values?: unknown; handler_settings?: { target_bundles?: unknown }; target_type?: string };
};
const KIND: Record<string, string> = {
  string: 'text',
  string_long: 'text',
  email: 'text',
  telephone: 'text',
  smartdate: 'text',
  list_string: 'enum',
  text: 'richtext',
  text_long: 'richtext',
  text_with_summary: 'richtext',
  boolean: 'boolean',
  integer: 'number',
  decimal: 'number',
  float: 'number',
  link: 'reference',
  image: 'media',
  file: 'media',
  entity_reference: 'reference',
  entity_reference_revisions: 'reference',
  color_field_type: 'color',
  viewsreference: 'reference',
  block_field: 'reference',
};
function defaultValue(d: DrupalYaml): JsonValue | null {
  const a = d?.default_value;
  if (!Array.isArray(a) || !a.length || !a[0] || typeof a[0] !== 'object') return null;
  const keys = Object.keys(a[0]);
  if (keys.length !== 1) return null;
  const x = a[0][keys[0]!];
  return ['string', 'number', 'boolean'].includes(typeof x) ? (x as JsonValue) : null;
}
function options(d: DrupalYaml): Array<{ value: JsonValue; label: string }> {
  const a = d?.settings?.allowed_values || [],
    out: Array<{ value: JsonValue; label: string }> = [];
  if (Array.isArray(a)) {
    for (const x of a)
      if (x && typeof x === 'object' && 'value' in x)
        out.push({ value: x.value as JsonValue, label: String(x.label ?? x.value) });
  } else if (a && typeof a === 'object')
    for (const [k, v] of Object.entries(a)) out.push({ value: k, label: String(v) });
  return out;
}
function family(name: string, label: string): string | null {
  return /(padding|margin|spacing|gap)/i.test(name + ' ' + label)
    ? 'spacing'
    : /(background|bg_color|color_scheme|theme|colour)/i.test(name + ' ' + label)
      ? 'color-scheme'
      : /(layout|column|alignment|align|position|width)/i.test(name + ' ' + label)
        ? 'layout'
        : null;
}
export function extract(root: string, cfg?: string | null): Components {
  const abs = resolve(root),
    configuration = cfg || configSync(abs);
  if (!configuration) throw new Error(`no configuration directory found under ${abs}`);
  const files = walk(configuration),
    types = files.filter((p) => basename(p).startsWith('paragraphs.paragraphs_type.') && p.endsWith('.yml')).sort(),
    known = new Set(types.map((p) => basename(p).slice('paragraphs.paragraphs_type.'.length, -4))),
    storage = new Map(
      files
        .filter((p) => basename(p).startsWith('field.storage.paragraph.') && p.endsWith('.yml'))
        .map((p) => {
          const d = (loadYaml(p) || {}) as DrupalYaml;
          return [d.field_name || basename(p).slice('field.storage.paragraph.'.length, -4), d] as [string, DrupalYaml];
        }),
    ),
    components: Entry[] = [],
    problems: Problem[] = [];
  for (const tpath of types) {
    let t: DrupalYaml;
    try {
      t = (loadYaml(tpath) || {}) as DrupalYaml;
    } catch (e) {
      problems.push({
        kind: 'unparseable',
        ref: rel(abs, tpath),
        detail: String(e).slice(0, 300),
      });
      continue;
    }
    const bundle = t.id || basename(tpath).slice('paragraphs.paragraphs_type.'.length, -4),
      fields: Field[] = [],
      slots: Slot[] = [],
      defects: Defect[] = [];
    const fieldFiles = files
      .filter((p) => basename(p).startsWith(`field.field.paragraph.${bundle}.`) && p.endsWith('.yml'))
      .sort();
    for (const p of fieldFiles) {
      let d: DrupalYaml;
      try {
        d = (loadYaml(p) || {}) as DrupalYaml;
      } catch (e) {
        defects.push({
          kind: 'unparseable-field',
          detail: String(e).slice(0, 200),
          evidence: rel(abs, p),
        });
        continue;
      }
      const name = d.field_name as string,
        type = d.field_type,
        st = storage.get(name);
      if (!st)
        defects.push({
          kind: 'dangling-storage-ref',
          detail: `field instance ${name} has no field.storage entity`,
          evidence: rel(abs, p),
        });
      const sd = st || {},
        card = sd.cardinality ?? null,
        settings = d.settings || {},
        targets = settings.handler_settings?.target_bundles || {},
        targetList = (Array.isArray(targets) ? [...targets] : Object.keys(targets)).sort(),
        targetType = sd.settings?.target_type;
      if (type === 'entity_reference_revisions' && targetType === 'paragraph') {
        for (const target of targetList)
          if (!known.has(target))
            defects.push({
              kind: 'dangling-bundle-ref',
              detail: `target bundle ${target} does not exist`,
              evidence: rel(abs, p),
            });
        slots.push({
          name,
          label: d.label || name,
          accepts: targetList.length ? targetList : ['*'],
          cardinality: card,
          required: !!d.required,
          sourceRef: rel(abs, p),
        });
        continue;
      }
      let kind = KIND[type ?? ''];
      if (!kind) {
        defects.push({
          kind: 'unmapped-field-type',
          detail: `field type ${type} has no model kind`,
          evidence: rel(abs, p),
        });
        kind = 'text';
      }
      let opts = kind === 'enum' ? options(sd) : null;
      if (type === 'entity_reference' && ['media', 'file'].includes(targetType ?? '')) kind = 'media';
      if (kind === 'enum' && !opts?.length)
        defects.push({
          kind: 'enum-without-options',
          detail: `list_string ${name} declares no allowed_values`,
          evidence: rel(abs, p),
        });
      fields.push({
        name,
        label: d.label || name,
        kind,
        sourceWidget: type ?? null,
        required: !!d.required,
        default: defaultValue(d),
        options: opts,
        showWhen: null,
        tokenFamily: family(name || '', d.label || ''),
        cardinality: card,
        targetType: targetType ?? null,
        targetBundles: targetList.length ? targetList : null,
        description: d.description || null,
        sourceRef: rel(abs, p),
        uid: name,
      });
    }
    const structural = slots.length > 0;
    components.push({
      id: bundle,
      label: t.label || bundle,
      description: t.description || null,
      group: structural ? 'layout' : 'content',
      groupEvidence: structural
        ? `owns entity_reference_revisions slot(s): ${slots.map((s) => s.name).join(', ')}`
        : 'no paragraph-targeting reference field',
      sourceRef: rel(abs, tpath),
      fields,
      slots,
      usage: null,
      defects,
      status: t.status ?? null,
    });
  }
  const contained = new Map(components.map((c) => [c.id, [] as string[]]));
  for (const c of components)
    for (const s of c.slots)
      for (const t of [s.accepts ?? []].flat()) contained.set(t, [...(contained.get(t) || []), `${c.id}.${s.name}`]);
  const entryPoints: NonNullable<Components['entryPoints']> = [];
  for (const p of files.filter((x) => basename(x).startsWith('field.field.') && x.endsWith('.yml')).sort()) {
    const parts = basename(p).slice('field.field.'.length, -4).split('.');
    if (parts.length !== 3 || parts[0] === 'paragraph') continue;
    let d: DrupalYaml;
    try {
      d = (loadYaml(p) || {}) as DrupalYaml;
    } catch {
      continue;
    }
    if (d.field_type !== 'entity_reference_revisions') continue;
    const name = d.field_name as string,
      st = storage.get(name) || {},
      targetType = st.settings?.target_type;
    if (targetType !== 'paragraph') continue;
    const targets = d.settings?.handler_settings?.target_bundles || {},
      accepts = (Array.isArray(targets) ? [...targets] : Object.keys(targets)).sort();
    entryPoints.push({
      hostEntityType: parts[0]!,
      hostBundle: parts[1]!,
      field: name,
      label: d.label || name,
      accepts: accepts.length ? accepts : ['*'],
      sourceRef: rel(abs, p),
    });
    for (const t of accepts)
      if (contained.has(t)) contained.set(t, [...contained.get(t)!, `${parts[0]}:${parts[1]}.${name}`]);
  }
  for (const c of components) {
    c.containedBy = (contained.get(c.id) || []).sort();
    c.isEntryPoint = entryPoints.some((e) => e.accepts.includes(c.id));
  }
  return {
    entryPoints,
    standardVersion: '3.0.0',
    toolVersion: toolVersion(),
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ''),
    source: {
      strategy: 'paragraphs',
      root: abs,
      configDir: rel(abs, configuration),
      parser: 'pyyaml',
    },
    totals: {
      all: components.length,
      layout: components.filter((c) => c.group === 'layout').length,
      content: components.filter((c) => c.group === 'content').length,
      withDefects: components.filter((c) => c.defects.length).length,
    },
    components,
    problems,
  };
}
