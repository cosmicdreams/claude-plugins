import { readFileSync } from "node:fs";
import type { RenderEvidence } from "./generated/render-evidence.ts";
export type StyleFacts = Required<RenderEvidence["items"][string]["styleFacts"]>;
export type StyleRule = Omit<StyleFacts["rootRules"][number], "sourceRef">;
export type Declaration = NonNullable<StyleRule["declarations"]>[number];
export const VISUAL_PROPERTIES = new Set([
  "display",
  "flex-direction",
  "gap",
  "grid-gap",
  "row-gap",
  "column-gap",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "max-width",
  "min-height",
  "width",
  "height",
  "background-color",
  "background",
  "color",
  "border-radius",
  "border",
  "border-bottom",
  "font-size",
  "line-height",
  "font-weight",
  "text-align",
  "box-shadow",
  "margin",
]);
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
export function blocks(text: string): Array<[number, string, string]> {
  const result: Array<[number, string, string]> = [],
    selector: string[] = [],
    stack: Array<[string, number, number]> = [];
  let depth = 0,
    quote = "",
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      escaped = c === "\\" && !escaped;
      if (c === quote && !escaped) quote = "";
      else if (c !== "\\") escaped = false;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      selector.push(c);
    } else if (c === "{") {
      stack.push([selector.join("").trim(), i + 1, depth]);
      selector.length = 0;
      depth++;
    } else if (c === "}") {
      depth--;
      const x = stack.pop();
      if (x) result.push([x[2], x[0], text.slice(x[1], i)]);
      selector.length = 0;
    } else if (c === ";") selector.length = 0;
    else selector.push(c);
  }
  return result;
}
export function ownDeclarations(body: string): Declaration[] {
  let depth = 0,
    current: string[] = [],
    quote = "",
    declarations: string[] = [];
  for (const c of body) {
    if (quote) {
      current.push(c);
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      if (depth === 0) current.push(c);
    } else if (c === "{") {
      if (depth === 0) current = [];
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) current = [];
    } else if (depth === 0) {
      current.push(c);
      if (c === ";") {
        declarations.push(current.join(""));
        current = [];
      }
    }
  }
  if (current.length) declarations.push(current.join(""));
  const out: Declaration[] = [];
  for (const s of declarations) {
    const v = s.trim().replace(/;$/, "").trim();
    if (!v || !v.includes(":") || v.startsWith("//") || v.startsWith("@"))
      continue;
    const [name, ...rest] = v.split(":");
    const raw = rest.join(":").trim(),
      key = name!.trim();
    if (!VISUAL_PROPERTIES.has(key) && !key.startsWith("--")) continue;
    out.push({
      property: key,
      value: raw,
      resolution: raw.includes("var(--")
        ? "css-custom-property"
        : raw.includes("$")
          ? "sass-variable"
          : "literal",
    });
  }
  return out;
}
export function extractFile(path: string): StyleFacts {
  const text = stripComments(readFileSync(path, "utf8")),
    rootRules: StyleRule[] = [],
    partRules: StyleRule[] = [];
  for (const [depth, selector, body] of blocks(text)) {
    const declarations = ownDeclarations(body);
    if (declarations.length)
      (depth === 0 ? rootRules : partRules).push({ selector, declarations });
  }
  return {
    rootRules,
    partRules,
    mediaQueries: (text.match(/@include\s+media-breakpoint|@media\b/g) || [])
      .length,
  };
}
export const extract = extractFile;
