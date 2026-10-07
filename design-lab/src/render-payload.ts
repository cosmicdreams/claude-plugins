import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { pluginRoot } from './runtime.ts';
import { ascii, sorted } from './json.ts';
export const LIMIT = 50000;
const DROP = new Set(['source', 'tag']);
const DEFAULTS: Record<string, unknown> = { italic: false, underline: false, letterSpacing: 0, case: 'ORIGINAL', align: 'LEFT', familyVar: null, var: null, opacity: 1, wrap: false, primaryAlign: 'MIN', counterAlign: 'MIN', gap: 0, fellBack: false };
const USES_KIT = new Set(['cover', 'foundation', 'tier_page', 'component_block', 'getting_started', 'voice', 'examples']);
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
function pythonEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'boolean' && typeof b === 'number' || typeof a === 'number' && typeof b === 'boolean') return Number(a) === Number(b);
  return a === b;
}
export function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k, v]) => !DROP.has(k) && !(k in DEFAULTS && pythonEqual(v, DEFAULTS[k]))).map(([k, v]) => [k, strip(v)]));
  return value;
}
export const decoded = (args: unknown): string => JSON.stringify(sorted(strip(args)));
export const literal = (args: unknown): string => ascii(decoded(args));
/** Templates remain async function bodies. Strip inside a wrapper, then recover its body. */
export function stripTemplate(source: string): string {
  const prefix = 'async function __template__() {\n', suffix = '\n}';
  const stripped = stripTypeScriptTypes(prefix + source + suffix, { mode: 'strip' });
  if (!stripped.startsWith(prefix) || !stripped.endsWith(suffix)) throw new Error('type stripper changed wrapper boundaries');
  return stripped.slice(prefix.length, -suffix.length);
}
export class Renderer {
  readonly units: ReadonlyMap<string, string>;
  constructor(folder = resolve(pluginRoot, 'scripts/render')) {
    const files = readdirSync(folder).filter(f => /\.(js|ts)$/.test(f)).sort(), units = new Map<string, string>();
    for (const file of files) {
      const name = file.replace(/\.(js|ts)$/, ''), ts = file.endsWith('.ts');
      if (!ts && files.includes(name + '.ts')) continue;
      units.set(name, ts ? stripTemplate(readFileSync(resolve(folder, file), 'utf8')) : readFileSync(resolve(folder, file), 'utf8'));
    }
    this.units = new Map([...units].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  }
  libraries(): string[] { return [...this.units.keys()].filter(name => name.startsWith('_')); }
  runtimeHash(): string { return fnv1a([...this.units].map(([name, source]) => `${name}\n${source}`).join('')); }
  call(template: string, args: unknown): string {
    const source = this.units.get(template); if (!source) throw new Error('unknown template: ' + template);
    const sig = fnv1a(decoded(args)), shared = USES_KIT.has(template) ? this.libraries().map(u => this.units.get(u)! + '\n').join('') : '';
    return `const ARGS = ${literal(args)};\nlet __h = 0x811c9dc5; const __s = JSON.stringify(ARGS);\nfor (let i = 0; i < __s.length; i++) { __h ^= __s.charCodeAt(i); __h = Math.imul(__h, 0x01000193) >>> 0; }\nif (__h.toString(16).padStart(8, '0') !== '${sig}') throw new Error('design-lab arguments were altered in transit: checksum ' + __h.toString(16) + ', expected ${sig}');\n` + shared + source;
  }
  inline(template: string, args: unknown): string {
    const source = this.units.get(template); if (!source) throw new Error('unknown template: ' + template);
    return `const ARGS = ${literal(args)};\n` + this.libraries().map(u => this.units.get(u)! + '\n').join('') + source;
  }
}
const renderer = (): Renderer => new Renderer();
export const callPayload = (template: string, args: unknown): string => renderer().call(template, args);
export const inlinePayload = (template: string, args: unknown): string => renderer().inline(template, args);
export function main(args = process.argv.slice(2)): number {
  const r = renderer(); if (args[0] === 'hash') { console.log(r.runtimeHash()); return 0; }
  if (!['call', 'inline'].includes(args[0] ?? '') || !args[1] || !args[2]) throw new Error('usage: render-payload.ts call|inline TEMPLATE ARGS.json [--out FILE] | hash');
  const data: unknown = JSON.parse(readFileSync(args[2], 'utf8')), code = args[0] === 'call' ? r.call(args[1], data) : r.inline(args[1], data);
  if ([...code].length > LIMIT) { console.error(`payload is ${[...code].length} characters; use_figma accepts ${LIMIT}`); return 2; }
  const index = args.indexOf('--out'); if (index >= 0) writeFileSync(args[index + 1]!, code); else process.stdout.write(code); return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
