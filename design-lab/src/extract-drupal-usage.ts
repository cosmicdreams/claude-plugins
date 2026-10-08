/** Measure Drupal component usage from a running DDEV database (port of extract_drupal_usage.ts).
 *
 * The output keeps direct author placements separate from nested structural instances. This is
 * the distinction that prevents an inner paragraph such as a link from looking independently
 * placeable merely because thousands of parent components render one.
 *
 * Database access is synchronous `ddev` child processes with the same arguments the baseline
 * used; pass a `Runner` to substitute them. Network access is asynchronous. */
import { spawnSync } from "node:child_process";
import { realpathSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { parseArgs } from "node:util";
import { validate, writeJson } from "./contracts.ts";
import type { ExternalObject } from "./discovery-io.ts";
import type {Usage} from "./generated/usage.ts";
import type {RenderEvidence} from "./generated/render-evidence.ts";
import type {UsageInventory,UsageEntry,UsageSource,UsageProblem,ExampleDocument} from "./usage-types.ts";
import * as twig from "./capture/twig.ts";
import { toolVersion } from "./figma-receipts.ts";

export const STANDARD_VERSION = "3.0.0";
export const PAGE_HOSTS = new Set([
  "node",
  "menu_link_content",
  "dmb_notifications_entity",
  "group",
  "user",
  "taxonomy_term",
]);
const INLINE_BLOCK = /inline_block:([a-z0-9_]+)/g,
  BLOCK_UUID = /block_content:([0-9a-f-]{36})/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
export const TIERS = {
  high: "Components — High Use",
  medium: "Components — Medium Use",
  low: "Components — Low Use",
  structural: "Components — Structural Only",
  retirement: "Components — Retirement Candidates",
} as const;

export const QUERIES: Record<string, string> = {
  sitestudio_layouts: `
SELECT id, IFNULL(parent_type,''), IFNULL(parent_id,''),
       REPLACE(REPLACE(json_values, CHAR(10), ' '), CHAR(9), ' ')
FROM cohesion_layout_field_data WHERE default_langcode=1;
`,
  component_contents: "SELECT id, uuid FROM component_contents;",
  // Master, menu, view and content templates are config entities, not layout rows, so the
  // header and footer a master template places on every page never reach the layout table.
  // Views are read only to find the pages that render a view template.
  sitestudio_templates: `
SELECT name, REPLACE(REPLACE(REPLACE(CAST(data AS CHAR), CHAR(10), ' '), CHAR(13), ' '),
                     CHAR(9), ' ')
FROM config WHERE collection='' AND (name LIKE 'cohesion\\_templates.%'
   OR (name LIKE 'views.view.%' AND CAST(data AS CHAR) LIKE '%views_template%'));
`,
  paragraphs: `
SELECT id, type, IFNULL(parent_type,''), IFNULL(parent_id,''), status
FROM paragraphs_item_field_data WHERE default_langcode=1;
`,
  layout_sections: `
SELECT entity_id,
       REPLACE(REPLACE(CAST(layout_builder__layout_section AS CHAR), CHAR(10), ' '),
                       CHAR(9), ' ')
FROM node__layout_builder__layout;
`,
  blocks: `
SELECT b.id, b.uuid, b.type, d.reusable, d.status
FROM block_content b
JOIN block_content_field_data d ON d.id=b.id AND d.default_langcode=1;
`,
  blocks_in_paragraphs: `
SELECT field_block_plugin_id, COUNT(*) FROM paragraph__field_block
WHERE deleted=0 GROUP BY field_block_plugin_id;
`,
  block_configuration: `
SELECT name, REPLACE(REPLACE(CAST(data AS CHAR), CHAR(10), ' '), CHAR(9), ' ')
FROM config WHERE name LIKE 'block.block.%';
`,
  nodes: `
SELECT nid, status, type FROM node_field_data WHERE default_langcode=1;
`,
  path_aliases: `
SELECT path, alias FROM path_alias
WHERE status=1 AND langcode IN ('en', 'und') AND path REGEXP '^/node/[0-9]+$';
`,
};

// Queries whose table exists only when a site uses the feature: Layout Builder can be enabled
// with no node bundle storing per-node overrides, and then the field table is never created.
export const OPTIONAL_TABLES: Record<string, string> = {
  layout_sections: "node__layout_builder__layout",
  paragraphs: "paragraphs_item_field_data",
  blocks: "block_content",
  blocks_in_paragraphs: "paragraph__field_block",
  block_configuration: "config",
  sitestudio_templates: "config",
  sitestudio_layouts: "cohesion_layout_field_data",
  component_contents: "component_contents",
};

// ---- small baseline-semantics helpers shared by the usage extractors ----
export type Rows = Record<string, string[][]>;
const dict = (value:unknown):ExternalObject => isDict(value)?value:{};
export const isDict = (value: unknown): value is ExternalObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** baseline truthiness. */
export function truthy(value: unknown): boolean {
  if (
    value === null ||
    value === undefined ||
    value === false ||
    value === 0 ||
    value === "" ||
    Number.isNaN(value)
  )
    return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isDict(value)) return Object.keys(value).length > 0;
  return true;
}
export const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
export const sortedStrings = (values: Iterable<string>): string[] =>
  [...values].sort(compareStrings);
const bump = (counter: Map<string, number>, key: string, by = 1): void => {
  counter.set(key, (counter.get(key) ?? 0) + by);
};
const count = (counter: Map<string, number>, key: string): number =>
  counter.get(key) ?? 0;
const setOf = <K>(map: Map<K, Set<string>>, key: K): Set<string> => {
  let found = map.get(key);
  if (!found) {
    found = new Set();
    map.set(key, found);
  }
  return found;
};
/** baseline int(): optional sign and digits, surrounding whitespace allowed. */
export function pyInt(text: string): number {
  if (!/^\s*[+-]?\d+\s*$/.test(text))
    throw new Error(`invalid literal for int() with base 10: '${text}'`);
  return Number(text);
}
export const now = (): string =>
  new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
/** baseline str.splitlines(). */
export function splitlines(text: string): string[] {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
export function resolveReal(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

// ---- DDEV ----
export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
export type Runner = (
  command: string,
  args: string[],
  cwd: string,
) => RunResult;
export const spawnRunner: Runner = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: Infinity,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  // baseline's text=True applies universal newlines.
  return {
    status: result.status,
    stdout: result.stdout.replace(/\r\n?/g, "\n"),
    stderr: result.stderr.replace(/\r\n?/g, "\n"),
  };
};

export function mysql(
  ddevRoot: string,
  sql: string,
  run: Runner = spawnRunner,
): string[][] {
  const result = run(
    "ddev",
    ["mysql", "-N", "--raw", "-e", sql.trim()],
    ddevRoot,
  );
  if (result.status !== 0)
    throw new Error("DDEV database query failed: " + result.stderr.trim());
  // Rows end only at a newline: splitlines() would also split on characters such as
  // U+2028 that are legitimate inside a stored value.
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));
}

/** `ddev describe -j`, the project's running state, as the shared guard of both collectors. */
export function describeProject(
  root: string,
  project: string | null | undefined,
  run: Runner,
): ExternalObject {
  const status = run("ddev", ["describe", "-j"], root);
  if (status.status !== 0)
    throw new Error("DDEV project is unavailable: " + status.stderr.trim());
  let raw: ExternalObject;
  try {
    const parsed:unknown=JSON.parse(status.stdout);
    raw = isDict(parsed) && isDict(parsed['raw'])?parsed['raw']:{};
  } catch {
    throw new Error("DDEV describe did not return JSON");
  }
  if (!isDict(raw)) raw = {};
  if (raw["status"] !== "running")
    throw new Error(
      `DDEV project ${raw["name"] || project || basename(root)} is not running`,
    );
  if (project && raw["name"] !== project)
    throw new Error(
      `DDEV root resolves to project '${raw["name"]}', expected '${project}'`,
    );
  return raw;
}

export function collectRows(
  ddevRoot: string,
  project?: string | null,
  run: Runner = spawnRunner,
): Rows {
  const root = resolveReal(ddevRoot),
    raw = describeProject(root, project, run);
  const present = new Set(
    mysql(root, "SHOW TABLES;", run)
      .filter((values) => values.length)
      .map((values) => values[0]!),
  );
  const rows: Rows = {};
  for (const [name, sql] of Object.entries(QUERIES))
    rows[name] =
      !(name in OPTIONAL_TABLES) || present.has(OPTIONAL_TABLES[name]!)
        ? mysql(root, sql, run)
        : [];
  rows["__ddev"] = [
    [
      String(raw["name"] || project || basename(root)),
      String(raw["primary_url"] || ""),
    ],
  ];
  return rows;
}

interface Paragraph {bundle:string;parentType:string;parentId:string;status:string}
function rootOf(
  paragraphId: string,
  paragraphs: Map<string, Paragraph>,
): [string | null, string | null] {
  let current = paragraphId;
  const seen = new Set<string>();
  for (let step = 0; step < 24; step++) {
    const row = paragraphs.get(current);
    if (seen.has(current) || !row) return [null, null];
    seen.add(current);
    if (row["parentType"] === "paragraph") {
      current = row["parentId"];
      continue;
    }
    return [row["parentType"] || null, row["parentId"] || null];
  }
  return [null, null];
}

/** Yield [componentId, componentContentId, nested] for a Site Studio canvas. */
export function* walk(
  elements: unknown,
  nested = false,
): Generator<[string | null, string | null, boolean]> {
  if (!Array.isArray(elements)) return;
  for (const element of elements) {
    if (!isDict(element)) continue;
    const component =
        element["type"] === "component"
          ? (element["componentId"] ?? null)
          : null,
      reference = element["componentContentId"] ?? null;
    yield [typeof component==='string'?component:null, typeof reference==='string'?reference:null, nested];
    yield* walk(
      element["children"] || [],
      nested || truthy(component) || truthy(reference),
    );
  }
}

const MAX_PHP_DEPTH = 900;
/** Decode PHP serialize() output, the format Drupal stores config in.
 *
 * Strings are length-prefixed in bytes, so the input stays bytes. Objects are not expected in
 * config and are rejected rather than guessed at. Nesting past MAX_PHP_DEPTH is rejected as
 * baseline's recursion limit rejected it. */
export function phpUnserialize(data: Buffer): unknown {
  let position = 0;
  const bytes = (start: number, end: number): string =>
    data.subarray(start, end).toString("latin1");
  const readUntil = (stop: string): Buffer => {
    const end = data.indexOf(stop, position, "latin1");
    if (end < 0) throw new Error("subsection not found");
    const value = data.subarray(position, end);
    position = end + stop.length;
    return value;
  };
  const integer = (): number => pyInt(readUntil(";").toString("latin1"));
  const assign = (target: ExternalObject, key: string | number, value: unknown): void => {
    if (key === "__proto__")
      Object.defineProperty(target, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    else target[key] = value;
  };
  function value(depth: number): unknown {
    if (depth > MAX_PHP_DEPTH)
      throw new Error("maximum recursion depth exceeded");
    const kind = bytes(position, position + 2);
    position += 2;
    if (kind === "N;") return null;
    if (kind === "b:") return readUntil(";").toString("latin1") === "1";
    if (kind === "i:") return integer();
    if (kind === "d:") {
      const text = readUntil(";").toString("latin1").trim();
      if (/^[+-]?(?:inf|infinity)$/i.test(text))
        return text.startsWith("-") ? -Infinity : Infinity;
      if (/^[+-]?nan$/i.test(text)) return NaN;
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
        throw new Error(`could not convert string to float: '${text}'`);
      return Number(text);
    }
    if (kind === "s:") {
      const length = pyInt(readUntil(':"').toString("latin1"));
      if (length < 0)
        throw new Error(`negative string length at byte ${position}`);
      const text = data.subarray(position, position + length);
      position += length;
      // A length that does not land on the closing quote means a damaged row, not text.
      if (bytes(position, position + 2) !== '";')
        throw new Error(
          `string length does not match its data at byte ${position}`,
        );
      position += 2;
      return text.toString("utf8");
    }
    if (kind === "a:") {
      const size = pyInt(readUntil(":{").toString("latin1"));
      if (size < 0) throw new Error(`negative array size at byte ${position}`);
      const result: ExternalObject = {};
      for (let item = 0; item < size; item++) {
        const keyKind = bytes(position, position + 2),
          key = value(depth + 1);
        if (keyKind !== "i:" && keyKind !== "s:")
          throw new Error(
            `array key of type ${key === null ? "NoneType" : typeof key === "boolean" ? "bool" : typeof key === "number" ? "float" : "dict"} at byte ${position}`,
          );
        assign(result, key as string|number, value(depth + 1));
      }
      if (bytes(position, position + 1) !== "}")
        throw new Error(`array is not closed at byte ${position}`);
      position += 1;
      return result;
    }
    throw new Error(
      `unsupported serialized type b'${kind}' at byte ${position - 2}`,
    );
  }
  return value(0);
}

/** Page paths, per view template, of the view displays that render it. */
function viewPaths(views: ExternalObject[]): Map<string, Set<string>> {
  const paths = new Map<string, Set<string>>();
  for (const view of views) {
    if (view["status"] === false) continue;
    const displays = dict(view["display"]),
      defaultOptions = dict(dict(displays["default"])["display_options"]);
    for (const display of Object.values(
      isDict(displays) ? displays : {},
    )) {
      if (!isDict(display) || display["display_plugin"] !== "page") continue;
      const options = dict(display["display_options"]);
      if (options["enabled"] === false) continue;
      const style = dict(options["style"] || defaultOptions["style"]),
        template = dict(style["options"])["views_template"];
      const path = (
        truthy(options["path"]) ? String(options["path"]) : ""
      ).replace(/^\/+|\/+$/g, "");
      // A path with an argument placeholder names no single page to open.
      if (
        truthy(template) &&
        path &&
        !path.includes("%") &&
        !path.includes("{")
      )
        setOf(paths, String(template)).add("/" + path);
    }
  }
  return paths;
}

interface TemplateUsage {
  structural: Map<string, number>;
  pages: Map<string, Set<string>>;
  paths: Map<string, Set<string>>;
  siteWide: Set<string>;
  sources: Map<string, Set<string>>;
  problems:UsageProblem[];
}
/** Components placed by Site Studio templates: structural, attributed to example pages.
 *
 * Every template placement is structural: an author never placed it on a page. The default
 * master template renders on every full page that names no other master, so its components
 * are site-wide and the home page is where to look for them; another master template renders
 * on the nodes whose default full content template selects it. Menu templates render in the
 * site's chrome. A view template renders on its views' page displays. Disabled templates
 * render nowhere and are skipped. */
export function templateUsage(
  rows: Rows,
  published: Set<string>,
): TemplateUsage {
  const structural = new Map<string, number>(),
    nodeBundles = new Map<string, Set<string>>(),
    paths = new Map<string, Set<string>>();
  const siteWide = new Set<string>(),
    sources = new Map<string, Set<string>>(),
    templates = new Map<string, ExternalObject>(),
    views: ExternalObject[] = [],
    problems:UsageProblem[] = [];
  for (const values of rows["sitestudio_templates"] ?? []) {
    if (values.length < 2) continue;
    const name = values[0]!,
      blob = values.slice(1).join("\t");
    let data: unknown;
    try {
      data = phpUnserialize(Buffer.from(blob, "utf8"));
      if (!isDict(data)) throw new Error("config is not an array");
    } catch (error) {
      // A damaged row is reported, never fatal to the whole usage extraction.
      problems.push({
        check: "sitestudio-template-unreadable",
        detail: `${name}: ${(error as Error).message}`,
      });
      continue;
    }
    if (name.startsWith("views.view.")) views.push(data);
    else templates.set(name, data);
  }
  const bundles = new Map<string, Set<string>>();
  for (const values of rows["nodes"] ?? [])
    if (values.length >= 3 && published.has(values[0]!))
      setOf(bundles, values[2]!).add(values[0]!);
  const viewPathMap = viewPaths(views),
    sortedTemplates = [...templates].sort((a, b) => compareStrings(a[0], b[0]));
  const live = (data: ExternalObject): boolean =>
    truthy(data["status"]) &&
    truthy(data["default"]) &&
    truthy(Object.hasOwn(data, "modified") ? data["modified"] : true) &&
    data["entity_type"] === "node" &&
    data["view_mode"] === "full";
  // Site Studio renders a node with the enabled, modified default full template of its own
  // bundle, else the global one (`__any__`): cohesion_templates.module selects
  // bundle IN [bundle, '__any__'] with status and modified set.
  const contentTemplate = (name: string): boolean =>
    name.startsWith("cohesion_templates.cohesion_content_templates.");
  const ownTemplate = new Map<unknown, ExternalObject>();
  for (const [name, data] of templates)
    if (contentTemplate(name) && live(data) && data["bundle"] !== "__any__")
      ownTemplate.set(data["bundle"], data);
  const globalTemplate =
    sortedTemplates.find(
      ([name, data]) =>
        contentTemplate(name) && live(data) && data["bundle"] === "__any__",
    )?.[1] ?? null;
  const renderingBundles = (data: ExternalObject): Set<string> => {
    // The published bundles a content template actually renders.
    if (!live(data)) return new Set();
    if (data["bundle"] === "__any__")
      return data === globalTemplate
        ? new Set(
            [...bundles.keys()].filter((bundle) => !ownTemplate.has(bundle)),
          )
        : new Set();
    return ownTemplate.get(data["bundle"]) === data
      ? new Set(typeof data["bundle"]==='string'?[data["bundle"]]:[])
      : new Set();
  };
  const mastersByBundle = new Map<string, unknown>();
  for (const bundle of bundles.keys()) {
    const chosen = ownTemplate.get(bundle) ?? globalTemplate;
    if (chosen && truthy(chosen))
      mastersByBundle.set(bundle, chosen["master_template"] ?? null);
  }

  for (const [name, data] of sortedTemplates) {
    if (!truthy(data["status"])) continue;
    let canvas: unknown;
    try {
      const parsed = JSON.parse(
        typeof data["json_values"]==='string' && truthy(data["json_values"]) ? data["json_values"] : "{}",
      );
      if (!isDict(parsed)) throw new Error("json_values is not an object");
      canvas = truthy(parsed["canvas"]) ? parsed["canvas"] : [];
    } catch (error) {
      problems.push({
        check: "sitestudio-template-unreadable",
        detail: `${name}: invalid json_values: ${(error as Error).message}`,
      });
      continue;
    }
    const kind = name.split(".").length - 1 >= 2 ? name.split(".")[1]! : "";
    const templateId = truthy(data["id"])
      ? String(data["id"])
      : name.slice(name.lastIndexOf(".") + 1);
    let chrome: boolean, pageBundles: Set<string>;
    if (kind === "cohesion_master_templates") {
      // The default master renders on every page, so the home page is the example;
      // naming every node of the bundles that select it explicitly adds nothing.
      chrome = truthy(data["default"]);
      pageBundles = chrome
        ? new Set()
        : new Set(
            [...mastersByBundle]
              .filter(([, master]) => master === templateId)
              .map(([bundle]) => bundle),
          );
    } else if (kind === "cohesion_content_templates") {
      chrome = false;
      pageBundles = renderingBundles(data);
    } else {
      chrome = kind === "cohesion_menu_templates";
      pageBundles = new Set();
    }
    for (const [component] of walk(canvas)) {
      if (!component) continue;
      bump(structural, component);
      setOf(sources, component).add(name);
      if (chrome) siteWide.add(component);
      const bucket = setOf(nodeBundles, component);
      for (const bundle of pageBundles) bucket.add(bundle);
      if (kind === "cohesion_view_templates") {
        const target = setOf(paths, component);
        for (const path of viewPathMap.get(templateId) ?? []) target.add(path);
      }
    }
  }
  const pages = new Map<string, Set<string>>();
  for (const [component, names] of nodeBundles)
    if (names.size)
      pages.set(
        component,
        new Set(
          [...names].flatMap((bundle) => [...(bundles.get(bundle) ?? [])]),
        ),
      );
  return { structural, pages, paths, siteWide, sources, problems };
}

/** Count stored author instances once; reusable content is structural.
 *
 * Follow reusable-content references for page attribution, never multiply its stored
 * instances by the number of hosts. Only canvas/children are placements, not model data. */
export function sitestudioUsage(rows: Rows, published: Set<string>) {
  const direct = new Map<string, number>(),
    structural = new Map<string, number>(),
    pages = new Map<string, Set<string>>();
  const layouts = new Map<string, unknown[][]>(),
    problems:UsageProblem[] = [];
  const hostKey = (type: string, id: string): string =>
    JSON.stringify([type, id]);
  const refs = new Map(
    (rows["component_contents"] ?? []).map(([entityId, uuid]) => [
      "cc_" + uuid,
      entityId!,
    ]),
  );
  for (const [layoutId, hostType, hostId, blob] of rows["sitestudio_layouts"] ??
    []) {
    let canvas: unknown[];
    try {
      const data = JSON.parse(blob!);
      if (
        !isDict(data) ||
        (Object.hasOwn(data, "canvas") && !Array.isArray(data["canvas"]))
      )
        throw new Error("canvas must be an array");
      canvas = Array.isArray(data["canvas"]) ? data["canvas"] : [];
    } catch (error) {
      throw new Error(
        `Site Studio layout ${layoutId}: invalid json_values: ${(error as Error).message}`,
      );
    }
    const key = hostKey(hostType!, hostId!);
    layouts.set(key, [...(layouts.get(key) ?? []), canvas]);
  }
  for (const [key, canvases] of layouts) {
    const hostType = JSON.parse(key)[0] as string;
    for (const canvas of canvases)
      for (const [component, , nested] of walk(canvas))
        if (component)
          bump(
            nested || hostType === "component_content" ? structural : direct,
            component,
          );
  }
  const attribute = (host: string, nodeId: string, seen: Set<string>): void => {
    if (seen.has(host)) return;
    for (const canvas of layouts.get(host) ?? [])
      for (const [component, reference] of walk(canvas)) {
        if (component) setOf(pages, component).add(nodeId);
        if (!reference) continue;
        let entityId = refs.get(reference) || refs.get("cc_" + reference);
        // Older exports used cc_<numeric entity id>.
        const bare = String(reference).replace(/^cc_/, "");
        if (!entityId && /^\d+$/.test(bare)) entityId = bare;
        if (entityId)
          attribute(
            hostKey("component_content", entityId),
            nodeId,
            new Set([...seen, host]),
          );
        else
          problems.push({
            check: "sitestudio-content-reference-unresolved",
            detail: String(reference),
          });
      }
  };
  for (const key of layouts.keys()) {
    const [hostType, hostId] = JSON.parse(key) as [string, string];
    if (hostType === "node" && published.has(hostId))
      attribute(key, hostId, new Set());
  }
  return { direct, structural, pages, problems };
}

export function buildUsage(components: UsageInventory, rows: Rows, source: UsageSource):Usage {
  const aliases = new Map<string, string>();
  for (const values of rows["path_aliases"] ?? [])
    if (values.length >= 2 && !aliases.has(values[0]!))
      aliases.set(values[0]!, values[1]!);
  const published = new Set(
    (rows["nodes"] ?? [])
      .filter((values) => values.length >= 2 && values[1] === "1")
      .map((values) => values[0]!),
  );
  const pathsFor = (ids: Iterable<string>): string[] => {
    // Newest published nodes first: the oldest ids are the likeliest to be unpublished
    // or built with retired markup, and an unpublished page never answers anonymously.
    const sorted = [...ids]
      .filter((id) => !published.size || published.has(id))
      .sort((a, b) => pyInt(b) - pyInt(a));
    return sorted
      .slice(0, 8)
      .map((id) => aliases.get("/node/" + id) ?? "/node/" + id);
  };
  const paragraphs = new Map<string, Paragraph>();
  for (const values of rows["paragraphs"] ?? [])
    if (values.length >= 5)
      paragraphs.set(values[0]!, {
        bundle: values[1]!,
        parentType: values[2]!,
        parentId: values[3]!,
        status: values[4]!,
      });
  const paragraphPlacements = new Map<string, number>(),
    paragraphStructural = new Map<string, number>(),
    paragraphPages = new Map<string, Set<string>>();
  const paragraphUnpublished = new Map<string, number>(),
    paragraphOrphans = new Map<string, number>();
  // Hosted by a menu link, a notification or another entity that is not a page: rendered in
  // the site's chrome (a mega menu, an alert bar), so the home page is where to look for it.
  const siteWide = new Set<string>();
  for (const [paragraphId, row] of paragraphs) {
    const componentId = "paragraph:" + row["bundle"];
    if (
      row["parentType"] === "paragraph" ||
      row["parentType"] === "block_content"
    )
      bump(paragraphStructural, componentId);
    else if (PAGE_HOSTS.has(row["parentType"]))
      bump(paragraphPlacements, componentId);
    else if (!row["parentType"]) bump(paragraphOrphans, componentId);
    else bump(paragraphPlacements, componentId);
    if (row["status"] === "0") bump(paragraphUnpublished, componentId);
    const [hostType, hostId] = rootOf(paragraphId, paragraphs);
    if (hostType === "node" && hostId)
      setOf(paragraphPages, componentId).add(hostId);
    else if (hostType && PAGE_HOSTS.has(hostType)) siteWide.add(componentId);
  }
  const byUuid = new Map<string, string>(),
    inlineEntities = new Map<string, number>();
  for (const values of rows["blocks"] ?? [])
    if (values.length >= 5) {
      const [, uuid, bundle, reusable] = values;
      byUuid.set(uuid!, bundle!);
      if (reusable === "0") bump(inlineEntities, "block:" + bundle);
    }
  const blockPlacements = new Map<string, number>(),
    blockPages = new Map<string, Set<string>>();
  let layoutRows = 0;
  for (const values of rows["layout_sections"] ?? []) {
    if (values.length < 2) continue;
    layoutRows++;
    const nodeId = values[0]!,
      blob = values.slice(1).join("\t");
    for (const match of blob.matchAll(INLINE_BLOCK)) {
      const key = "block:" + match[1];
      bump(blockPlacements, key);
      setOf(blockPages, key).add(nodeId);
    }
    for (const match of blob.matchAll(BLOCK_UUID)) {
      const bundle = byUuid.get(match[1]!);
      if (bundle !== undefined) {
        const key = "block:" + bundle;
        bump(blockPlacements, key);
        setOf(blockPages, key).add(nodeId);
      }
    }
  }
  const configuredBlocks = new Map<string, number>();
  for (const values of rows["block_configuration"] ?? [])
    for (const match of values.slice(1).join("\t").matchAll(BLOCK_UUID)) {
      const bundle = byUuid.get(match[1]!);
      if (bundle !== undefined) {
        const key = "block:" + bundle;
        bump(configuredBlocks, key);
        bump(blockPlacements, key);
      }
    }
  const blockStructural = new Map<string, number>();
  for (const values of rows["blocks_in_paragraphs"] ?? []) {
    if (values.length < 2) continue;
    const match = /block_content:([0-9a-f-]{36})/.exec(values[0]!);
    if (match && byUuid.has(match[1]!))
      bump(
        blockStructural,
        "block:" + byUuid.get(match[1]!),
        pyInt(values[1]!),
      );
  }
  const ss = sitestudioUsage(rows, published),
    tpl = templateUsage(rows, published);
  for (const [component, value] of tpl.structural)
    bump(ss.structural, component, value);
  for (const component of tpl.siteWide) siteWide.add(component);
  const componentIds: string[] = (components["components"] || []).map(
    (component) => component["id"],
  );
  const databaseIds = new Set([
    ...paragraphPlacements.keys(),
    ...paragraphStructural.keys(),
    ...blockPlacements.keys(),
    ...blockStructural.keys(),
    ...inlineEntities.keys(),
    ...ss.direct.keys(),
    ...ss.structural.keys(),
  ]);
  const usage:Usage['usage'] = {};
  const union = (...sets: Array<Set<string> | undefined>): Set<string> =>
    new Set(sets.flatMap((set) => [...(set ?? [])]));
  for (const id of componentIds) {
    const pagePlaced = union(
      paragraphPages.get(id),
      blockPages.get(id),
      ss.pages.get(id),
    );
    usage[id] = {
      placements:
        count(paragraphPlacements, id) +
        count(blockPlacements, id) +
        count(ss.direct, id),
      structuralRefs:
        count(paragraphStructural, id) +
        count(blockStructural, id) +
        count(ss.structural, id),
      pages:
        (paragraphPages.get(id)?.size ?? 0) +
        (blockPages.get(id)?.size ?? 0) +
        union(ss.pages.get(id), tpl.pages.get(id)).size,
      unpublishedInstances: count(paragraphUnpublished, id),
      inlineBlockEntities: count(inlineEntities, id),
      configPlacedBlocks: count(configuredBlocks, id),
      orphanInstances: count(paragraphOrphans, id),
      // Pages an author placed the component on come before the pages a template
      // renders it on, so a template never displaces an example that already works.
      exampleCandidates: [
        ...new Set([
          ...[
            ...pathsFor(pagePlaced),
            ...pathsFor(tpl.pages.get(id) ?? []),
          ].slice(0, 8),
          ...sortedStrings(tpl.paths.get(id) ?? []),
          ...(siteWide.has(id) || count(configuredBlocks, id) ? ["/"] : []),
        ]),
      ],
    };
    if (tpl.sources.get(id)?.size)
      usage[id]!["templates"] = sortedStrings(tpl.sources.get(id)!);
  }
  const zero = Object.entries(usage)
    .filter(
      ([, value]) => value["placements"] === 0 && value["structuralRefs"] === 0,
    )
    .map(([id]) => id)
    .sort(compareStrings);
  const extra = sortedStrings(
    [...databaseIds].filter((id) => !componentIds.includes(id)),
  );
  const problems:UsageProblem[] = [...ss.problems, ...tpl.problems];
  if (extra.length)
    problems.push({
      check: "bundle-in-database-not-in-inventory",
      detail: `database contains ${extra.length} bundle(s) absent from the inventory`,
      evidence: extra,
    });
  if (zero.length)
    problems.push({
      check: "inventoried-bundle-absent-from-database",
      detail: `${zero.length} inventoried bundle(s) have zero measured instances`,
      evidence: zero,
    });
  const orphanTotal = [...paragraphOrphans.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  if (orphanTotal)
    problems.push({
      check: "paragraph-without-parent",
      detail: `${orphanTotal} paragraph instance(s) have no attributable parent`,
    });
  const document:Usage = {
    standardVersion: STANDARD_VERSION,
    toolVersion: toolVersion(),
    generatedAt: now(),
    source: {
      ...source,
      strategy: "drupal-db",
      scope:
        "current revisions, default language; placements and nested instances separate",
      definitions: {
        placements:
          "paragraphs whose immediate parent is a page-level host, plus blocks referenced by Layout Builder or block configuration; Site Studio components without a component ancestor in host layouts",
        structuralRefs:
          "paragraphs whose immediate parent is another paragraph or block, plus blocks embedded through a paragraph block field; nested Site Studio components and stored reusable-content components (counted once, with published host pages attributed through references), plus components placed by enabled Site Studio master, content, menu and view templates (listed under templates)",
      },
      population: {
        siteStudioLayouts: (rows["sitestudio_layouts"] ?? []).length,
        siteStudioTemplates: (rows["sitestudio_templates"] ?? []).filter(
          (values) =>
            values.length && values[0]!.startsWith("cohesion_templates."),
        ).length,
        paragraphInstances: paragraphs.size,
        blockContentEntities: byUuid.size,
        nodes: (rows["nodes"] ?? []).length,
        layoutBuilderSections: layoutRows,
      },
    },
    usage,
    problems,
  };
  const errors = validate("usage", document);
  if (errors.length)
    throw new Error("invalid usage artifact: " + errors.join("; "));
  return document;
}

// ---- network ----
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
/** Certificates are verified everywhere except local development hosts, whose certificates are self-signed. */
export function verifyTls(url: string): boolean {
  if (!url.startsWith("https://")) return true;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  return !(
    LOCAL_HOSTS.has(host) ||
    host.endsWith(".ddev.site") ||
    host.endsWith(".localhost")
  );
}
export interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}
export interface HttpOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  relaxLocalTls?: boolean;
}
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** GET with urllib's behaviour: follow up to 10 redirects, an idle-socket timeout, and the final
 * status returned (callers decide what a non-2xx means). Rejects on connection failures. */
export function httpGet(
  url: string,
  options: HttpOptions = {},
): Promise<HttpResult> {
  const timeoutMs = options.timeoutMs ?? 20000,
    relax = options.relaxLocalTls ?? true,
    // urllib creates one SSL context for the initial URL and reuses it on redirects.
    rejectUnauthorized = relax ? verifyTls(url) : true;
  const hop = (target: string, hops: number): Promise<HttpResult> =>
    new Promise((resolveResult, reject) => {
      // urllib does not implicitly percent-encode authored aliases. The oracle treats a raw
      // Unicode request as an unavailable example; preserve that failure until a separate fix.
      if (/[^\x00-\x7f]/.test(target)) {
        reject(new Error("URL contains non-ASCII characters"));
        return;
      }
      const parsed = new URL(target);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        reject(new Error("unknown url type: " + parsed.protocol));
        return;
      }
      const send = parsed.protocol === "https:" ? httpsRequest : httpRequest;
      const req = send(
        parsed,
        {
          method: "GET",
          headers: { "Accept-Encoding": "identity", ...options.headers },
          rejectUnauthorized,
        },
        (response) => {
          const status = response.statusCode ?? 0,
            location = response.headers.location;
          if (REDIRECTS.has(status) && location) {
            response.resume();
            if (hops >= 10) {
              resolveResult({
                status,
                headers: response.headers,
                body: Buffer.alloc(0),
              });
              return;
            }
            try {
              const redirected = new URL(location, parsed);
              // urllib refuses unsafe redirect schemes as an HTTPError at the original status.
              if (!['http:', 'https:', 'ftp:'].includes(redirected.protocol)) {
                resolveResult({status,headers:response.headers,body:Buffer.alloc(0)});
              } else hop(redirected.href, hops + 1).then(resolveResult, reject);
            } catch (error) { reject(error); }
            return;
          }
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("error", reject);
          response.on("end", () =>
            resolveResult({
              status,
              headers: response.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on("error", reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error("timed out")));
      req.end();
    });
  return hop(url, 0);
}
/** Run `fn` over `items` with at most `limit` in flight, keeping input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}
export function urljoin(base: string, path: string): string {
  let joined = new URL(path, base).href;
  for (const char of new Set(
    [...base, ...path].filter((c) => /[^\x00-\x7f]/.test(c)),
  ))
    joined = joined.replaceAll(encodeURIComponent(char), () => char);
  return joined;
}
const joinBase = (baseUrl: string, path: string): string =>
  urljoin(baseUrl.replace(/\/+$/, "") + "/", path.replace(/^\/+/, ""));

export type PageFetcher = (url: string) => Promise<[number, string]>;
export const fetchPage: PageFetcher = async (url) => {
  try {
    const result = await httpGet(url, {
      headers: { "User-Agent": "design-lab/0.14" },
    });
    return result.status >= 200 && result.status < 300
      ? [result.status, result.body.toString("utf8")]
      : [result.status, ""];
  } catch {
    return [0, ""];
  }
};

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
type Marker = [
  name: string,
  kind: string,
  pattern: string | null,
  unique: boolean,
];
/** Verify DB-derived node paths anonymously against component-specific markers. */
export async function enrichExamples<D extends ExampleDocument>(
  document:D,
  baseUrl: string,
  rendering?:{items?:Record<string,Pick<RenderEvidence['items'][string],'rootSdc'>>}|null,
  fetcher: PageFetcher = fetchPage,
): Promise<D & ExampleDocument> {
  const usage:ExampleDocument['usage'] = document['usage'] ?? {};
  const urls = sortedStrings(
    new Set(
      Object.values(usage).flatMap((value) =>
        (value["exampleCandidates"] || []).map((path: string) =>
          joinBase(baseUrl, path),
        ),
      ),
    ),
  );
  const fetched = new Map(urls.map((url, index) => [url, index] as const));
  const results = await mapLimit(urls, 8, fetcher);
  const items = rendering?.["items"] || {};
  const sdcOwners = new Map<string, number>();
  for (const item of Object.values(items))
    if (truthy(item["rootSdc"])) bump(sdcOwners, item["rootSdc"]!);
  const debug = results.some(([, body]) => twig.enabled(body));
  for (const [componentId, value] of Object.entries(usage)) {
    const machine = componentId.slice(componentId.indexOf(":") + 1);
    const marker = componentId.startsWith("block:")
      ? "block--" + machine.replaceAll("_", "-")
      : "paragraph--type--" + machine.replaceAll("_", "-");
    // Templates that embed a single-directory component print no bundle wrapper; the
    // page marks the render with that component's id instead (render-evidence rootSdc).
    const sdc: string | undefined = items[componentId]?.["rootSdc"]??undefined;
    const markers: Marker[] = [
      [marker, "class", "\\b" + escapeRegExp(marker) + "\\b", true],
    ];
    // The bundle's own Twig debug suggestion is the only exact marker, so with Twig debug
    // on it comes before the component id: one single-directory component is often
    // embedded by several bundles (`kinetic:cards` by a block and a paragraph), and its
    // id then selects the other bundle's render too.
    const template: Marker = [
      twig.suggestion(componentId)[1],
      "template",
      null,
      true,
    ];
    if (debug) markers.push(template);
    if (sdc)
      markers.push([
        sdc,
        "component",
        'data-component-id="' + escapeRegExp(sdc) + '"',
        sdcOwners.get(sdc) === 1,
      ]);
    if (!debug) markers.push(template);
    const examples:NonNullable<UsageEntry['examples']> = [],
      candidates: string[] = value["exampleCandidates"] ?? [];
    delete value["exampleCandidates"];
    for (const [name, kind, pattern, unique] of markers) {
      for (const path of candidates) {
        const url = joinBase(baseUrl, path),
          index = fetched.get(url),
          [status, body] =
            index === undefined
              ? ([0, ""] as [number, string])
              : results[index]!;
        // A class marker counts only in markup: Twig debug comments name template
        // files such as `block--icon-block.html.twig`, which a class pattern also hits.
        const found =
          kind === "template"
            ? twig.count(body, componentId)
            : (
                body
                  .replace(HTML_COMMENT, "")
                  .match(new RegExp(pattern!, "g")) ?? []
              ).length;
        if (status === 200 && found)
          examples.push({
            url,
            path,
            marker: name,
            markerKind: kind,
            markerUniqueToThisComponent: unique,
            instancesOnPage: found,
            status,
            anonymous: true,
            verifiedAt: now(),
          });
      }
      if (examples.length) break;
    }
    value["examples"] = examples;
    value["noExampleReason"] = examples.length
      ? null
      : "no component-specific rendered marker was found on the DB-derived anonymous pages";
  }
  document["source"]["exampleVerification"] = {
    baseUrl,
    pagesFetched: urls.length,
    anonymous: true,
    twigDebug: debug,
  };
  return document;
}

export function usageTier(
  placements: number,
  structuralRefs: number,
  high = 50,
  medium = 10,
): string {
  if (placements >= high) return TIERS.high;
  if (placements >= medium) return TIERS.medium;
  if (placements) return TIERS.low;
  return structuralRefs ? TIERS.structural : TIERS.retirement;
}

export function mergeUsage(
  components:UsageInventory,
  usageDocument:Pick<Usage,'generatedAt'|'usage'> & Partial<Usage>,
  high = 50,
  medium = 10,
) {
  const result = structuredClone(components),
    measuredAt = usageDocument["generatedAt"],
    byId: Usage['usage'] = usageDocument["usage"];
  for (const component of result["components"] ?? []) {
    if (!Object.hasOwn(byId, component["id"]))
      throw new Error(`usage has no row for ${component["id"]}`);
    const evidence:NonNullable<typeof component.usage> = structuredClone(byId[component['id']]!);
    evidence["tier"] = usageTier(
      evidence["placements"]??0,
      evidence["structuralRefs"]??0,
      high,
      medium,
    );
    evidence["source"] = "drupal-db";
    evidence["measuredAt"] = measuredAt;
    component["usage"] = evidence;
    component["category"] = evidence["tier"];
  }
  const sum = (key: 'placements'|'structuralRefs'): number =>
    (result["components"] ?? []).reduce(
      (total, component) => total + (component.usage?.[key]??0),
      0,
    );
  result["totals"] = { ...result["totals"], placements: sum("placements") };
  result["totals"]["structuralRefs"] = sum("structuralRefs");
  result["problems"] = [
    ...(result["problems"] ?? []).filter(
      (problem) => problem["check"] !== "usage-data-missing",
    ),
    ...structuredClone(usageDocument["problems"] ?? []),
  ];
  return result;
}

export interface ExtractHooks {
  collectRows?: (root: string, project?: string | null) => Rows;
  enrichExamples?: typeof enrichExamples;
}
export async function extract(
  ddevRoot: string,
  components:UsageInventory,
  project?: string | null,
  rendering?:{items?:Record<string,Pick<RenderEvidence['items'][string],'rootSdc'>>}|null,
  hooks: ExtractHooks = {},
): Promise<Usage> {
  const root = resolveReal(ddevRoot),
    rows = (hooks.collectRows ?? collectRows)(root, project);
  const document = buildUsage(components, rows, {
    ddevProject: project ?? null,
    approot: root,
  });
  const ddev = rows["__ddev"]?.[0] ?? [project || basename(root), ""];
  const baseUrl = ddev[1] || `https://${ddev[0]}.ddev.site`;
  if (components["source"]?.["strategy"] === "sitestudio") {
    // Paragraph Twig/class markers cannot verify Cohesion renders. Preserve DB paths.
    for (const value of Object.values(document["usage"])) {
      value["examples"] = [];
      value["noExampleReason"] =
        "Site Studio rendered marker verification is not supported";
    }
    return document;
  }
  await (hooks.enrichExamples ?? enrichExamples)(document, baseUrl, rendering);return document;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "ddev-root": { type: "string" },
      "ddev-project": { type: "string" },
      output: { type: "string" },
      "merge-components": { type: "string" },
      "render-evidence": { type: "string" },
      high: { type: "string", default: "50" },
      medium: { type: "string", default: "10" },
    },
  });
  if (!positionals[0] || !values["ddev-root"] || !values.output)
    throw new Error(
      "usage: extract-drupal-usage.ts COMPONENTS --ddev-root DIR --output FILE [--ddev-project NAME] [--merge-components FILE] [--render-evidence FILE]",
    );
  const load = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
  const components = load<UsageInventory>(positionals[0]),
    rendering = values["render-evidence"]
      ? load<RenderEvidence>(values["render-evidence"])
      : null;
  const document = await extract(
    values["ddev-root"],
    components,
    values["ddev-project"],
    rendering,
  );
  writeJson(values.output, document);
  if (values["merge-components"])
    writeJson(
      values["merge-components"],
      mergeUsage(
        components,
        document,
        Number(values.high),
        Number(values.medium),
      ),
    );
  const entries = Object.values(document["usage"]),
    total = (key:'placements'|'structuralRefs'): number =>
      entries.reduce((sum, value) => sum + value[key], 0);
  console.log(
    JSON.stringify(
      {
        output: resolve(values.output),
        components: entries.length,
        placements: total("placements"),
        structuralRefs: total("structuralRefs"),
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) await main();
