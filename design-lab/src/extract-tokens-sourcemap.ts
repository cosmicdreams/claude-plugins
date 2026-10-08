import type {Tokens} from './generated/tokens.ts';
type SassToken=Required<Pick<NonNullable<Tokens['tokens']>[number],'name'|'codeName'|'raw'|'value'|'family'|'isAlias'|'layer'|'provenance'>> & {codeName:string};
/** Recover source-authored Sass tokens embedded in CSS source maps. */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve as pathResolve } from "node:path";
import { pluginRoot } from "./runtime.ts";
import { roundEven } from "./json.ts";
import { nonEmpty } from "./lookup.ts";

export const STANDARD_VERSION = "3.0.0";
const SKIP = /\/(node_modules|vendor|\.git)\//;
export const VAR = /^\s*\$([a-zA-Z0-9_-]+)\s*:\s*(.+?)\s*;/gm;
export const FLAGS = /\s*!(default|global)\b/g;
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const RGB = /^rgba?\([^)]*\)$/i;
const LEN = /^-?\d*\.?\d+(px|rem|em|vh|vw|%)$/;
const NUM = /^-?\d*\.?\d+$/;
const EMFN = /^em\(\s*(-?\d*\.?\d+)\s*\)$/;
const FONTSTACK = /["'][^"']+["']\s*,/;
const COLORFN = /^(lighten|darken)\(\s*(.+?)\s*,\s*(-?[\d.]+)%?\s*\)$/i;

function files(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.test(path.replaceAll("\\", "/") + "/"))
        out.push(...files(path));
    } else if (entry.isFile() && entry.name.endsWith(".css.map"))
      out.push(path);
  }
  return out.sort();
}
function toolVersion(): string {
  try {
    return (
      "design-lab " +
      JSON.parse(
        readFileSync(
          pathResolve(pluginRoot, ".claude-plugin/plugin.json"),
          "utf8",
        ),
      ).version
    );
  } catch {
    return "design-lab unknown";
  }
}
export function classify(value: string): string {
  const v = value.trim();
  if (HEX.test(v) || RGB.test(v)) return "color";
  if (EMFN.test(v) || LEN.test(v)) return "spacing";
  if (
    FONTSTACK.test(v) ||
    ["serif", "sans-serif", "monospace"].includes(v.toLowerCase())
  )
    return "font-family";
  if (["true", "false"].includes(v.toLowerCase())) return "flag";
  if (NUM.test(v)) return "number";
  return "unknown";
}
function hexToRgb(value: string): [number, number, number] | null {
  let h = value.replace(/^#/, "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (h.length < 6) return null;
  const n = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  return n.some(Number.isNaN) ? null : [n[0]! / 255, n[1]! / 255, n[2]! / 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((c) =>
        Math.max(0, Math.min(255, roundEven(c * 255)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function adjustLightness(value: string, delta: number): string | null {
  const rgb = hexToRgb(value);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  l = Math.max(0, Math.min(1, l + delta / 100));
  let rr: number, gg: number, bb: number;
  if (!s) rr = gg = bb = l;
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
      p = 2 * l - q;
    const hue = (t0: number): number => {
      let t = t0;
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    rr = hue(h + 1 / 3);
    gg = hue(h);
    bb = hue(h - 1 / 3);
  }
  return rgbToHex(rr, gg, bb);
}
export function resolve(
  raw: string,
  table: Map<string, string>,
  depth = 0,
): string {
  const value = raw.trim();
  if (depth > 8) return value;
  const direct = /^\$([a-zA-Z0-9_-]+)$/.exec(value);
  if (direct) {
    const target = table.get(direct[1]!);
    return target === undefined ? value : resolve(target, table, depth + 1);
  }
  const em = EMFN.exec(value);
  if (em) return `${Number.parseFloat(em[1]!)}px`;
  const color = COLORFN.exec(value);
  if (color) {
    const base = resolve(color[2]!, table, depth + 1);
    if (HEX.test(base))
      return (
        adjustLightness(
          base,
          Number.parseFloat(color[3]!) *
            (color[1]!.toLowerCase() === "lighten" ? 1 : -1),
        ) ?? value
      );
    return value;
  }
  if (value.includes("$")) {
    const substituted = value.replace(
      /\$([a-zA-Z0-9_-]+)/g,
      (all, name: string) => {
        const target = table.get(name);
        return target === undefined ? all : resolve(target, table, depth + 1);
      },
    );
    return substituted !== value
      ? resolve(substituted, table, depth + 1)
      : substituted;
  }
  return value;
}
export function extract(
  rootInput: string,
  baseHint = "base/",
): Tokens {
  const root = resolvePath(rootInput),
    maps = files(root);
  if (!maps.length)
    throw new Error(
      `no .css.map found under ${root} - this strategy does not apply`,
    );
  const tokens:SassToken[]=[],
    sourcesSeen:NonNullable<Tokens['sourcesWithVariables']>=[],
    problems:NonNullable<Tokens['problems']>=[];
  for (const mapPath of maps) {
    let data: { sources?: string[]; sourcesContent?: (string | null)[] };
    try {
      data = JSON.parse(readFileSync(mapPath, "utf8"));
    } catch (error) {
      problems.push({
        kind: "unreadable-sourcemap",
        ref: relative(root, mapPath),
        detail: String(error).slice(0, 200),
      });
      continue;
    }
    const sources = data.sources ?? [],
      contents = data.sourcesContent ?? [];
    if (!contents.length) {
      problems.push({
        kind: "sourcemap-without-content",
        ref: relative(root, mapPath),
        detail: "no sourcesContent - original Sass is not recoverable",
      });
      continue;
    }
    const pairs = sources
      .map((source, i) => [source, contents[i]] as const)
      .filter(
        (p): p is readonly [string, string] =>
          !!p[1] && !p[0].includes("node_modules"),
      );
    const table = new Map<string, string>();
    for (const [, body] of pairs)
      for (const m of body.matchAll(VAR))
        if (!table.has(m[1]!))
          table.set(m[1]!, m[2]!.replace(FLAGS, "").trim());
    for (const [source, body] of pairs) {
      const found = [...body.matchAll(VAR)];
      if (!found.length) continue;
      sourcesSeen.push({ source, variables: found.length });
      for (const m of found) {
        const name = m[1]!,
          raw = m[2]!.replace(FLAGS, "").trim(),
          value = resolve(raw, table);
        tokens.push({
          name,
          codeName: "$" + name,
          raw,
          value,
          family: classify(value),
          isAlias: raw !== value,
          layer: source.includes(baseHint) ? "base" : "component",
          provenance: {
            kind: "config",
            ref: `${relative(root, mapPath)}#${source}`,
          },
        });
      }
    }
  }
  const byName = new Map<string,SassToken>(),
    dupes:SassToken[]=[];
  for (const t of tokens) {
    const name = t["name"],
      prev = byName.get(name);
    if (!prev) byName.set(name, t);
    else if (prev["layer"] !== "base" && t["layer"] === "base") {
      dupes.push(prev);
      byName.set(name, t);
    } else dupes.push(t);
  }
  const kept = [...byName.values()].sort(
    (a, b) =>
      Number(a["layer"] !== "base") - Number(b["layer"] !== "base") ||
      compare(String(a["family"]), String(b["family"])) ||
      compare(String(a["name"]), String(b["name"])),
  );
  const families: Record<string, number> = {};
  for (const t of kept)
    families[String(t["family"])] = (families[String(t["family"])] ?? 0) + 1;
  return {
    standardVersion: STANDARD_VERSION,
    toolVersion: toolVersion(),
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
    source: {
      strategy: "sass-sourcemap",
      root,
      maps: maps.map((p) => relative(root, p)),
    },
    totals: {
      tokens: kept.length,
      base: kept.filter((t) => t["layer"] === "base").length,
      component: kept.filter((t) => t["layer"] === "component").length,
      shadowed: dupes.length,
      byFamily: families,
    },
    typeScaling: {
      observable: false,
      noneScale: null,
      reason:
        "Sass source maps carry variable declarations without the CSS property or breakpoint they apply at; per-role scaling cannot be derived. Measure the rendered type ramp, or read the theme breakpoints, before choosing modes for the Type collection.",
    },
    tokens: nonEmpty(kept, "no Sass variable could be recovered from the source maps"),
    shadowed: dupes,
    sourcesWithVariables: sourcesSeen.sort(
      (a, b) => Number(b["variables"]) - Number(a["variables"]),
    ),
    problems,
  };
}
function resolvePath(path: string): string {
  return pathResolve(path);
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
