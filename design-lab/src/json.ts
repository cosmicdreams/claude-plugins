/** JSON serialization shared by baseline-compatible digests and payloads. */
export function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, sorted(v)]));
  return value;
}
export function ascii(text: string): string { return text.replace(/[\u007f-\uffff]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')); }
/** baseline json.dumps(sort_keys=True)'s default whitespace, without altering string contents. */
export function canonicalJson(value: unknown): string {
  const text = ascii(JSON.stringify(sorted(value)));
  let out = '', inString = false, escaped = false;
  for (const char of text) {
    out += char;
    if (inString) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; }
    else if (char === '"') inString = true;
    else if (char === ',' || char === ':') out += ' ';
  }
  return out;
}
/** baseline rounds exact half ties to even; Math.round would change measured geometry. */
export function roundEven(value: number): number {
  const lo = Math.floor(value), fraction = value - lo;
  return (fraction === 0.5 ? lo % 2 === 0 ? lo : lo + 1 : Math.round(value)) || 0;
}
/** Round the exact binary64 value to decimal places, with baseline's even half ties. */
export function roundDecimal(value: number, digits: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  if (!Number.isInteger(digits) || digits < 0 || digits > 15) throw new Error('decimal digits out of range');
  const buffer = new ArrayBuffer(8), view = new DataView(buffer); view.setFloat64(0, Math.abs(value));
  const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 0x7ffn), fraction = bits & ((1n << 52n) - 1n);
  let numerator = (exponent ? (1n << 52n) + fraction : fraction) * 10n ** BigInt(digits), denominator = 1n;
  const power = (exponent || 1) - 1023 - 52;
  if (power >= 0) numerator <<= BigInt(power); else denominator <<= BigInt(-power);
  let quotient = numerator / denominator; const remainder = numerator % denominator;
  if (2n * remainder > denominator || 2n * remainder === denominator && quotient % 2n !== 0n) quotient++;
  return (value < 0 ? -1 : 1) * Number(quotient) / 10 ** digits;
}
