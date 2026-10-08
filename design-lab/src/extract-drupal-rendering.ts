import { readdirSync, statSync } from "node:fs";
import {
  basename,
  dirname,
  extname,
  join,
  resolve,
  relative as rel,
  sep,
} from "node:path";
import { readText } from "./discovery-io.ts";
import { extractFile } from "./extract-sass-style-facts.ts";
import { validate } from "./contracts.ts";
import type { RenderEvidence } from "./generated/render-evidence.ts";
type Item = RenderEvidence["items"][string];
/** The slice of the component inventory this extractor reads. */
export interface RenderInventory {
  components?: { id: string; fields?: { name?: string }[]; slots?: { name?: string }[] }[];
}
const INC =
    /(?:include|embed)\s*\(\s*['"]([\w-]+):([\w-]+)['"]|\{%-?\s*(?:include|embed)\s+['"]([\w-]+):([\w-]+)['"]/g,
  ROOT = /\{%-?\s*embed\s+['"]([\w-]+:[\w-]+)['"]/,
  MARKUP = /<[a-zA-Z]/,
  FIELD = /\bfield_[a-z0-9_]+\b/g;
const walk = (d: string): string[] => {
  let entries;
  try {
    entries = readdirSync(d, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) =>
    e.isDirectory()
      ? walk(join(d, e.name))
      : e.isFile()
        ? [join(d, e.name)]
        : [],
  );
};
function rootClasses(body: string): string[] {
  const out: string[] = [];
  for (const rx of [
    /addClass\(\s*['"]([^'"]+)['"]/g,
    /class\s*=\s*['"]([^'"]+)['"]/g,
  ])
    for (const m of body.matchAll(rx))
      for (const x of m[1]!.split(/\s+/))
        if (x && !x.includes("{{") && !out.includes(x)) out.push(x);
  return out;
}
function rootSdc(body: string): string | null {
  const clean = body.replace(/\{#.*?#\}/gs, "");
  const m = ROOT.exec(clean);
  if (!m) return null;
  const markup = MARKUP.exec(clean);
  return !markup || m.index < markup.index ? m[1]! : null;
}
function ref(root: string, p: string) {
  return rel(root, p).split(sep).join("/");
}
export function extract(root: string, components: RenderInventory): RenderEvidence {
  const abs = resolve(root),
    themes = join(abs, "docroot/themes/custom"),
    files = walk(themes),
    twigs = files.filter((p) => p.endsWith(".html.twig")).sort(),
    defs = files.filter((p) => p.endsWith(".component.yml")).sort(),
    byKey = new Map(
      defs.map((p) => [basename(p).slice(0, -".component.yml".length), p]),
    ),
    items: RenderEvidence["items"] = {};
  for (const c of components.components || []) {
    const [kind, machine] = String(c.id).split(":", 2),
      slug = (machine || "").replaceAll("_", "-"),
      prefix = kind === "block" ? "block" : "paragraph",
      exact = `${prefix}--${slug}.html.twig`,
      qualified = `${prefix}--${slug}--`;
    let templates = twigs.filter(
      (p) => basename(p) === exact || basename(p).startsWith(qualified),
    );
    if (!templates.length)
      templates = twigs.filter(
        (p) =>
          basename(p).startsWith(prefix + "--") &&
          p.split(sep).slice(-2).includes(slug),
      );
    const genericName =
        kind === "block" ? "block.html.twig" : "paragraph.html.twig",
      generics = twigs.filter((p) => basename(p) === genericName),
      examined = templates.length ? templates : generics.slice(0, 1),
      bodies = examined.map(readText),
      refs: string[] = [];
    for (const body of bodies)
      for (const m of body.matchAll(INC)) {
        const value = `${m[1] || m[3]}:${m[2] || m[4]}`;
        if (!refs.includes(value)) refs.push(value);
      }
    const sdcFiles: string[] = [],
      styleFiles: string[] = [];
    for (const r of refs) {
      const p = byKey.get(r.split(":")[1]!);
      if (p) {
        sdcFiles.push(p);
        for (const suffix of [".scss", ".css"]) {
          const file = join(
            dirname(p),
            basename(p).slice(0, -".component.yml".length) + suffix,
          );
          if (files.includes(file)) styleFiles.push(file);
        }
      }
    }
    for (const p of files) {
      if (
        [".scss", ".css"].includes(extname(p)) &&
        basename(dirname(p)) === slug &&
        basename(p, extname(p)) === slug &&
        !styleFiles.includes(p)
      )
        styleFiles.push(p);
    }
    const declared = new Set([
        ...(c.fields || []).map((f) => f.name),
        ...(c.slots || []).map((s) => s.name),
      ]),
      referenced = [
        ...new Set(
          bodies.flatMap((b) => [...b.matchAll(FIELD)].map((m) => m[0])),
        ),
      ].sort(),
      missing = referenced.filter((n) => !declared.has(n)),
      classes = [...new Set(bodies.flatMap(rootClasses))],
      sass = styleFiles.filter((p) => p.endsWith(".scss")),
      styleFacts: Item["styleFacts"] = { rootRules: [], partRules: [], mediaQueries: 0 };
    const rootRules = (styleFacts.rootRules ??= []),
      partRules = (styleFacts.partRules ??= []);
    let mediaQueries = 0;
    for (const p of sass) {
      const f = extractFile(p);
      rootRules.push(...f.rootRules.map((r) => ({ ...r, sourceRef: ref(abs, p) })));
      partRules.push(...f.partRules.map((r) => ({ ...r, sourceRef: ref(abs, p) })));
      mediaQueries += f.mediaQueries;
    }
    styleFacts.mediaQueries = mediaQueries;
    items[c.id] = {
      templates: templates.map((p) => ref(abs, p)),
      genericTemplate:
        !templates.length && examined.length ? ref(abs, examined[0]!) : null,
      sdc: refs,
      sdcDefinitions: sdcFiles.map((p) => ref(abs, p)),
      stylesheets: [...new Set(styleFiles.map((p) => ref(abs, p)))].sort(),
      styleFacts,
      rootClasses: classes,
      rootSdc: templates.length
        ? bodies.map(rootSdc).find(Boolean) || null
        : null,
      referencedFields: referenced,
      defects: missing.map((name) => ({
        kind: "template-field-not-in-authoring-config",
        detail: `template references ${name}, absent from the bundle inventory`,
        evidence: examined.map((p) => ref(abs, p)),
      })),
      confidence:
        templates.length && (sdcFiles.length || styleFiles.length)
          ? "high"
          : templates.length
            ? "medium"
            : "low",
    };
  }
  const itemsArr = Object.values(items),
    document: RenderEvidence = {
      standardVersion: "3.0.0",
      generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
      source: { strategy: "drupal-render-evidence", root: abs },
      items,
      totals: {
        components: itemsArr.length,
        directTemplates: itemsArr.filter((i) => i.templates.length).length,
        sdcLinks: itemsArr.filter((i) => i.sdcDefinitions.length).length,
        styleLinks: itemsArr.filter((i) => i.stylesheets.length).length,
        defects: itemsArr.reduce((a, i) => a + i.defects.length, 0),
      },
      problems: [],
    };
  const errors = validate("render-evidence", document);
  if (errors.length)
    throw new Error("invalid render evidence: " + errors.join("; "));
  return document;
}
export { rootSdc, rootClasses };
