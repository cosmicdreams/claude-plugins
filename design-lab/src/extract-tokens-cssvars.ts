/** Extract authored CSS custom properties from theme-loaded stylesheets. */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pluginRoot } from "./runtime.ts";
import { nonEmpty } from "./lookup.ts";
import type { Tokens } from "./generated/tokens.ts";
type Row = NonNullable<Tokens["tokens"]>[number];
type Problem = NonNullable<Tokens["problems"]>[number];
type Shadowed = NonNullable<Tokens["shadowed"]>[number];

const STANDARD_VERSION = "3.0.0";
const SKIP = /\/(node_modules|vendor|\.git|contrib|core)\//;
const DECL = /(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g;
const VARREF =
  /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g;
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const RGB = /^(rgba?|hsla?)\([^)]*\)$/i;
const LEN = /^-?\d*\.?\d+(px|rem|em|vh|vw|ch|%)$/;
const TIME = /^-?\d*\.?\d+m?s$/;
const NUM = /^-?\d*\.?\d+$/;
const FONTSTACK = /["'][^"']+["']\s*,|,\s*(sans-serif|serif|monospace)\b/;
const NAME_FAMILY: [RegExp, string][] = [
  [/^--(color|skin|bg|surface|border|text-color|fill|shadow-color)/i, "color"],
  [/^--(font-size|text)-/i, "font-size"],
  [/^--(font-weight|weight)-/i, "font-weight"],
  [/^--(font-family|font-sans|font-serif|font-mono|family)/i, "font-family"],
  [/^--(leading|line-height)/i, "line-height"],
  [/^--(tracking|letter-spacing)/i, "letter-spacing"],
  [/^--([a-z0-9-]*-)?(border-)?radius|^--rounded/i, "radius"],
  [/^--(transition|duration|delay|ease)/i, "motion"],
  [/^--(space|gap|gutter|inset|size|width|height|pad|margin)/i, "spacing"],
  [/^--shadow/i, "shadow"],
  [/^--(z|index|layer)-/i, "number"],
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
function walk(root: string): string[] {
  const found: string[] = [],
    dirs: string[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) {
      if (!SKIP.test(p.replaceAll("\\", "/") + "/")) dirs.push(p);
    } else if (e.isFile()) found.push(p);
  }
  // os.walk yields all files in a directory before visiting its child directories.
  for (const dir of dirs) found.push(...walk(dir));
  return found;
}
export function valueFamily(value: string): string {
  const v = value.trim();
  if (HEX.test(v) || RGB.test(v)) return "color";
  if (FONTSTACK.test(v)) return "font-family";
  if (TIME.test(v)) return "motion";
  if (LEN.test(v)) return "spacing";
  if (NUM.test(v)) return "number";
  return "unknown";
}
export function classify(name: string, value: string): string {
  for (const [pattern, family] of NAME_FAMILY)
    if (pattern.test(name)) {
      const valueFam = valueFamily(value);
      if (
        family === "color" &&
        ["spacing", "number", "motion"].includes(valueFam)
      )
        return valueFam;
      if (family !== "color" && valueFam === "color") return "color";
      return family;
    }
  return valueFamily(value);
}
export interface Declaration {
  selector: string;
  media: string;
  name: string;
  raw: string;
}
export function declarations(input: string): Declaration[] {
  const src = input.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Declaration[] = [],
    stack: string[] = [];
  let i = 0;
  while (i < src.length) {
    const nb = src.indexOf("{", i),
      ne = src.indexOf("}", i);
    if (nb < 0 && ne < 0) break;
    if (nb >= 0 && (ne < 0 || nb < ne)) {
      const prelude = src
        .slice(i, nb)
        .trim()
        .replace(/\n/g, " ")
        .replace(/\s+/g, " ");
      stack.push(prelude);
      const bodyEnd = src.indexOf("}", nb),
        innerOpen = src.indexOf("{", nb + 1);
      if (bodyEnd >= 0 && (innerOpen < 0 || bodyEnd < innerOpen)) {
        const media = stack.filter((s) => s.startsWith("@media")).join(" and ");
        const selector =
          [...stack].reverse().find((s) => !s.startsWith("@")) ?? "";
        for (const m of src.slice(nb + 1, bodyEnd).matchAll(DECL))
          out.push({ selector, media, name: m[1]!, raw: m[2]!.trim() });
        stack.pop();
        i = bodyEnd + 1;
        continue;
      }
      i = nb + 1;
    } else {
      if (stack.length) stack.pop();
      i = ne + 1;
    }
  }
  return out;
}
function resolveValue(
  raw: string,
  table: Map<string, string>,
  depth = 0,
): string {
  const v = raw.trim();
  if (depth > 8 || !v.includes("var(")) return v;
  const subbed = v.replace(
    VARREF,
    (all, name: string, fallback: string | undefined) => {
      const target = table.get(name);
      return target === undefined
        ? (fallback ?? all).trim()
        : resolveValue(target, table, depth + 1);
    },
  );
  return subbed !== v ? resolveValue(subbed, table, depth + 1) : subbed;
}
function relativePosix(root: string, path: string): string {
  return relative(root, path).split("\\").join("/");
}
export function themeStylesheets(root: string): {
  loaded: Set<string>;
  libraries: string[];
} {
  const loaded = new Set<string>(),
    libraries: string[] = [],
    references: [string, string][] = [];
  for (const path of walk(root))
    if (path.endsWith(".libraries.yml")) {
      libraries.push(path);
      let body: string;
      try {
        body = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      for (const m of body.matchAll(/^\s*([^\s:#][^:]*\.css)\s*:/gm)) {
        const ref = m[1]!.trim();
        if (!/^(http:|https:|\/\/)/.test(ref)) references.push([path, ref]);
      }
    }
  const themeRefs = references.filter(([lib]) =>
    /\/themes(?:\/|$)/.test(lib.replaceAll("\\", "/")),
  );
  for (const [lib, ref] of themeRefs.length ? themeRefs : references)
    loaded.add(resolve(join(resolve(lib, ".."), ref.replace(/^\//, ""))));
  return { loaded, libraries };
}
export function extract(rootInput: string): Tokens {
  const root = resolve(rootInput),
    { loaded, libraries } = themeStylesheets(root);
  const sheets: [string, string][] = [],
    ignored: [string, string][] = [],
    problems: Problem[] = [];
  for (const path of walk(root)) {
    if (!path.endsWith(".css") || path.endsWith(".min.css")) continue;
    let body: string;
    try {
      body = readFileSync(path, "utf8");
    } catch (e) {
      problems.push({
        kind: "unreadable-stylesheet",
        ref: relativePosix(root, path),
        detail: String(e).slice(0, 200),
      });
      continue;
    }
    if (!DECL.test(body)) {
      DECL.lastIndex = 0;
      continue;
    }
    DECL.lastIndex = 0;
    (loaded.has(path) ? sheets : ignored).push([path, body]);
  }
  if (!sheets.length)
    throw new Error(
      `no theme-loaded stylesheet declares custom properties under ${root} - this strategy does not apply. ${ignored.length} stylesheet(s) declare them but no *.libraries.yml loads them.`,
    );
  const table = new Map<string, string>(),
    rows: Row[] = [];
  for (const [, body] of sheets)
    for (const d of declarations(body))
      if (!table.has(d.name)) table.set(d.name, d.raw);
  for (const [path, body] of sheets)
    for (const d of declarations(body)) {
      const value = resolveValue(d.raw, table);
      rows.push({
        name: d.name.slice(2),
        codeName: d.name,
        raw: d.raw,
        value,
        family: classify(d.name, value),
        isAlias: d.raw !== value,
        selector: d.selector,
        media: d.media || null,
        layer:
          [":root", "html", ":host"].includes(d.selector) && !d.media
            ? "base"
            : "component",
        provenance: { kind: "config", ref: relativePosix(root, path) },
      });
    }
  const medias = [
    ...new Set(
      rows
        .map((r) => r.media)
        .filter((m): m is string => typeof m === "string" && !!m),
    ),
  ];
  const scalingNames = new Set(
    rows.filter((r) => r.media).map((r) => r.name),
  );
  const baseNames = new Set(
    rows.filter((r) => !r.media).map((r) => r.name),
  );
  for (const name of baseNames)
    if (!scalingNames.has(name)) scalingNames.delete(name);
  const scaled = new Set([...scalingNames].filter((n) => baseNames.has(n)));
  const modes = medias.length && scaled.size ? ["Value", ...medias] : ["Value"];
  const byName = new Map<string, Row>(),
    dupes: Shadowed[] = [];
  const shadow = (r: Row): Shadowed => ({
    ...(r.name !== undefined ? { name: r.name } : {}),
    ...(r.value !== undefined ? { value: r.value } : {}),
    ...(r.layer !== undefined ? { layer: r.layer } : {}),
    ...(r.provenance !== undefined ? { provenance: r.provenance } : {}),
  });
  for (const row of rows) {
    const name = row.name ?? "",
      mode = row.media || "Value",
      prev = byName.get(name);
    if (!prev)
      byName.set(name, {
        ...row,
        valuesByMode: row.value === undefined ? {} : { [mode]: row.value },
      });
    else {
      const values = (prev.valuesByMode ??= {});
      if (row.value !== undefined) values[mode] ??= row.value;
      if (prev.layer !== "base" && row.layer === "base") {
        const merged = values;
        byName.set(name, { ...row, valuesByMode: merged });
        if (row.value !== undefined) merged[mode] = row.value;
        dupes.push(shadow(prev));
      } else dupes.push(shadow(row));
    }
  }
  const kept = [...byName.values()].sort(
    (a, b) =>
      Number(a["layer"] !== "base") - Number(b["layer"] !== "base") ||
      compare(String(a["family"]), String(b["family"])) ||
      compare(String(a["name"]), String(b["name"])),
  );
  const byFamily: Record<string, number> = {};
  for (const t of kept)
    byFamily[String(t["family"])] = (byFamily[String(t["family"])] ?? 0) + 1;
  const typeNames = new Set(
    kept
      .filter((t) => ["font-size", "line-height"].includes(String(t["family"])))
      .map((t) => t["name"]),
  );
  const typeScales = [...typeNames].some((n) => scaled.has(n));
  return {
    standardVersion: STANDARD_VERSION,
    toolVersion: toolVersion(),
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
    source: {
      strategy: "css-custom-properties",
      root,
      stylesheets: sheets.map(([p]) => relativePosix(root, p)).sort(),
      librariesFiles: libraries.map((p) => relativePosix(root, p)).sort(),
      ignoredNotLoaded: ignored.map(([p]) => relativePosix(root, p)).sort(),
    },
    modes,
    modeRationale:
      modes.length > 1
        ? `custom properties are redeclared under ${medias.length} media quer${medias.length === 1 ? "y" : "ies"}, so those are real modes`
        : "every custom property is declared once at :root with no media-query or theme override, so a single mode is what the stylesheets support",
    typeScaling: {
      observable: true,
      noneScale: !typeScales,
      reason: typeScales
        ? `${[...typeNames].filter((n) => scaled.has(n)).length} font-size/line-height token(s) are redeclared under a media query`
        : "no font-size or line-height custom property is redeclared under any media query, so the token values themselves do not scale",
      roleLevelCaveat:
        "This measures the TOKENS. A component rule may still switch which token it uses at a breakpoint (`font-size: var(--text-2xl)` inside a media query), which is role-level scaling this source cannot see. Grep the consuming rules before concluding the type ramp is fixed.",
    },
    totals: {
      tokens: kept.length,
      base: kept.filter((t) => t["layer"] === "base").length,
      component: kept.filter((t) => t["layer"] === "component").length,
      shadowed: dupes.length,
      byFamily,
    },
    tokens: nonEmpty(kept, "no custom property could be read"),
    shadowed: dupes,
    problems,
  };
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
