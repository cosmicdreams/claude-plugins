/** PyYAML SafeLoader's YAML 1.1 scalar resolvers, rather than YAML's broader 1.1 set. */
import { sharedRequire } from './runtime.ts';
const yaml = sharedRequire()('yaml');
const bool = /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/;
const integer =
  /^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/;
const float =
  /^(?:[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
/** Keeps ordinary Number coercion for consumers, but never rounds integer JSON output. */
export class LargeInteger extends Number {
  exact: bigint;
  constructor(value: bigint) {
    super(Number(value));
    this.exact = value;
  }
  override toString(): string {
    return String(this.exact);
  }
  toJSON(): unknown {
    return (JSON as typeof JSON & { rawJSON(text: string): unknown }).rawJSON(String(this.exact));
  }
}
class YamlFloat extends Number {}
function parseIntYaml(text: string): number | LargeInteger {
  let clean = text.replaceAll('_', ''),
    sign = 1n;
  if (clean[0] === '-') {
    sign = -1n;
    clean = clean.slice(1);
  } else if (clean[0] === '+') clean = clean.slice(1);
  let value: bigint;
  if (clean.includes(':')) value = clean.split(':').reduce((n, p) => n * 60n + BigInt(p), 0n);
  else value = BigInt(/^0[0-7]+$/.test(clean) ? '0o' + clean.slice(1) : clean);
  value *= sign;
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : new LargeInteger(value);
}
function parseFloatYaml(text: string): YamlFloat {
  const clean = text.replaceAll('_', '').toLowerCase(),
    sign = clean.startsWith('-') ? -1 : 1,
    unsigned = clean.replace(/^[-+]/, '');
  return new YamlFloat(
    unsigned === '.inf'
      ? sign * Infinity
      : unsigned === '.nan'
        ? NaN
        : unsigned.includes(':')
          ? sign * unsigned.split(':').reduce((n, p) => n * 60 + Number(p), 0)
          : Number(clean),
  );
}
const scalarTags = [
  { tag: 'tag:yaml.org,2002:bool', default: true, test: bool, resolve: (s: string) => /^(yes|true|on)$/i.test(s) },
  { tag: 'tag:yaml.org,2002:int', default: true, test: integer, resolve: parseIntYaml },
  { tag: 'tag:yaml.org,2002:float', default: true, test: float, resolve: parseFloatYaml },
];
function keyString(key: unknown): string {
  if (key === null) return 'null';
  if (typeof key === 'boolean') return key ? 'true' : 'false';
  if (key instanceof YamlFloat) {
    const n = Number(key);
    if (Object.is(n, -0)) return '-0.0';
    if (!Number.isFinite(n)) return String(n);
    const magnitude = Math.abs(n),
      text = magnitude !== 0 && (magnitude >= 1e16 || magnitude < 1e-4) ? n.toExponential() : String(n);
    return text.includes('e')
      ? text.replace(/e([+-])(\d+)$/, (_, sign: string, power: string) => 'e' + sign + power.padStart(2, '0'))
      : Number.isInteger(n)
        ? text + '.0'
        : text;
  }

  return String(key);
}
function convert(value: unknown): unknown {
  if (value instanceof Map) {
    const entries = new Map<string, { key: string; value: unknown }>();
    for (const [key, item] of value) {
      // Python dictionaries coalesce bool/int/float keys (True == 1 == 1.0).
      const identity =
        key instanceof LargeInteger
          ? 'number:' + String(key)
          : typeof key === 'boolean'
            ? 'number:' + Number(key)
            : typeof key === 'number' || key instanceof Number
              ? 'number:' + (Number.isInteger(Number(key)) ? BigInt(Number(key)).toString() : String(key.valueOf()))
              : typeof key + ':' + String(key);
      entries.set(identity, { key: entries.get(identity)?.key ?? keyString(key), value: convert(item) });
    }
    return Object.fromEntries([...entries.values()].map(({ key, value }) => [key, value]));
  }
  if (Array.isArray(value)) return value.map(convert);
  if (value instanceof YamlFloat) return Number(value);
  return value;
}
export function parsePyYaml(text: string): unknown {
  return convert(
    yaml.parse(text, {
      schema: 'yaml-1.1',
      prettyErrors: false,
      uniqueKeys: false,
      mapAsMap: true,
      customTags: (tags: Array<{ tag: string }>) => [
        ...tags.filter((t) => !scalarTags.some((s) => s.tag === t.tag)),
        ...scalarTags,
      ],
    }),
  );
}
