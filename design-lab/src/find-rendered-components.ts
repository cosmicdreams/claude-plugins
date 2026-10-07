/** Find Drupal SDC markers on a bounded set of anonymous public pages (port of find_rendered_components.ts). */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { writeJson } from "./contracts.ts";
import type { Dict } from "./discovery-io.ts";
import { sqlqRows } from "./extract-canvas-usage.ts";
import {
  compareStrings,
  httpGet,
  mapLimit,
  resolveReal,
  urljoin,
} from "./extract-drupal-usage.ts";
import type { Runner } from "./extract-drupal-usage.ts";
import { parseHtml } from "./html-parser.ts";

export const ALIASES_SQL = `SELECT path, alias FROM path_alias WHERE status=1
AND langcode IN ('en','und') AND path REGEXP '^/(page|node)/[0-9]+$';`;

/** A fetched page: [path, HTTP status (0 when unreachable), HTML]. */
export type Page = [path: string, status: number, html: string];

/** Return component instance counts from a single HTML document. */
export function parseComponents(html: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const seen = (attrs: Array<[string, string | null]>): void => {
    for (const [key, value] of attrs)
      if (key === "data-component-id" && value)
        counts[value] = (counts[value] ?? 0) + 1;
  };
  parseHtml(html, {
    starttag: (_tag, attrs) => seen(attrs),
    startendtag: (_tag, attrs) => seen(attrs),
    endtag() {},
    data() {},
  });
  return counts;
}

/** Take every Canvas alias first, then a deterministic node alias sample. */
export function publicPaths(aliasRows: string[][], limit = 60): string[] {
  if (limit < 1) throw new Error("path limit must be positive");
  const selected = new Map<string, string>();
  for (const [source, alias] of aliasRows)
    if (
      /^\/(page|node)\/[0-9]+$/.test(source!) &&
      alias!.startsWith("/") &&
      !selected.has(source!)
    )
      selected.set(source!, alias!);
  const order = (source: string): number =>
    Number(source.slice(source.lastIndexOf("/") + 1));
  const by = (a: string, b: string): number =>
    order(a) - order(b) || compareStrings(selected.get(a)!, selected.get(b)!);
  const canvas = [...selected.keys()]
      .filter((source) => source.startsWith("/page/"))
      .sort(by),
    nodes = [...selected.keys()]
      .filter((source) => source.startsWith("/node/"))
      .sort(by);
  return [
    ...new Set(
      [...canvas, ...nodes]
        .slice(0, limit)
        .map((source) => selected.get(source)!),
    ),
  ].sort(compareStrings);
}

/** Anonymous GET of one address: the HTTP status (0 on a connection failure) and decoded body. */
export async function fetchPage(baseUrl: string, path: string): Promise<Page> {
  const url = urljoin(
    baseUrl.replace(/\/+$/, "") + "/",
    path.replace(/^\/+/, ""),
  );
  try {
    // Certificates are verified except on local development hosts; published-pages, extract-voice
    // and extract-compositions fetch through here too.
    const result = await httpGet(url, {
      headers: { "User-Agent": "design-lab/0.14" },
      timeoutMs: 20000,
    });
    return result.status >= 200 && result.status < 300
      ? [path, result.status, result.body.toString("utf8")]
      : [path, result.status, ""];
  } catch {
    return [path, 0, ""];
  }
}

export const comparePages = (a: Page, b: Page): number =>
  compareStrings(a[0], b[0]) || a[1] - b[1] || compareStrings(a[2], b[2]);

/** Pure reducer of [path, status, HTML] results against inventory SDC IDs. */
export function summarizePages(
  pages: Page[],
  components: Dict,
): Record<string, Dict> {
  const idBySdc = new Map<string, string>();
  for (const component of components["components"] || []) {
    let sourceId: string | undefined = component["sourceSdcId"];
    if (!sourceId) {
      const match =
        /(?:^|\/)themes\/(?:custom|contrib)\/([^/]+)\/components\/([^/]+)\//.exec(
          component["sourceRef"] ?? "",
        );
      sourceId = match ? match[1] + ":" + match[2] : component["id"];
    }
    idBySdc.set(sourceId!, component["id"]);
  }
  const evidence: Record<string, Dict> = {};
  for (const id of idBySdc.values())
    evidence[id] = {
      renderedPages: 0,
      renderedInstances: 0,
      renderedExamples: [],
    };
  for (const [path, status, html] of [...pages].sort(comparePages)) {
    if (status !== 200) continue;
    for (const [sdcId, instances] of Object.entries(parseComponents(html))) {
      const id = idBySdc.get(sdcId);
      if (id === undefined) continue;
      const value = evidence[id]!;
      value["renderedPages"] += 1;
      value["renderedInstances"] += instances;
      if (value["renderedExamples"].length < 3)
        value["renderedExamples"].push(path);
    }
  }
  return evidence;
}

export interface ScanHooks {
  run?: Runner;
  fetch?: (baseUrl: string, path: string) => Promise<Page>;
}
export async function scan(
  baseUrl: string,
  ddevRoot: string,
  components: Dict,
  limit = 60,
  hooks: ScanHooks = {},
): Promise<[Record<string, Dict>, Dict]> {
  const rows = sqlqRows(resolveReal(ddevRoot), ALIASES_SQL, 2, hooks.run);
  const paths = publicPaths(rows, limit),
    get = hooks.fetch ?? fetchPage;
  const pages = await mapLimit(paths, 8, (path) => get(baseUrl, path));
  return [
    summarizePages(pages, components),
    {
      baseUrl,
      pathsSelected: paths.length,
      pagesFetched: pages.filter((page) => page[1] === 200).length,
      pathsFailed: pages
        .filter((page) => page[1] !== 200)
        .map((page) => page[0]),
    },
  ];
}

export function enrichUsage(
  document: Dict,
  evidence: Record<string, Dict>,
  scanDetails: Dict,
): Dict {
  document["source"]["renderedVerification"] = scanDetails;
  for (const [id, rendered] of Object.entries(evidence)) {
    const value: Dict | undefined = Object.hasOwn(document["usage"], id)
      ? document["usage"][id]
      : undefined;
    if (!value) continue;
    Object.assign(value, rendered);
    if (!(value["exampleCandidates"] || []).length)
      value["exampleCandidates"] = [...rendered["renderedExamples"]];
  }
  return document;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "ddev-root": { type: "string" },
      "base-url": { type: "string" },
      "max-pages": { type: "string", default: "60" },
      output: { type: "string" },
    },
  });
  if (
    !positionals[0] ||
    !values["ddev-root"] ||
    !values["base-url"] ||
    !values.output
  )
    throw new Error(
      "usage: find-rendered-components.ts COMPONENTS --ddev-root DIR --base-url URL --output FILE [--max-pages N]",
    );
  const [evidence, details] = await scan(
    values["base-url"],
    values["ddev-root"],
    JSON.parse(readFileSync(positionals[0], "utf8")),
    Number(values["max-pages"]),
  );
  writeJson(values.output, { source: details, components: evidence });
  console.log(JSON.stringify({ output: values.output, ...details }));
}

if (import.meta.main) await main();
