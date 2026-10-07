/** Count published Canvas page placements and configured content-template nodes (port of extract_canvas_usage.ts). */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { validate, writeJson } from "./contracts.ts";
import { configSync, docroot } from "./detect.ts";
import type { Dict } from "./discovery-io.ts";
import { load } from "./extract-sdc.ts";
import { toolVersion } from "./figma-receipts.ts";
import {
  TIERS,
  compareStrings,
  describeProject,
  mergeUsage,
  now,
  resolveReal,
  spawnRunner,
  splitlines,
  truthy,
  usageTier,
} from "./extract-drupal-usage.ts";
import type { Runner } from "./extract-drupal-usage.ts";

export const PLACEMENTS_SQL = `
SELECT c.bundle, c.deleted, c.entity_id, c.revision_id, c.langcode, c.delta,
       IFNULL(c.components_parent_uuid,''), IFNULL(c.components_slot,''),
       c.components_uuid, c.components_component_id, c.components_component_version,
       REPLACE(REPLACE(IFNULL(c.components_inputs,''), CHAR(10), ' '), CHAR(9), ' '),
       IFNULL(c.components_label,'')
FROM canvas_page__components c
JOIN canvas_page_field_data p ON p.id=c.entity_id
 AND p.revision_id=c.revision_id AND p.langcode=c.langcode
WHERE c.deleted=0 AND p.status=1;
`;
export const PAGES_SQL =
  "SELECT DISTINCT id, revision_id FROM canvas_page_field_data WHERE status=1;";
export const ALIASES_SQL = `
SELECT path, alias FROM path_alias WHERE status=1
 AND langcode IN ('en','und') AND path REGEXP '^/page/[0-9]+$';
`;
const TWIG_SDC = /\{%\s*(?:include|embed|source)\s+['"]([^:'"]+):([^'"]+)['"]/g;

export type TwigRef = { file: string; line: number; global: boolean };
export type CanvasRows = {
  placements?: string[][];
  pages?: string[][];
  aliases?: string[][];
  templates?: string[][];
  twig_refs?: Record<string, unknown[]>;
};

/** Drush sqlq emits headerless tab-separated rows, including empty columns. */
export function parseSqlqRows(output: string, columns: number): string[][] {
  const rows: string[][] = [];
  splitlines(output).forEach((line, index) => {
    if (!line.trim()) return;
    const row = line.replace(/\r+$/, "").split("\t");
    if (row.length !== columns)
      throw new Error(
        `sqlq row ${index + 1}: expected ${columns} columns, got ${row.length}`,
      );
    rows.push(row);
  });
  return rows;
}

export function sqlqRows(
  root: string,
  sql: string,
  columns: number,
  run: Runner = spawnRunner,
): string[][] {
  const result = run("ddev", ["drush", "sqlq", sql.trim()], root);
  if (result.status !== 0)
    throw new Error("DDEV database query failed: " + result.stderr.trim());
  return parseSqlqRows(result.stdout, columns);
}

/** baseline's Path ordering compares path segments, not the joined string. */
export function comparePaths(a: string, b: string): number {
  const left = a.split(sep),
    right = b.split(sep);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const order = compareStrings(left[i]!, right[i]!);
    if (order) return order;
  }
  return left.length - right.length;
}
function twigFiles(folder: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".twig")) found.push(path);
    }
  };
  visit(folder);
  return found;
}

/** Find literal SDC references in the active theme's Twig files. */
export function scanThemeTemplates(
  root: string,
  components: Dict,
): Record<string, TwigRef[]> {
  const web = docroot(root);
  const names = new Set<string>(
    (components["components"] || [])
      .map((component: Dict) => component["sourceSdcId"])
      .filter(Boolean),
  );
  const providers = new Set(
    [...names]
      .filter((name) => name.includes(":"))
      .map((name) => name.split(":", 1)[0]!),
  );
  const refs: Record<string, TwigRef[]> = {};
  for (const provider of [...providers].sort(compareStrings)) {
    const theme = join(web, "themes", "custom", provider);
    const paths = [
      ...twigFiles(join(theme, "templates")),
      ...twigFiles(join(theme, "components")),
    ].sort(comparePaths);
    for (const path of paths) {
      const file = relative(root, path).split(sep).join("/"),
        themeRelative = relative(theme, path).split(sep).join("/");
      const globalTemplate =
        /^templates\/(?:layout\/page[^/]*\.html\.twig|(?:[^/]+\/)?html\.html\.twig|(?:[^/]+\/)?region--[^/]*\.html\.twig)$/.test(
          themeRelative,
        );
      splitlines(readFileSync(path, "utf8")).forEach((line, index) => {
        for (const match of line.matchAll(TWIG_SDC)) {
          const sdcId = match[1] + ":" + match[2];
          if (names.has(sdcId))
            (refs[sdcId] ??= []).push({
              file,
              line: index + 1,
              global: globalTemplate,
            });
        }
      });
    }
  }
  return refs;
}

/** Thin DDEV layer; buildUsage accepts plain rows and needs no database. */
export function collectRows(
  ddevRoot: string,
  project?: string | null,
  run: Runner = spawnRunner,
): Required<Pick<CanvasRows, "placements" | "pages" | "aliases">> {
  const root = resolveReal(ddevRoot);
  describeProject(root, project, run);
  return {
    placements: sqlqRows(root, PLACEMENTS_SQL, 13, run),
    pages: sqlqRows(root, PAGES_SQL, 2, run),
    aliases: sqlqRows(root, ALIASES_SQL, 2, run),
  };
}

export function templateRows(root: string): string[][] {
  const config = configSync(root);
  if (!config) return [];
  const rows: string[][] = [];
  const files = readdirSync(config)
    .filter((name) => /^canvas\.content_template\..*\.yml$/.test(name))
    .sort(compareStrings);
  for (const name of files) {
    const path = join(config, name),
      data = load(path);
    if (data["status"] === false) continue;
    const entries = truthy(data["component_tree"])
      ? data["component_tree"]
      : {};
    for (const entry of Object.values<any>(entries)) {
      if (
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        truthy(entry["component_id"])
      )
        rows.push([
          entry["component_id"],
          data["id"],
          data["content_entity_type_bundle"],
          relative(root, path).split(sep).join("/"),
        ]);
    }
  }
  return rows;
}

/** Pure row reducer. `rows` contains query and content-template fixture rows. */
export function buildUsage(
  components: Dict,
  rows: CanvasRows,
  source: Dict,
): Dict {
  const inventory: Dict[] = components["components"] || [],
    ids = new Set(inventory.map((component) => component["id"]));
  const aliases = new Map(
    (rows.aliases ?? []).map(([path, alias]) => [path!, alias!]),
  );
  const twigRefs = rows.twig_refs ?? {};
  const usage = new Map<string, Dict>(),
    pages = new Map<string, Set<string>>();
  const entry = (id: string): Dict => {
    let value = usage.get(id);
    if (!value) {
      value = {
        placements: 0,
        structuralRefs: 0,
        templatePlacements: 0,
        pages: 0,
        exampleCandidates: [],
        templateBundles: [],
        templateRefs: [],
      };
      usage.set(id, value);
    }
    return value;
  };
  const pagesOf = (id: string): Set<string> => {
    let found = pages.get(id);
    if (!found) {
      found = new Set();
      pages.set(id, found);
    }
    return found;
  };
  for (const row of rows.placements ?? []) {
    if (row.length < 13)
      throw new Error("Canvas placement row has fewer than 13 columns");
    const [, deleted, pageId, , , , parent, , , componentId] = row;
    if (deleted !== "0") continue;
    entry(componentId!)[parent ? "structuralRefs" : "placements"] += 1;
    pagesOf(componentId!).add(pageId!);
  }
  for (const [componentId, , bundle, reference] of rows.templates ?? []) {
    const value = entry(componentId!);
    value["placements"] += 1;
    value["templatePlacements"] += 1;
    if (!value["templateBundles"].includes(bundle))
      value["templateBundles"].push(bundle);
    if (!value["templateRefs"].includes(reference))
      value["templateRefs"].push(reference);
  }
  const numeric = (text: string): boolean => /^\d+$/.test(text);
  for (const component of inventory) {
    const id: string = component["id"],
      value = entry(id),
      pageIds = [...pagesOf(id)];
    value["pages"] = pageIds.length;
    pageIds.sort((a, b) =>
      numeric(a) && numeric(b)
        ? Number(a) - Number(b)
        : numeric(a)
          ? -1
          : numeric(b)
            ? 1
            : compareStrings(a, b),
    );
    value["exampleCandidates"] = pageIds
      .slice(0, 3)
      .map((item) => aliases.get("/page/" + item) ?? "/page/" + item);
    const sdc: string | undefined = component["sourceSdcId"];
    for (const reference of sdc !== undefined && Object.hasOwn(twigRefs, sdc)
      ? twigRefs[sdc]!
      : [])
      if (
        !value["templateRefs"].some((have: unknown) =>
          isDeepStrictEqual(have, reference),
        )
      )
        value["templateRefs"].push(reference);
    value["globalTemplate"] = value["templateRefs"].some(
      (ref: any) =>
        ref &&
        typeof ref === "object" &&
        !Array.isArray(ref) &&
        truthy(ref["global"]),
    );
  }
  const extra = [...usage.keys()]
    .filter((id) => !ids.has(id))
    .sort(compareStrings);
  const problems = extra.length
    ? [
        {
          check: "component-in-placements-not-in-inventory",
          detail: "Canvas contains components absent from the inventory",
          evidence: extra,
        },
      ]
    : [];
  const document: Dict = {
    standardVersion: "3.0.0",
    toolVersion: toolVersion(),
    generatedAt: now(),
    source: {
      ...source,
      strategy: "canvas-db",
      scope: "published Canvas pages, current revisions and content templates",
      definitions: {
        placements: "top-level page placements plus template nodes",
        structuralRefs: "nested page placements",
        templatePlacements: "one per content-template tree entry",
      },
      population: {
        publishedPages: (rows.pages ?? []).length,
        pagePlacementRows: (rows.placements ?? []).length,
        templateNodes: (rows.templates ?? []).length,
      },
    },
    usage: Object.fromEntries(
      [...usage].sort((a, b) => compareStrings(a[0], b[0])),
    ),
    problems,
  };
  const errors = validate("usage", document);
  if (errors.length)
    throw new Error("invalid Canvas usage: " + errors.join("; "));
  return document;
}

export function extract(
  ddevRoot: string,
  components: Dict,
  project?: string | null,
  run: Runner = spawnRunner,
): Dict {
  const root = resolveReal(ddevRoot),
    rows: CanvasRows = collectRows(root, project, run);
  rows.templates = templateRows(root);
  rows.twig_refs = scanThemeTemplates(root, components);
  return buildUsage(components, rows, {
    approot: root,
    ddevProject: project ?? null,
  });
}

export function mergeCanvasUsage(
  components: Dict,
  document: Dict,
  high = 50,
  medium = 10,
): Dict {
  const merged = mergeUsage(components, document, high, medium);
  for (const component of merged["components"]) {
    const evidence: Dict = component["usage"];
    evidence["structuralReferences"] = evidence["structuralRefs"];
    evidence["source"] = "canvas-db";
    let tier: string;
    if (evidence["globalTemplate"]) {
      tier = TIERS.high;
      evidence["tierReason"] = "referenced by a global theme template";
    } else if (truthy(evidence["templateRefs"]) || evidence["renderedPages"]) {
      tier = usageTier(
        evidence["placements"],
        Math.max(1, evidence["structuralRefs"]),
        high,
        medium,
      );
      evidence["tierReason"] = truthy(evidence["templateRefs"])
        ? "referenced by a theme or content template"
        : "observed on a public rendered page";
    } else tier = evidence["tier"];
    evidence["tier"] = tier;
    component["category"] = tier;
  }
  return merged;
}

export function main(argv = process.argv.slice(2)): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "ddev-root": { type: "string" },
      "ddev-project": { type: "string" },
      output: { type: "string" },
      "merge-components": { type: "string" },
      high: { type: "string", default: "50" },
      medium: { type: "string", default: "10" },
    },
  });
  if (!positionals[0] || !values["ddev-root"] || !values.output)
    throw new Error(
      "usage: extract-canvas-usage.ts COMPONENTS --ddev-root DIR --output FILE [--ddev-project NAME] [--merge-components FILE]",
    );
  const components: Dict = JSON.parse(readFileSync(positionals[0], "utf8"));
  const document = extract(
    values["ddev-root"],
    components,
    values["ddev-project"],
  );
  writeJson(values.output, document);
  if (values["merge-components"])
    writeJson(
      values["merge-components"],
      mergeCanvasUsage(
        components,
        document,
        Number(values.high),
        Number(values.medium),
      ),
    );
  const entries = Object.values<Dict>(document["usage"]),
    total = (key: string): number =>
      entries.reduce((sum, value) => sum + value[key], 0);
  console.log(
    JSON.stringify({
      components: entries.length,
      publishedPages: document["source"]["population"]["publishedPages"],
      placements: total("placements"),
      structuralRefs: total("structuralRefs"),
    }),
  );
}

if (import.meta.main) await main();
