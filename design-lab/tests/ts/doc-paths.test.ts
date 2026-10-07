import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { pluginRoot } from '../../src/runtime.ts';

const markdown = (folder: string): string[] => readdirSync(folder).flatMap(name => {
  const path = join(folder, name);
  return statSync(path).isDirectory() ? markdown(path) : name.endsWith('.md') ? [path] : [];
});

test('shipped docs name only plugin files that exist', () => {
  const files = ['README.md', 'TYPESCRIPT.md', ...['skills', 'references', 'commands'].flatMap(folder => markdown(resolve(pluginRoot, folder)).map(path => relative(pluginRoot, path)))];
  const pattern = /(?<![\w./-])((?:scripts|src|templates|runner|hooks|schemas|types)\/[A-Za-z0-9_./-]*[A-Za-z0-9_]\.(?:ts|tsx|js|mjs|json|md))\b/g;
  const missing: string[] = []; let checked = 0;
  for (const file of files) for (const match of readFileSync(resolve(pluginRoot, file), 'utf8').matchAll(pattern)) {
    const path = match[1]!; checked++;
    if (!existsSync(resolve(pluginRoot, path))) missing.push(`${file}: ${path}`);
  }
  assert.ok(checked > 40, `only ${checked} paths found; the pattern may have stopped matching`);
  assert.deepEqual(missing, []);
});
