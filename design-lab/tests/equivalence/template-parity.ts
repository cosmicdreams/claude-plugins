import { restoreSeams, assertExpansionParity } from './typed-seams-parity.ts';
import { oracleScripts, oracleRoot } from './oracle.ts';
/** Compare parsed executable bodies after type stripping, preserving literal values. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sharedRequire, pluginRoot } from '../../src/runtime.ts';
import { Renderer, fnv1a, decoded, stripTemplate } from '../../src/render-payload.ts';
const acorn = sharedRequire()('acorn') as typeof import('acorn');
export function tokens(source: string): string {
  // Type assertions can leave redundant parentheses. Acorn's default AST drops
  // them; all executable nodes/operators and literal values remain compared.
  const ast = acorn.parse(`async function __parity__() {\n${source}\n}`, { ecmaVersion: 'latest' });
  return JSON.stringify(ast, (key, value: unknown) => ['start', 'end', 'raw'].includes(key) ? undefined : value);
}
// These are the entire intentional host-call changes. No general DL_API rewrite
// or removal of arbitrary code is allowed to conceal a port regression.
export function withoutCache(source: string, cache: string): string {
  if (cache && source.includes(cache)) source = source.replace(cache + '\n', '');
  return source.replaceAll('DL_API.fonts()', 'figma.listAvailableFontsAsync()')
    .replaceAll('DL_API.loadFont(', 'figma.loadFontAsync(')
    .replaceAll('DL_API.variables()', 'figma.variables.getLocalVariablesAsync()')
    .replaceAll('DL_API.collections()', 'figma.variables.getLocalVariableCollectionsAsync()')
    .replaceAll('DL_API.createVariable(', 'figma.variables.createVariable(')
    .replaceAll('DL_API.createCollection(', 'figma.variables.createVariableCollection(')
    .replaceAll('DL_API.invalidateVariables();', '');
}
export function legacyRuntime(value: unknown, current: string, legacy: string): unknown {
  if (typeof value === 'string') return value.replaceAll('figma_build.ts init, then next/record until done', 'figma_build.py init, then next/record until done');
  if (Array.isArray(value)) return value.map(v => legacyRuntime(v, current, legacy));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !['buildId','executionRevision'].includes(k)).map(([k, v]) => [k, k === 'runtime' && v === current ? legacy : ['toolVersion', 'generator'].includes(k) && v === 'design-lab ' + JSON.parse(readFileSync(resolve(pluginRoot, '.claude-plugin/plugin.json'), 'utf8')).version ? 'design-lab ' + JSON.parse(readFileSync(resolve(oracleRoot, 'design-lab/.claude-plugin/plugin.json'), 'utf8')).version : legacyRuntime(v, current, legacy)]));
  return value;
}
const bodyHasExpansion=(source:string)=>source.includes('function assertExpanded(');
export function assertPayloadParity(actual: string, expected: string, current: Renderer, legacy: Renderer, message: string): void {
  const readArgs = (code: string): unknown => JSON.parse(code.split('\n')[0]!.slice('const ARGS = '.length, -1));
  const args = readArgs(actual), old = readArgs(expected);
  assert.deepEqual(legacyRuntime(args, current.runtimeHash(), legacy.runtimeHash()), old, message + ': ARGS');
  if (bodyHasExpansion(actual)) assertExpansionParity(args);
  // Check the literal and integrity header before comparing the template bodies.
  const signature = fnv1a(decoded(args));
  assert.ok(actual.includes(`!== '${signature}'`), message + ': current checksum');
  assert.ok(expected.includes(`!== '${fnv1a(decoded(old))}'`), message + ': oracle checksum');
  const body = (code: string): string => code.split('\n').slice(4).join('\n');
  assert.deepEqual(tokens(withoutCache(body(actual).includes('function assertExpanded(') ? restoreSeams(body(actual),'responsive') : body(actual), current.units.get('_cache') ?? '')), tokens(body(expected)), message + ': executable body');
}
export function assertTemplates(): { units: number; dumps: number } {
  const current = new Renderer(), legacy = new Renderer(resolve(oracleScripts, 'render'), 'javascript');
  for (const [name, source] of legacy.units) assert.deepEqual(tokens(withoutCache(name === 'build_responsive' ? restoreSeams(current.units.get(name)!,'responsive') : current.units.get(name)!, '')), tokens(source), name);
  let dumps = 0;
  for (const name of ['root', 'tree', 'page', 'getting_started']) {
    const file = `figma_dump_${name}`;
    // Dump templates use the same marked async-body extraction as render units.
    const source = stripTemplate(readFileSync(resolve(pluginRoot, 'templates/figma', file + '.ts'), 'utf8'));
    assert.deepEqual(tokens(withoutCache(source, '')), tokens(readFileSync(resolve(oracleScripts, file + '.js'), 'utf8')), file); dumps++;
  }
  return { units: legacy.units.size, dumps };
}
