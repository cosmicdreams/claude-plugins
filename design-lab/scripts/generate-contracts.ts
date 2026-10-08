#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pluginRoot, sharedRequire } from '../src/runtime.ts';
type JSONSchema = Record<string, unknown>;
interface CompilerOptions {
  bannerComment: string;
  unknownAny: boolean;
  additionalProperties: boolean;
  $refOptions: {
    resolve: {
      localSchemas: { order: number; canRead: RegExp; read: (file: { url: string }) => JSONSchema };
      http: false;
    };
  };
}
// The pinned ref-parser declaration's DeepPartial default violates exact optional types.
// This typed CommonJS boundary describes only the compiler API we use, without importing
// that dependency's broken declarations or weakening skipLibCheck for the project.
const { compile } = sharedRequire()('json-schema-to-typescript') as {
  compile: (schema: JSONSchema, name: string, options: CompilerOptions) => Promise<string>;
};
const folder = resolve(pluginRoot, 'schemas');
const names = readdirSync(folder)
  .filter((n) => n.endsWith('.schema.json'))
  .sort();
const schemas = Object.fromEntries(
  names.map((name) => [
    name.replace('.schema.json', ''),
    JSON.parse(readFileSync(resolve(folder, name), 'utf8')) as JSONSchema,
  ]),
);
const typeName = (name: string) =>
  name
    .split('-')
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join('');
const isSchema = (value: unknown): value is JSONSchema =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
/** Required-only union fragments constrain their enclosing record. Give the generator
 * the referenced field types so it emits that constraint instead of an open unknown map.
 * Ajv still reads the original schemas; this only makes the derived types faithful. */
function compilerSchema(schema: JSONSchema): JSONSchema {
  const copy = structuredClone(schema);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isSchema(value)) return;
    const properties = value['properties'];
    if (isSchema(properties))
      for (const keyword of ['anyOf', 'oneOf']) {
        const variants = value[keyword];
        if (!Array.isArray(variants)) continue;
        for (const variant of variants)
          if (isSchema(variant) && Object.keys(variant).length === 1 && Array.isArray(variant['required'])) {
            const names = variant['required'].filter((name): name is string => typeof name === 'string');
            variant['type'] = 'object';
            variant['properties'] = Object.fromEntries(names.map((name) => [name, structuredClone(properties[name])]));
            variant['additionalProperties'] = false;
          }
      }
    for (const child of Object.values(value)) visit(child);
  };
  visit(copy);
  return copy;
}
// Compile separately to avoid duplicate nested type names across artifacts.
for (const [name, schema] of Object.entries(schemas)) {
  const content = await compile({ ...compilerSchema(schema), title: typeName(name) }, typeName(name), {
    bannerComment: '// Generated from schemas/' + name + '.schema.json. Do not edit.',
    unknownAny: true,
    // Constraint-only anyOf fragments must not reintroduce an open index signature.
    additionalProperties: false,
    $refOptions: {
      resolve: {
        localSchemas: {
          order: 1,
          canRead: /^https:\/\/design-lab.local\/schemas\//,
          read: (file: { url: string }) =>
            compilerSchema(schemas[file.url.split('/').at(-1)!.replace('.schema.json', '')]!),
        },
        http: false,
      },
    },
  });
  const target = resolve(pluginRoot, 'src/generated', name + '.ts');
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== content) throw new Error(`stale generated contract: ${target}`);
  } else writeFileSync(target, content);
}
const map =
  '// Generated from schemas. Do not edit.\n' +
  Object.keys(schemas)
    .map((name) => `import type { ${typeName(name)} } from './${name}.ts';`)
    .join('\n') +
  '\nexport interface ArtifactMap {\n' +
  Object.keys(schemas)
    .map((name) => `  '${name}': ${typeName(name)};`)
    .join('\n') +
  '\n}\n';
const target = resolve(pluginRoot, 'src/generated/artifacts.ts');
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== map) throw new Error('stale ArtifactMap');
} else writeFileSync(target, map);
