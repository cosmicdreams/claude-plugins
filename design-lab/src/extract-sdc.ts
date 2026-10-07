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
            label: (v === null
              ? "None"
              : typeof v === "boolean"
                ? v
                  ? "True"
                  : "False"
                : String(v)
            )
              .replace(/[_-]/g, " ")
              .toLowerCase()
              .replace(/\b\w/g, (c) => c.toUpperCase()),
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
