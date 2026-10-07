import { isEntrypoint } from './entrypoint.ts';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
function baselineEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'boolean' && typeof b === 'number' || typeof a === 'number' && typeof b === 'boolean') return Number(a) === Number(b);
  return a === b;
}
export function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k, v]) => !DROP.has(k) && !(k in DEFAULTS && baselineEqual(v, DEFAULTS[k]))).map(([k, v]) => [k, strip(v)]));
  return value;
}
export const decoded = (args: unknown): string => JSON.stringify(sorted(strip(args)));
export const literal = (args: unknown): string => ascii(decoded(args));
/** Node 24 announces stripTypeScriptTypes as experimental. The plugin uses it on purpose, so only that notice is dropped, and only while the call runs. */
const TYPE_STRIPPING_NOTICE = /^stripTypeScriptTypes is an experimental feature\b/;
/** Node emits the notice synchronously through process.emitWarning, before any 'warning' listener could run, so the filter wraps emitWarning for this call alone. */
function stripTypes(source: string): string {
  const emit = process.emitWarning;
  process.emitWarning = function (this: unknown, warning: string | Error, ...rest: unknown[]) {
    const message = typeof warning === 'string' ? warning : warning.message;
    if (rest[0] === 'ExperimentalWarning' && TYPE_STRIPPING_NOTICE.test(message)) return;
    return (emit as (...args: unknown[]) => void).call(this, warning, ...rest);
  } as typeof process.emitWarning;
  try { return stripTypeScriptTypes(source, { mode: 'strip' }); } finally { process.emitWarning = emit; }
}

/** Templates remain async function bodies. Strip inside a wrapper, then recover its body. */
export function stripTemplate(source: string): string {
  // Ported sources are valid modules for tsc; only this marked async body is
  // shipped to Figma. Imports and declarations outside it never enter payloads.
  if (source.includes('// DESIGN_LAB_TEMPLATE_BEGIN\n')) {
    const stripped = stripTypes(source);
    const start = stripped.indexOf('// DESIGN_LAB_TEMPLATE_BEGIN\n');
    const end = stripped.lastIndexOf('// DESIGN_LAB_TEMPLATE_END');
    if (start < 0 || end < start) throw new Error('invalid template boundaries');
    return stripped.slice(start + '// DESIGN_LAB_TEMPLATE_BEGIN\n'.length, end);
  }
  const prefix = 'async function __template__() {\n', suffix = '\n}';
  const stripped = stripTypes(prefix + source + suffix);
  if (!stripped.startsWith(prefix) || !stripped.endsWith(suffix)) throw new Error('type stripper changed wrapper boundaries');
  return stripped.slice(prefix.length, -suffix.length);
}
const strippedUnits = new Map<string, { source: string; body: string }>();
function readUnit(path: string, ts: boolean): string {
  const source = readFileSync(path, 'utf8');
  if (!ts) return source;
  const cached = strippedUnits.get(path);
  if (cached?.source === source) return cached.body;
  const body = stripTemplate(source);
  strippedUnits.set(path, { source, body });
  return body;
}
export class Renderer {
  readonly units: ReadonlyMap<string, string>;
  constructor(folder = resolve(pluginRoot, 'scripts/render'), sourceKind: 'auto' | 'javascript' = 'auto') {
    const files = readdirSync(folder).filter(f => sourceKind === 'javascript' ? f.endsWith('.js') : /\.(js|ts)$/.test(f)).sort(), units = new Map<string, string>();
    for (const file of files) {
      const name = file.replace(/\.(js|ts)$/, ''), ts = file.endsWith('.ts');
      if (!ts && files.includes(name + '.ts')) continue;
      units.set(name, readUnit(resolve(folder, file), ts));
    }
    this.units = new Map([...units].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  }
  libraries(): string[] { return [...this.units.keys()].filter(name => name.startsWith('_')); }
  runtimeHash(): string { return fnv1a([...this.units].map(([name, source]) => `${name}\n${source}`).join('')); }
  call(template: string, args: unknown): string {
    const source = this.units.get(template); if (!source) throw new Error('unknown template: ' + template);
    const sig = fnv1a(decoded(args)), shared = this.libraries().filter(u => u === '_cache' || USES_KIT.has(template)).map(u => this.units.get(u)! + '\n').join('');
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
if (isEntrypoint(import.meta.url)) process.exitCode = main();
