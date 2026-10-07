#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pluginRoot, sharedRequire } from '../src/runtime.ts';
import type { JSONSchema } from 'json-schema-to-typescript';
const { compile } = sharedRequire()('json-schema-to-typescript') as typeof import('json-schema-to-typescript');
const folder = resolve(pluginRoot, 'schemas');
const names = readdirSync(folder).filter(n => n.endsWith('.schema.json')).sort();
const schemas = Object.fromEntries(names.map(name => [name.replace('.schema.json', ''), JSON.parse(readFileSync(resolve(folder, name), 'utf8')) as JSONSchema]));
const typeName = (name: string) => name.split('-').map(s => s[0]!.toUpperCase() + s.slice(1)).join('');
// Compile separately to avoid duplicate nested type names across artifacts.
for (const [name, schema] of Object.entries(schemas)) {
  const content = await compile({ ...structuredClone(schema), title: typeName(name) }, typeName(name), {
    bannerComment: '// Generated from schemas/' + name + '.schema.json. Do not edit.', unknownAny: true,
    $refOptions: { resolve: { localSchemas: { order: 1, canRead: /^https:\/\/design-lab.local\/schemas\//,
      read: (file: { url: string }) => structuredClone(schemas[file.url.split('/').at(-1)!.replace('.schema.json', '')]!) }, http: false } },
  });
  const target = resolve(pluginRoot, 'src/generated', name + '.ts');
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== content) throw new Error(`stale generated contract: ${target}`);
  } else writeFileSync(target, content);
}
const map = '// Generated from schemas. Do not edit.\n' + Object.keys(schemas).map(name => `import type { ${typeName(name)} } from './${name}.ts';`).join('\n') + '\nexport interface ArtifactMap {\n' + Object.keys(schemas).map(name => `  '${name}': ${typeName(name)};`).join('\n') + '\n}\n';
const target = resolve(pluginRoot, 'src/generated/artifacts.ts');
if (process.argv.includes('--check')) { if (readFileSync(target, 'utf8') !== map) throw new Error('stale ArtifactMap'); }
else writeFileSync(target, map);
