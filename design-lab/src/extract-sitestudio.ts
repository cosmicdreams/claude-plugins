import {
  basename,
  dirname,
  join,
  resolve,
  relative as rel,
  sep,
} from "node:path";
import { readdirSync } from "node:fs";
import { readText } from "./discovery-io.ts";
import {
  configDir,
  customComponents,
  customComponentId,
} from "./sitestudio-source.ts";
import { toolVersion } from "./figma-receipts.ts";
const KIND: Record<string, string> = {
  cohTextBox: "text",
  cohWysiwyg: "richtext",
  cohTextarea: "text",
  cohSelect: "enum",
  checkboxToggle: "boolean",
  cohColourPickerOpener: "color",
  cohFileBrowser: "media",
  cohRange: "number",
  cohTypeahead: "reference",
  cohHidden: "hidden",
  cohHelpText: "help",
  cohArray: "array",
  "": "text",
};
export function loadJsonValues(path: string): [any | null, string] {
  const txt = readText(path),
    q = /^json_values: '(.*?)'\n[a-z_]+:/ms.exec(txt),
    b = /^json_values: \|[-+]?\n((?:(?:[ ]+.*)?\n)+)/m.exec(txt);
  let payload: string;
  if (q) payload = q[1]!.replace(/''/g, "'");
  else if (b) {
    const lines = b[1]!.split("\n"),
      nonempty = lines.filter((x) => x.trim()),
      indent = nonempty.length
        ? Math.min(...nonempty.map((x) => x.length - x.trimStart().length))
        : 0;
    payload = lines.map((x) => x.slice(indent)).join("\n");
  } else return [null, txt];
  try {
    return [JSON.parse(payload), txt];
  } catch {
    return [null, txt];
  }
}
function scalar(text: string, key: string): string | null {
  const m = new RegExp(
    "^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ": (.+)$",
    "m",
  ).exec(text);
  return m?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? null;
}
function tokenFamily(values: any[]): string | null {
  const families = new Set<string>();
  for (const v of values) {
    const x = String(v);
    let m: RegExpMatchArray | null;
    if ((m = x.match(/^coh-style-(padding|margin|spacing)/)))
      families.add("spacing");
    else if (/^coh-style-color-scheme/.test(x)) families.add("color-scheme");
    else if (/^coh-style-(multi-column|boxed-width|fluid)/.test(x))
      families.add("layout");
    else if (/^coh-style-text-color/.test(x)) families.add("color");
    else families.add("other");
  }
  if (families.size > 1) families.delete("other");
  return families.size === 1 ? [...families][0]! : null;
}
function componentModel(jv: any, txt: string, path: string, root: string): any {
  const model = jv.model || {},
    fields: any[] = [],
    declared = new Set<string>(),
    referenced = new Set(
      (JSON.stringify(jv).match(/\[field\.([0-9a-f-]{36})\]/g) || []).map((x) =>
        x.slice(7, -1),
      ),
    );
  for (const [uid, v] of Object.entries(model) as [string, any][]) {
    if (!v || typeof v !== "object") continue;
    const s = v.settings || {},
      mn = s.machineName;
    if (!mn) continue;
    declared.add(uid);
    const opts = (Array.isArray(s.options) ? s.options : [])
      .filter((o: any) => o && typeof o === "object" && "label" in o)
      .map((o: any) => ({ value: o.value, label: o.label }));
    let d = v.model?.value;
    if (d && typeof d === "object") d = d.text || d.name || d.value;
    if (d && typeof d === "object") d = d.hex;
    const tv = opts
      .map((o: any) => o.value)
      .filter((x: any) => x && /^coh-style-/.test(String(x)));
    fields.push({
      name: mn,
      label: s.title ?? null,
      kind: KIND[s.type] || "text",
      sourceWidget: s.type ?? null,
      required: !!s.required,
      default: d === "" || JSON.stringify(d) === "{}" ? null : (d ?? null),
      options: opts.length ? opts : null,
      showWhen: s.showCondition ?? null,
      tokenFamily: tv.length ? tokenFamily(tv) : null,
      uid,
    });
  }
  const byUid = new Map(fields.map((f) => [f.uid, f]));
  const form = (nodes: any[], owner?: string) => {
    for (const node of nodes || []) {
      const f = byUid.get(node.uuid);
      let next = owner;
      if (f) {
        if (owner) f.repeatableIn = owner;
        if (f.kind === "array") {
          f.minItems = model[f.uid]?.settings?.min ?? null;
          f.maxItems = model[f.uid]?.settings?.max ?? null;
          next = f.name;
        }
      }
      form(node.children, next);
    }
  };
  form(jv.componentForm);
  const defects: any[] = [];
  for (const uid of [...referenced].filter((x) => !declared.has(x)).sort()) {
    defects.push({
      kind: "dangling-field-ref",
      detail: `references field ${uid} (removed) which is not in the component form`,
      evidence: "present in meta.fieldHistory only",
    });
  }
  const cond = new Map<string, string[]>();
  for (const f of fields)
    if (f.showWhen && f.kind === "hidden")
      cond.set(f.showWhen, [...(cond.get(f.showWhen) || []), f.name]);
  for (const [c, n] of cond)
    if (n.length > 1)
      defects.push({
        kind: "duplicate-show-condition",
        detail: `fields ${n.join(", ")} share an identical show condition`,
        evidence: c.slice(0, 160),
      });
  const blob = JSON.stringify(jv.canvas || []),
    n = blob.includes("drop-zone") ? 1 : 0,
    slots = Array.from({ length: n }, () => ({
      name: "content",
      label: "Component drop zone",
      accepts: ["*"],
    }));
  return {
    id: scalar(txt, "id") || basename(path).split(".").at(-2),
    label: scalar(txt, "label"),
    group: scalar(txt, "category"),
    sourceRef: rel(root, path).split(sep).join("/"),
    fields,
    slots,
    usage: null,
    defects,
  };
}
function extractComponent(
  path: string,
  root: string,
): [any | null, any | null] {
  const [jv, txt] = loadJsonValues(path);
  if (jv === null)
    return [null, { kind: "unparseable", detail: rel(root, path) }];
  return [componentModel(jv, txt, path, root), null];
}
function customComponent(path: string, root: string): [any | null, any | null] {
  const txt = readText(path),
    form = scalar(txt, "form");
  let payload: any = {};
  if (form) {
    try {
      payload = JSON.parse(readText(join(dirname(path), form)));
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        ("model" in payload &&
          (!payload.model ||
            typeof payload.model !== "object" ||
            Array.isArray(payload.model)))
      )
        throw new Error("form must contain a model object");
    } catch (e) {
      return [
        null,
        {
          kind: "unparseable-custom-component",
          detail: rel(root, path) + ": " + String(e).replace(/^Error: /, ""),
        },
      ];
    }
  }
  const c = componentModel(payload, txt, path, root);
  c.id = customComponentId(path);
  c.label = scalar(txt, "name") || c.id;
  c.isCustomComponent = true;
  return [c, null];
}
const FROM_SETTINGS = Symbol("from-settings");
export function extract(
  root: string,
  config?: string | null | typeof FROM_SETTINGS,
): any {
  const abs = resolve(root),
    folder =
      config === undefined || config === FROM_SETTINGS
        ? configDir(abs).path
        : config,
    files = folder
      ? (() => {
          try {
            return readdirSync(folder)
              .filter((n) =>
                /^cohesion_elements\.cohesion_component\..*\.yml$/.test(n),
              )
              .sort()
              .map((n) => join(folder, n));
          } catch {
            return [];
          }
        })()
      : [],
    components: any[] = [],
    problems: any[] = [];
  for (const p of files) {
    const [c, e] = extractComponent(p, abs);
    if (c) components.push(c);
    if (e) problems.push(e);
  }
  const [custom, discovery] = customComponents(abs);
  problems.push(...discovery);
  for (const p of custom) {
    const [c, e] = customComponent(p, abs);
    if (c) components.push(c);
    if (e) problems.push(e);
  }
  return {
    standardVersion: "3.0.0",
    toolVersion: toolVersion(),
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
    source: { strategy: "sitestudio", root: abs, configDir: folder ?? null },
    components,
    problems,
  };
}
