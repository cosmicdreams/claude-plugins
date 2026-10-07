import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const IGNORED_KEYS = new Set(['generatedAt', 'generated_at', 'timestamp', 'createdAt', 'updatedAt', 'runId', 'run_id', 'runID', '_ids']);
const numericKind = Symbol('parsed JSON numeric kind');
interface TaggedNumber { readonly [numericKind]: true; readonly value: number | bigint; readonly floating: boolean }
function taggedNumber(value: number | bigint, floating: boolean): TaggedNumber { return { [numericKind]: true, value, floating }; }
function isTaggedNumber(value: unknown): value is TaggedNumber { return !!value && typeof value === 'object' && (value as Partial<TaggedNumber>)[numericKind] === true; }
export function normalize(value: unknown): unknown {
  if (isTaggedNumber(value)) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !IGNORED_KEYS.has(key)).map(([key, item]) => [key, normalize(item)]));
  return value;
}
export function canonicalHash(layout: unknown): string {
  const canonical = canonicalNumbers(normalize(layout));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
/** json.dumps(allow_nan=False) rejects non-finite floats, reporting them with Python's repr. */
function assertFinite(value: number): void {
  if (Number.isFinite(value)) return;
  const repr = Number.isNaN(value) ? 'nan' : value > 0 ? 'inf' : '-inf';
  throw new RangeError(`Out of range float values are not JSON compliant: ${repr}`);
}
/** Python sorts str keys by code point; UTF-16 unit order differs for astral characters. */
function compareCodePoints(a: string, b: string): number {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const difference = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return x.length - y.length;
}
function canonicalFloat(value: number): string {
  if (Object.is(value, -0)) return '-0.0';
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e16)) {
    const [mantissa, exponentText] = value.toExponential().split('e');
    const exponent = Number(exponentText), sign = exponent >= 0 ? '+' : '-', digits = String(Math.abs(exponent)).padStart(2, '0');
    return `${mantissa}e${sign}${digits}`;
  }
  const text = String(value);
  return Number.isInteger(value) ? `${text}.0` : text;
}
function canonicalNumbers(value: unknown): string {
  if (isTaggedNumber(value)) {
    if (typeof value.value === 'bigint') return value.value.toString();
    assertFinite(value.value);
    return value.floating ? canonicalFloat(value.value) : String(value.value);
  }
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    assertFinite(value);
    // Python parses an integer token such as -0 as int 0, so integral values never carry a sign.
    return Number.isInteger(value) ? String(value) : canonicalFloat(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalNumbers).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => compareCodePoints(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalNumbers(item)}`).join(',')}}`;
  throw new TypeError('value is not JSON serializable');
}
export function hashLayout(path: string): string {
  const raw = readFileSync(path, 'utf8');
  // Node 24 supplies the original number token to the reviver. Preserve baseline's distinction
  // between JSON integers and floats (for example, 10 versus 10.0) before canonical encoding.
  const reviver = (key: string, value: unknown, context?: { source?: string }): unknown => {
    if (typeof value !== 'number' || context?.source === undefined) return value;
    if (/[.eE]/.test(context.source)) return taggedNumber(value, true);
    if (!Number.isSafeInteger(value)) return taggedNumber(BigInt(context.source), false);
    return value;
  };
  const parsed = JSON.parse(raw, reviver as (this: any, key: string, value: any) => any);
  return canonicalHash(parsed);
}
export function checkHash(layoutPath: string, expectedPath: string): { expected: string; actual: string; pass: boolean } {
  const expected = readFileSync(expectedPath, 'utf8').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('expected hash file must contain one SHA-256 hex digest');
  const actual = hashLayout(layoutPath);
  return { expected, actual, pass: actual === expected };
}
