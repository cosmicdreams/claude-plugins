import { basename, resolve } from "node:path";
import { loadYaml, relative, walk } from "./discovery-io.ts";
import { toolVersion } from "./figma-receipts.ts";
export const KIND: Record<string, string> = {
  string: "text",
  number: "number",
  integer: "number",
  boolean: "boolean",
  object: "reference",
  array: "array",
};
/** Titlecase for the characters where the uppercase mapping is not the title mapping. */
const TITLECASE: Record<string, string> = {
  "Ǆ": "ǅ", "ǅ": "ǅ", "ǆ": "ǅ", "Ǉ": "ǈ", "ǈ": "ǈ", "ǉ": "ǈ",
  "Ǌ": "ǋ", "ǋ": "ǋ", "ǌ": "ǋ", "Ǳ": "ǲ", "ǲ": "ǲ", "ǳ": "ǲ", "ŉ": "ʼN",
};
/** Python's str.title(): a letter is titlecased after an uncased character and lowercased after
 * a cased one, so "123abc" becomes "123Abc" and "don't" becomes "Don'T". Greek capital sigma
 * takes its final form at the end of a word, as Python's lowercasing does. */
export function pyTitle(text: string): string {
  const chars = [...text];
  let previousCased = false, out = "";
  chars.forEach((ch, i) => {
    const mapped = !previousCased
      ? titlecase(ch)
      : ch === "Σ" && isFinalSigma(chars, i)
        ? "ς"
        : ch.toLowerCase();
    out += mapped;
    previousCased = /\p{Cased}/u.test(ch);
  });
  return out;
}
function titlecase(ch: string): string {
  if (TITLECASE[ch]) return TITLECASE[ch];
  const upper = ch.toUpperCase();
  return upper.length > 1 ? upper[0] + upper.slice(1).toLowerCase() : upper;
}
/** Unicode Final_Sigma: a cased letter before, no cased letter after, ignoring case-ignorable marks. */
function isFinalSigma(chars: string[], i: number): boolean {
  let before = i - 1;
  while (before >= 0 && /\p{Case_Ignorable}/u.test(chars[before]!)) before--;
  if (before < 0 || !/\p{Cased}/u.test(chars[before]!)) return false;
  let after = i + 1;
  while (after < chars.length && /\p{Case_Ignorable}/u.test(chars[after]!)) after++;
  return !(after < chars.length && /\p{Cased}/u.test(chars[after]!));
}
export function load(path: string): any {
  return loadYaml(path);
}
export function extractComponent(path: string, root: string): any {
  const data = load(path);
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error(`${path} did not parse to a mapping`);
  const props = data.props?.properties ?? {},
    required = data.props?.required ?? [];
  const fields = Object.entries(props).flatMap(([name, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const spec = raw as any,
      opts = Array.isArray(spec.enum)
        ? spec.enum.map((v: any) => ({
            value: v,
            label: pyTitle(
              (v === null
                ? "None"
                : typeof v === "boolean"
                  ? v
                    ? "True"
                    : "False"
                  : String(v)
              ).replace(/[_-]/g, " "),
            ),
          }))
        : null;
    return [
      {
        name,
        label: spec.label || spec.title || name,
        kind: opts?.length ? "enum" : KIND[spec.type] || "text",
        sourceWidget: spec.type ?? null,
        required: required.includes(name) || false,
        default: spec.default ?? null,
        options: opts,
        showWhen: null,
        tokenFamily: null,
        uid: name,
      },
    ];
  });
  const slots = Object.entries(data.slots ?? {}).map(([name, raw]) => ({
    name,
    label: raw && typeof raw === "object" ? ((raw as any).title ?? null) : name,
    accepts: ["*"],
  }));
  return {
    id: basename(path).replace(/\.component\.yml$/, ""),
    label: data.name ?? null,
    description: data.description ?? null,
    group: data.group ?? null,
    sourceRef: relative(root, path),
    fields,
    slots,
    usage: null,
    defects: [],
    status: data.status ?? null,
  };
}
export function extract(root: string): any {
  const abs = resolve(root);
  const files = walk(abs).filter((f) => f.endsWith(".component.yml")),
    components: any[] = [],
    problems: any[] = [];
  for (const file of files)
    try {
      components.push(extractComponent(file, abs));
    } catch (e) {
      problems.push({ kind: "unparseable", detail: String(e).slice(0, 300) });
    }
  return {
    standardVersion: "3.0.0",
    toolVersion: toolVersion(),
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
    source: { strategy: "sdc", root: abs, parser: "pyyaml" },
    components,
    problems,
  };
}
