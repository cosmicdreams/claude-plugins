import { basename, join, resolve, relative as rel, sep } from 'node:path';
import { readText, walk, loadYaml } from './discovery-io.ts';
import { configSync } from './detect.ts';
import { validate } from './contracts.ts';
import { toolVersion } from './figma-receipts.ts';
import type { Components } from './generated/components.ts';
type Entry = Components['components'][number];
type Field = Entry['fields'][number];
type Slot = Entry['slots'][number];
type Defect = Entry['defects'][number];
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
const tokenFamily = (name: string, label: string) =>
  /(padding|margin|spacing|gap)/i.test(name + ' ' + label)
    ? 'spacing'
    : /(background|bg_color|color_scheme|theme|colour)/i.test(name + ' ' + label)
      ? 'color-scheme'
      : /(layout|column|alignment|align|position|width)/i.test(name + ' ' + label)
        ? 'layout'
        : null;
const defaultValue = (d: any) => {
  const x = d?.default_value;
  if (!Array.isArray(x) || !x.length || !x[0] || typeof x[0] !== 'object') return null;
  const keys = Object.keys(x[0]);
  if (keys.length !== 1) return null;
  const v = x[0][keys[0]!];
  return ['string', 'number', 'boolean'].includes(typeof v) ? v : null;
};
const opts = (d: any) => {
  const a = d?.settings?.allowed_values || [],
    out: any[] = [];
  if (Array.isArray(a))
    for (const e of a)
      if (e && typeof e === 'object' && 'value' in e) out.push({ value: e.value, label: String(e.label ?? e.value) });
      else {
      }
  else if (a && typeof a === 'object') for (const [k, v] of Object.entries(a)) out.push({ value: k, label: String(v) });
  return out;
};
function predefined(root: string): Map<string, any[]> {
  const out = new Map<string, any[]>(),
    files = walk(join(root, 'docroot/modules')).filter(
      (p) => p.includes(`${sep}src${sep}Plugin${sep}ListOptions${sep}`) && p.endsWith('.php'),
    );
  for (const p of files) {
    const text = readText(p),
      a = /@ListOptions\s*\(([\s\S]*?)\)\s*\*\//.exec(text),
      id = a && /\bid\s*=\s*["']([^"']+)["']/.exec(a[1]!)?.[1];
    if (!id) continue;
    const method = /function\s+getListOptions\s*\([^)]*\)\s*\{/.exec(text);
    if (!method) continue;
    let i = method.index + method[0].length,
      depth = 1;
    for (; i < text.length && depth; i++) {
      if (text[i] === '{') depth++;
      if (text[i] === '}') depth--;
    }
    const body = text.slice(method.index + method[0].length, i - 1),
      values: any[] = [];
    for (const re of [
      /['"]([^'"]+)['"]\s*=>\s*\$this->t\(\s*['"]([^'"]+)['"]/g,
      /\$options\s*\[\s*['"]([^'"]+)['"]\s*\]\s*=\s*\$this->t\(\s*['"]([^'"]+)['"]/g,
    ])
      for (const m of body.matchAll(re))
        if (!values.some((x) => x.value === m[1])) values.push({ value: m[1], label: m[2] });
    if (values.length) out.set(id, values);
  }
  return out;
}
export function extract(root: string, cfg?: string | null): Components {
  const abs = resolve(root),
    configuration = cfg || configSync(abs);
  if (!configuration) throw new Error(`no Drupal configuration directory found under ${abs}`);
  const files = walk(configuration),
    definitions: any[] = [],
    known = new Set<string>(),
    specs: Array<[string, string, string]> = [
      ['block_content', 'block', 'block_content.type.'],
      ['paragraph', 'paragraph', 'paragraphs.paragraphs_type.'],
    ];
  for (const [entity, kind, prefix] of specs) {
    for (const p of files.filter((x) => basename(x).startsWith(prefix) && x.endsWith('.yml'))) {
      const d = loadYaml(p) || {},
        bundle = d.id || basename(p).slice(prefix.length, -4),
        id = `${kind}:${bundle}`;
      definitions.push({ entity, kind, p, d, bundle, id, prefix });
      known.add(id);
    }
  }
  const plugins = predefined(abs),
    components: Entry[] = [];
  for (const def of definitions) {
    const storagePrefix = `field.storage.${def.entity}.`,
      storage = new Map(
        files
          .filter((x) => basename(x).startsWith(storagePrefix) && x.endsWith('.yml'))
          .map((p) => {
            const d = loadYaml(p) || {},
              n = d.field_name || basename(p).slice(storagePrefix.length, -4);
            return [n, d] as [string, any];
          }),
      ),
      fields: Field[] = [],
      slots: Slot[] = [],
      defects: Defect[] = [];
    for (const p of files.filter(
      (x) => basename(x).startsWith(`field.field.${def.entity}.${def.bundle}.`) && x.endsWith('.yml'),
    )) {
      const instance = loadYaml(p) || {},
        name = instance.field_name,
        type = instance.field_type,
        st = storage.get(name) || {};
      if (!Object.keys(st).length)
        defects.push({
          kind: 'dangling-storage-ref',
          detail: `${name} has no field.storage entity`,
          evidence: rel(abs, p).split(sep).join('/'),
        });
      const handler = instance.settings?.handler_settings || {},
        targetBundles = handler.target_bundles || {},
        targets = Array.isArray(targetBundles) ? [...targetBundles].sort() : Object.keys(targetBundles).sort(),
        targetType = st.settings?.target_type,
        card = st.cardinality ?? 1;
      if (type === 'entity_reference_revisions' && targetType === 'paragraph') {
        const accepts = targets.map((t) => `paragraph:${t}`);
        for (const t of accepts)
          if (!known.has(t))
            defects.push({
              kind: 'dangling-bundle-ref',
              detail: `target bundle ${t} does not exist`,
              evidence: rel(abs, p).split(sep).join('/'),
            });
        slots.push({
          name,
          label: instance.label || name,
          accepts: accepts.length ? accepts : ['*'],
          cardinality: card,
          required: !!instance.required,
          sourceRef: rel(abs, p).split(sep).join('/'),
        });
        continue;
      }
      let kind = KIND[type];
      if (!kind) {
        kind = 'text';
        defects.push({
          kind: 'unmapped-field-type',
          detail: `field type ${type} has no model kind`,
          evidence: rel(abs, p).split(sep).join('/'),
        });
      }
      if (type === 'entity_reference' && ['media', 'file'].includes(targetType)) kind = 'media';
      const pid = st.third_party_settings?.list_predefined_options?.plugin_id,
        options = kind === 'enum' ? (pid ? plugins.get(pid) || null : opts(st)) : null;
      if (kind === 'enum' && !options?.length)
        defects.push({
          kind: pid ? 'predefined-options-plugin-unresolved' : 'enum-without-options',
          detail: pid
            ? `${name} references list options plugin ${pid}, but its static values could not be read`
            : `${name} declares no static allowed_values`,
          evidence: rel(abs, p).split(sep).join('/'),
        });
      const dv = defaultValue(instance);
      fields.push({
        name,
        label: instance.label || name,
        kind,
        required: !!instance.required,
        default: dv,
        defaultSource: dv !== null ? 'declared' : 'unset',
        optionsSource: pid && options?.length ? `list_predefined_options:${pid}` : 'config',
        options,
        showWhen: null,
        tokenFamily: tokenFamily(name || '', instance.label || ''),
        appliesToken: null,
        sourceType: type,
        cardinality: card,
        targetType: targetType ?? null,
        targetBundles: targets.length ? targets : null,
        description: instance.description || null,
        sourceRef: rel(abs, p).split(sep).join('/'),
      });
    }
    components.push({
      id: def.id,
      machineName: def.bundle,
      label: def.d.label || def.bundle,
      description: def.d.description || '',
      group: def.kind === 'block' ? 'Blocks' : 'Paragraphs',
      category: 'Components — Untiered',
      aliases: [],
      sourceRef: rel(abs, def.p).split(sep).join('/'),
      fields,
      slots,
      usage: null,
      defects,
      status: 'status' in def.d ? def.d.status : true,
    });
  }
  const contained = new Map(components.map((c) => [c.id, [] as string[]]));
  for (const c of components)
    for (const s of c.slots)
      for (const t of [s.accepts ?? []].flat()) contained.set(t, [...(contained.get(t) || []), `${c.id}.${s.name}`]);
  for (const c of components) c.containedBy = (contained.get(c.id) || []).sort();
  const document: Components = {
    standardVersion: '3.0.0',
    toolVersion: toolVersion(),
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
    source: {
      strategy: 'drupal-authoring',
      root: abs,
      configDir: rel(abs, configuration).split(sep).join('/'),
    },
    totals: {
      all: components.length,
      blocks: components.filter((c) => c.id.startsWith('block:')).length,
      paragraphs: components.filter((c) => c.id.startsWith('paragraph:')).length,
      withDefects: components.filter((c) => c.defects.length).length,
    },
    components,
    problems: [],
  };
  const errors = validate('components', document);
  if (errors.length) throw new Error('invalid component artifact: ' + errors.join('; '));
  return document;
}
