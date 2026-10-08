/** Text and number formatting for the benchmark report, reproducing the baseline oracle's output exactly. */
import { roundEven } from './json.ts';

/** A value a scorecard field can hold where the report prints it. */
export type Scalar = string | number | boolean | null | undefined;

/** str() of a scalar, as the baseline printed it in an f-string: a missing value reads None. */
export function pyStr(v: Scalar): string {
  return v == null ? 'None' : v === true ? 'True' : v === false ? 'False' : String(v);
}
/** The baseline's fixed point format: rounds the exact binary value, ties to even. */
export function fixed(v: number, digits: number): string {
  if (!Number.isFinite(v)) return String(v);
  const negative = v < 0 || Object.is(v, -0),
    data = new DataView(new ArrayBuffer(8));
  data.setFloat64(0, Math.abs(v));
  const bits = data.getBigUint64(0),
    exponent = Number((bits >> 52n) & 2047n),
    fraction = bits & ((1n << 52n) - 1n);
  let numerator = (exponent ? fraction + (1n << 52n) : fraction) * 10n ** BigInt(digits),
    denominator = 1n;
  const shift = (exponent ? exponent - 1023 : 1 - 1023) - 52;
  if (shift >= 0) numerator <<= BigInt(shift);
  else denominator <<= BigInt(-shift);
  let n = numerator / denominator;
  const rem = numerator % denominator;
  if (rem * 2n > denominator || (rem * 2n === denominator && n % 2n)) n++;
  const s = n.toString().padStart(digits + 1, '0');
  return (negative ? '-' : '') + (digits ? s.slice(0, -digits) + '.' + s.slice(-digits) : s);
}
/** str() of a value the baseline held as a float: whole numbers keep their ".0". */
export function floatString(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}
/** Six significant digits with trailing zeros dropped, as the report's chart labels have always read. */
export function sixDigits(v: number): string {
  return Number(v.toPrecision(6)).toString();
}
const withCommas = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function esc(v: Scalar): string {
  return (v == null ? '' : pyStr(v))
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
}
/** A count or measure with thousands separators; fractions keep one decimal place. */
export function num(v: number | null | undefined): string {
  if (v == null) return '–';
  const [integer = '', decimal] = (Number.isInteger(v) ? String(Math.trunc(v)) : fixed(v, 1)).split('.');
  return withCommas(integer) + (decimal === undefined ? '' : '.' + decimal);
}
export function pct(v: number | null | undefined, digits = 0): string {
  return v == null ? '–' : fixed(v * 100, digits) + '%';
}
export function duration(v: number | null | undefined): string {
  if (v == null) return '–';
  const s = Math.trunc(v);
  if (s < 90) return `${s} s`;
  const hours = Math.floor(s / 3600),
    rest = s % 3600;
  return hours
    ? `${hours} h ${roundEven(rest / 60)} min`
    : rest % 60
      ? `${Math.floor(rest / 60)} min ${rest % 60} s`
      : `${Math.floor(rest / 60)} min`;
}
/** A duration as a large figure and its unit. */
export function splitDuration(v: number): [string, string] {
  const s = roundEven(v);
  if (s < 90) return [String(s), ' s'];
  const hours = Math.floor(s / 3600),
    rest = s % 3600;
  return hours
    ? [String(hours), ` h ${roundEven(rest / 60)} min`]
    : [String(Math.floor(rest / 60)), rest % 60 ? ` min ${rest % 60} s` : ' min'];
}
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
function parseDate(v: string | null | undefined): Date | null {
  if (v == null) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** The written calendar date, in the timestamp's own offset rather than converted to local time. */
export function day(v: string | null | undefined): string {
  if (v == null || !parseDate(v)) return 'date not recorded';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return 'date not recorded';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
/** Day, month and time on the build machine's clock. */
export function stamp(v: string | null | undefined): string {
  const d = parseDate(v);
  if (!d) return '–';
  return `${d.getDate()} ${MONTHS[d.getMonth()]?.slice(0, 3)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** A token count shortened to k, M or B. */
export function compact(v: number | null | undefined): string {
  if (v == null) return '–';
  for (const [size, suffix] of [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ] as const) {
    if (v >= size) {
      const f = v / size;
      return fixed(f, f < 10 ? 1 : 0) + suffix;
    }
  }
  return String(v);
}

/** A sort key compared like a baseline tuple: element by element, a shorter prefix first. */
export type SortKey = string | number | boolean | null | undefined | readonly SortKey[];
export function compareKeys(a: SortKey, b: SortKey): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = compareKeys(a[i], b[i]);
      if (c) return c;
    }
    return a.length - b.length;
  }
  // Mixed or missing values compare as JavaScript's relational operators do, which leaves them unordered.
  const x = a as string | number,
    y = b as string | number;
  return x < y ? -1 : x > y ? 1 : 0;
}
/** A stable sort on a derived key. */
export function sortedBy<T>(items: Iterable<T>, key: (item: T) => SortKey): T[] {
  return [...items].sort((a, b) => compareKeys(key(a), key(b)));
}
/** A record's own value for a key, never one inherited from Object.prototype. */
export function own<T>(record: Readonly<Record<string, T>>, key: string | undefined): T | undefined {
  const k = String(key);
  return Object.hasOwn(record, k) ? record[k] : undefined;
}
