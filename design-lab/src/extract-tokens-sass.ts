/** Extract source-authored Sass variables and the project's small set of token maps. */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pluginRoot } from "./runtime.ts";
import { nonEmpty } from "./lookup.ts";
import type { Tokens } from "./generated/tokens.ts";
type Row = NonNullable<Tokens["tokens"]>[number];
type Shadowed = NonNullable<Tokens["shadowed"]>[number];
import {
  classify as valueFamily,
  FLAGS,
  resolve as resolveAlias,
  VAR,
} from "./extract-tokens-sourcemap.ts";

const STANDARD_VERSION = "3.0.0";
const SKIP = /\/(node_modules|vendor|\.git|contrib|core)\//;
const TOKEN_MAPS = [
  "spacers",
  "grid-breakpoints",
  "container-max-widths",
  "font-sizes",
];
function toolVersion(): string {
  try {
    return (
      "design-lab " +
      JSON.parse(
        readFileSync(resolve(pluginRoot, ".claude-plugin/plugin.json"), "utf8"),
      ).version
    );
  } catch {
    return "design-lab unknown";
  }
}
function posix(path: string): string {
  return path.split("\\").join("/");
}
function sourceFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.test(posix(path) + "/")) result.push(...sourceFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".scss"))
      result.push(path);
  }
  return result.sort();
}
export function balancedMap(text: string, name: string): string | null {
  const re = new RegExp(
      `^\\s*\\$${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*:\\s*\\(`,
      "m",
    ),
    match = re.exec(text);
  if (!match) return null;
  const start = text.indexOf("(", match.index);
  let depth = 0,
    quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return text.slice(start + 1, i);
  }
  return null;
}
export function mapEntries(body: string): [string, string][] {
  const entries: [string, string][] = [];
  let depth = 0;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!depth) {
      const m = /^["']?([A-Za-z0-9_-]+)["']?\s*:\s*([^,]+),?/.exec(line);
      if (m && !m[2]!.includes("(")) entries.push([m[1]!, m[2]!.trim()]);
    }
    depth +=
      (line.match(/\(/g)?.length ?? 0) - (line.match(/\)/g)?.length ?? 0);
  }
  return entries;
}
/** Python's format(value, 'g'): six significant digits, half-to-even on the exact binary value,
 * exponent form below 1e-4 or from 1e6, and trailing zeros and point removed. */
export function pyFormatG(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  const sign = value < 0 || Object.is(value, -0) ? "-" : "";
  if (value === 0) return sign + "0";
  // toExponential(100) gives the exact decimal digits needed to detect a tie at the sixth digit.
  const [mantissa, exponentText] = Math.abs(value).toExponential(100).split("e");
  const digits = mantissa!.replace(".", "");
  let exponent = Number(exponentText);
  let significand = BigInt(digits.slice(0, 6));
  const rest = digits.slice(6), lastDigit = Number(digits[5]);
  if (rest[0]! > "5" || (rest[0] === "5" && (/[1-9]/.test(rest.slice(1)) || lastDigit % 2 === 1)))
    significand += 1n;
  if (significand === 1000000n) {
    significand = 100000n;
    exponent += 1;
  }
  const sig = significand.toString();
  const strip = (text: string): string =>
    text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
  if (exponent < -4 || exponent >= 6)
    return `${sign}${strip(`${sig[0]}.${sig.slice(1)}`)}e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
  const fixed =
    exponent >= 0
      ? `${sig.slice(0, exponent + 1)}.${sig.slice(exponent + 1)}`
      : `0.${"0".repeat(-exponent - 1)}${sig}`;
  return sign + strip(fixed);
}
function makeResolver(table: Map<string, string>): (raw: string) => string {
  const cache = new Map<string, string>(),
    resolving = new Set<string>();
  const named = (name: string): string => {
    if (cache.has(name)) return cache.get(name)!;
    if (resolving.has(name) || !table.has(name)) return "$" + name;
    resolving.add(name);
    const result = expression(table.get(name)!);
    resolving.delete(name);
    cache.set(name, result);
    return result;
  };
  const expression = (raw: string): string => {
    const substituted = raw
      .trim()
      .replace(/\$([A-Za-z0-9_-]+)/g, (_all, name: string) => named(name));
    const resolved = resolveAlias(substituted, new Map());
    const multiplication =
      /^\s*(-?[\d.]+)(px|rem|em)?\s*\*\s*(-?[\d.]+)\s*$/.exec(resolved);
    return multiplication
      ? `${pyFormatG(Number.parseFloat(multiplication[1]!) * Number.parseFloat(multiplication[3]!))}${multiplication[2] ?? ""}`
      : resolved;
  };
  return expression;
}
function family(name: string, value: string): string {
  for (const [pattern, result] of [
    [/font-size|(^|-)text-size/i, "font-size"],
    [/line-height|leading/i, "line-height"],
    [/font-family/i, "font-family"],
    [/font-weight/i, "font-weight"],
    [/letter-spacing|tracking/i, "letter-spacing"],
    [/radius|rounded/i, "radius"],
    [/duration|transition|delay|ease/i, "motion"],
    [/spacer|spacing|gap|gutter|padding|margin/i, "spacing"],
  ] as [RegExp, string][])
    if (pattern.test(name)) return result;
  return valueFamily(value);
}
function mapFamily(name: string, value: string): string {
  return (
    (
      {
        spacers: "spacing",
        "font-sizes": "font-size",
        "grid-breakpoints": "breakpoint",
        "container-max-widths": "container-width",
      } as Record<string, string>
    )[name] ?? family(name, value)
  );
}
export function extract(rootInput: string): Tokens {
  const root = resolve(rootInput),
    texts = new Map<string, string>(),
    table = new Map<string, string>(),
    sources: { source: string; variables: number }[] = [];
  for (const path of sourceFiles(root)) {
    let body: string;
    try {
      body = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const found = [...body.matchAll(VAR)];
    if (
      !found.length &&
      !TOKEN_MAPS.some((name) => balancedMap(body, name) !== null)
    )
      continue;
    texts.set(path, body);
    sources.push({
      source: posix(relative(root, path)),
      variables: found.length,
    });
    for (const m of found)
      if (!table.has(m[1]!)) table.set(m[1]!, m[2]!.replace(FLAGS, "").trim());
  }
  if (!table.size)
    throw new Error(`no source-authored Sass variables found under ${root}`);
  const resolveValue = makeResolver(table),
    all: Row[] = [];
  for (const [path, body] of texts) {
    const ref = posix(relative(root, path)),
      layer = /\/source\/(00-config|01-base)\//.test("/" + ref)
        ? "base"
        : "component";
    for (const m of body.matchAll(VAR)) {
      const name = m[1]!,
        raw = m[2]!.replace(FLAGS, "").trim();
      if (raw.startsWith("(")) continue;
      const value = resolveValue(raw);
      all.push({
        name,
        codeName: "$" + name,
        raw,
        value,
        family: family(name, value),
        isAlias: raw !== value,
        layer,
        provenance: { kind: "config", ref },
      });
    }
    for (const mapName of TOKEN_MAPS) {
      const mapBody = balancedMap(body, mapName);
      if (mapBody === null) continue;
      for (const [key, raw] of mapEntries(mapBody)) {
        const value = resolveValue(raw);
        all.push({
          name: `${mapName}-${key}`,
          codeName: null,
          codePath: `$${mapName}[${key}]`,
          raw,
          value,
          family: mapFamily(mapName, value),
          isAlias: raw !== value,
          layer,
          description: `Map entry has no standalone Sass identifier; source path is $${mapName}[${key}].`,
          provenance: { kind: "config", ref },
        });
      }
    }
  }
  const byName = new Map<string, Row>(),
    shadowed: Shadowed[] = [];
  for (const token of all) {
    const name = token.name ?? "",
      prev = byName.get(name);
    if (!prev || (prev.layer !== "base" && token.layer === "base")) {
      if (prev) shadowed.push(prev);
      byName.set(name, token);
    } else shadowed.push(token);
  }
  const kept = [...byName.values()].sort(
    (a, b) =>
      Number(a.layer !== "base") - Number(b.layer !== "base") ||
      compare(String(a.family), String(b.family)) ||
      compare(String(a.name), String(b.name)),
  );
  const byFamily: Record<string, number> = {};
  for (const t of kept)
    byFamily[String(t.family)] = (byFamily[String(t.family)] ?? 0) + 1;
  return {
    standardVersion: STANDARD_VERSION,
    toolVersion: toolVersion(),
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
    source: {
      strategy: "sass-source",
      root,
      files: sources.map((s) => s.source),
    },
    totals: {
      tokens: kept.length,
      base: kept.filter((t) => t.layer === "base").length,
      component: kept.filter((t) => t.layer === "component").length,
      shadowed: shadowed.length,
      byFamily,
    },
    typeScaling: {
      observable: false,
      noneScale: null,
      reason:
        "Sass declarations do not state every consuming breakpoint; measure rendered roles.",
    },
    tokens: nonEmpty(kept, "no Sass variable could be read"),
    shadowed,
    sourcesWithVariables: [...sources].sort(
      (a, b) => b.variables - a.variables,
    ),
    problems: [],
  };
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
