/** Extract the Site Studio website settings palette and custom-style modes. */
import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pluginRoot } from "./runtime.ts";
import { configDir as discoverConfigDir } from "./sitestudio-source.ts";
import { loadJsonValues } from "./extract-sitestudio.ts";

const STANDARD_VERSION = "3.0.0";
const BREAKPOINTS = ["xxl", "xl", "lg", "md", "sm", "xs"];
const COLOR_PROPS = new Set([
  "color",
  "background-color",
  "border-color",
  "fill",
]);
const SPACE_PROPS = new Set([
  "padding",
  "margin",
  "gap",
  "row-gap",
  "column-gap",
]);
const TYPE_PROPS = new Set([
  "font-size",
  "line-height",
  "font-family",
  "font-weight",
  "letter-spacing",
]);
type JsonObject = Record<string, any>;
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
function scalar(text: string, key: string): string | null {
  const m = new RegExp(
    `^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: (.+)$`,
    "m",
  ).exec(text);
  return m?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? null;
}
function flatten(value: any): any {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of ["rgba", "hex", "value"])
      if (key in value) return flatten(value[key]);
    return null;
  }
  // baseline treats bool as an int in flatten(), so authored false values remain rows.
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : null;
}
function rgbaToHex(value: unknown): string | null {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(String(value));
  return m
    ? "#" +
        m
          .slice(1, 4)
          .map((v) => Number(v).toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase()
    : null;
}
export function* walkProps(node: any, prefix = ""): Generator<[string, any]> {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const name = prefix ? `${prefix}-${key}` : key,
      flat = flatten(value);
    if (flat !== null && typeof flat !== "object") yield [name, flat];
    else if (value && typeof value === "object") yield* walkProps(value, name);
  }
}
export function cascade(
  perBreakpoint: Record<string, any>,
  order: string[],
): Record<string, any> {
  const out: Record<string, any> = {};
  let last: any = null;
  for (const bp of order) {
    if (bp in perBreakpoint) last = perBreakpoint[bp];
    out[bp] = last;
  }
  return out;
}
function yamlFiles(cfg: string, prefix: string): string[] {
  return readdirSync(cfg)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".yml"))
    .sort()
    .map((name) => resolve(cfg, name));
}
function readEntity(path: string): [JsonObject | null, string] {
  const [value, text] = loadJsonValues(path) as [JsonObject | null, string];
  return [value && typeof value === "object" ? value : null, text];
}
function palette(cfg: string): JsonObject[] {
  const out: JsonObject[] = [];
  for (const path of yamlFiles(
    cfg,
    "cohesion_website_settings.cohesion_color.",
  )) {
    const [jv, text] = readEntity(path);
    if (!jv) continue;
    const first = flatten(jv["value"]?.["value"] ?? {}),
      hex =
        typeof first === "string" && first.startsWith("#")
          ? first
          : rgbaToHex(flatten(jv["value"]));
    out.push({
      name: jv["name"] ?? scalar(text, "label"),
      uid: jv["uid"],
      hex: (hex ?? "").toUpperCase() || null,
      codeName: jv["variable"],
      className: jv["class"],
      tags: (jv["tags"] ?? [])
        .filter((tag: any) => tag && typeof tag === "object")
        .map((tag: any) => tag["value"]),
      inUse: Boolean(jv["inuse"]),
      provenance: { kind: "config", ref: basename(path) },
    });
  }
  return out;
}
function fontStacks(cfg: string): JsonObject[] {
  const out: JsonObject[] = [];
  for (const path of yamlFiles(
    cfg,
    "cohesion_website_settings.cohesion_font_stack.",
  )) {
    const [jv, text] = readEntity(path);
    if (!jv) continue;
    const stack = jv["fontStack"] ?? "";
    out.push({
      name: jv["name"] ?? scalar(text, "label"),
      uid: jv["uid"],
      stack,
      primaryFamily: String(stack)
        .split(",")[0]!
        .trim()
        .replace(/^['"]|['"]$/g, ""),
      codeName: jv["variable"],
      systemFont: Boolean(jv["systemfont"]),
      inUse: Boolean(jv["inuse"]),
      provenance: { kind: "config", ref: basename(path) },
    });
  }
  return out;
}
function scssVariables(cfg: string): JsonObject[] {
  const out: JsonObject[] = [];
  for (const path of yamlFiles(
    cfg,
    "cohesion_website_settings.cohesion_scss_variable.",
  )) {
    const [jv, text] = readEntity(path);
    if (!jv) continue;
    const uid = jv["uid"] ?? scalar(text, "id");
    out.push({
      name: jv["name"] ?? uid ?? scalar(text, "id"),
      uid,
      value: flatten(jv["value"]),
      codeName: "$" + (uid ?? ""),
      inUse: Boolean(jv["inuse"]),
      provenance: { kind: "config", ref: basename(path) },
    });
  }
  return out;
}
function customStyles(cfg: string): {
  order: string[];
  rows: JsonObject[];
  count: number;
} {
  const files = yamlFiles(cfg, "cohesion_custom_styles.cohesion_custom_style."),
    parsed: [string, JsonObject | null, string][] = [],
    seen = new Set<string>();
  for (const path of files) {
    const [jv, text] = readEntity(path);
    if (jv)
      for (const bp of Object.keys(jv["styles"]?.["styles"] ?? {}))
        seen.add(bp);
    parsed.push([path, jv, text]);
  }
  const order = BREAKPOINTS.filter((bp) => seen.has(bp));
  if (!order.length) order.push("xl");
  const rows: JsonObject[] = [];
  for (const [path, jv, text] of parsed) {
    if (!jv) continue;
    const label = scalar(text, "label"),
      klass = scalar(text, "class_name"),
      styles = jv["styles"]?.["styles"] ?? {},
      collected: Record<string, Record<string, any>> = {};
    for (const [bp, tree] of Object.entries(styles))
      for (const [prop, value] of walkProps(tree))
        (collected[prop] ??= {})[bp] = value;
    for (const [prop, perBp] of Object.entries(collected)) {
      const rootProp =
        (prop.match(/-/g)?.length ?? 0) > 2 ? prop.split("-").at(-1)! : prop;
      const family =
        COLOR_PROPS.has(prop) || COLOR_PROPS.has(rootProp)
          ? "color"
          : (prop.split("-")[0] &&
                ["padding", "margin"].includes(prop.split("-")[0]!)) ||
              SPACE_PROPS.has(prop)
            ? "spacing"
            : TYPE_PROPS.has(prop) || TYPE_PROPS.has(rootProp)
              ? "type"
              : "other";
      rows.push({
        name: label,
        codeName: klass,
        property: prop,
        family,
        valuesByBreakpoint: cascade(perBp, order),
        provenance: { kind: "config", ref: basename(path) },
      });
    }
  }
  return { order, rows, count: files.length };
}
export function extract(
  rootInput: string,
  configDir?: string,
): Record<string, unknown> {
  const root = resolve(rootInput),
    selected = configDir
      ? { path: resolve(configDir) }
      : discoverConfigDir(root);
  const cfg = selected.path;
  if (!cfg)
    throw new Error(
      `no Site Studio configuration folder is declared for ${root}; give it as the second argument`,
    );
  const colors = palette(cfg),
    fonts = fontStacks(cfg),
    scss = scssVariables(cfg),
    { order, rows: styles, count } = customStyles(cfg);
  const sizes = styles.filter((style) => style["property"] === "font-size");
  const scaling = sizes.filter(
    (style) =>
      new Set(
        Object.values(style["valuesByBreakpoint"] as JsonObject).map(String),
      ).size > 1,
  );
  return {
    standardVersion: STANDARD_VERSION,
    toolVersion: toolVersion(),
    generatedAt: new Date().toISOString(),
    source: {
      strategy: "sitestudio-website-settings",
      root,
      configDir: cfg,
      entities: {
        colors: colors.length,
        fontStacks: fonts.length,
        scssVariables: scss.length,
        customStyles: count,
      },
    },
    modes: order,
    colors,
    fontStacks: fonts,
    scssVariables: scss,
    customStyles: styles,
    typeScaling: {
      fontSizeTokens: sizes.length,
      scaling: scaling.length,
      noneScale: !scaling.length,
    },
  };
}
