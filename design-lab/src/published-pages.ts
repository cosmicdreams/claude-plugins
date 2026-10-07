/** Thin public-page input shared by deterministic published-site extractors (port of published_pages.py). */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { sqlqRows } from "./extract-canvas-usage.ts";
import {
  compareStrings,
  mapLimit,
  resolveReal,
} from "./extract-drupal-usage.ts";
import type { Runner } from "./extract-drupal-usage.ts";
import {
  ALIASES_SQL,
  fetchPage,
  publicPaths,
} from "./find-rendered-components.ts";
import type { Page } from "./find-rendered-components.ts";
import { PY_SPACE, pyStrip } from "./html-parser.ts";

export function siteConfig(project: string): {
  root: string;
  name: string;
  front: string;
} {
  const manifest = JSON.parse(
    readFileSync(join(project, "project.json"), "utf8"),
  );
  const root = resolveReal(manifest.repository.root);
  let name = basename(root),
    front = "/";
  let config: string | undefined;
  try {
    const sites = readdirSync(join(root, "config"))
      .filter((entry) => {
        try {
          return statSync(
            join(root, "config", entry, "system.site.yml"),
          ).isFile();
        } catch {
          return false;
        }
      })
      .sort(compareStrings);
    if (sites.length)
      config = join(root, "config", sites[0]!, "system.site.yml");
  } catch {
    /* no config folder */
  }
  if (config) {
    const content = readFileSync(config, "utf8");
    const nameMatch = new RegExp(
      `^name:[${PY_SPACE}]*([^\\n]+?)[${PY_SPACE}]*$`,
      "m",
    ).exec(content);
    if (nameMatch)
      name = pyStrip(nameMatch[1]!)
        .replace(/^['"]+|['"]+$/g, "")
        .replaceAll("''", "'");
    const frontMatch = new RegExp(
      `^[${PY_SPACE}]*front:[${PY_SPACE}]*([^\\n]+?)[${PY_SPACE}]*$`,
      "m",
    ).exec(content);
    if (frontMatch)
      front = pyStrip(frontMatch[1]!).replace(/^['"]+|['"]+$/g, "");
  }
  return { root, name, front };
}

/** Include the homepage and reuse the scanner's bounded, sorted alias selection. */
export function addresses(
  root: string,
  front = "/",
  limit = 400,
  sqlq: (
    root: string,
    sql: string,
    columns: number,
    run?: Runner,
  ) => string[][] = sqlqRows,
): string[] {
  const rows = [...sqlq(root, ALIASES_SQL, 2)].sort(
    (a, b) => compareStrings(a[0]!, b[0]!) || compareStrings(a[1]!, b[1]!),
  );
  if (limit < 1) throw new Error("page limit must be positive");
  const aliases = new Map<string, string>();
  for (const [source, alias] of rows)
    if (!aliases.has(source!)) aliases.set(source!, alias!);
  const priority = ["/"];
  if (aliases.has(front) && !priority.includes(aliases.get(front)!))
    priority.push(aliases.get(front)!);
  const selected = priority.slice(0, limit);
  for (const path of publicPaths(rows, limit))
    if (!selected.includes(path) && selected.length < limit)
      selected.push(path);
  return selected.sort(compareStrings);
}

/** The page body without the parts that differ per address (canonical links, active menu
 * classes, form tokens), for recognising the same page under two addresses. */
export function mainContent(html: string): string {
  const match = /<main\b[\s\S]*?<\/main>/i.exec(html),
    body = match ? match[0] : html;
  return body.replace(
    new RegExp(
      `[${PY_SPACE}](class|id|value|data-[\\p{L}\\p{N}_-]+)="[^"]*"`,
      "gu",
    ),
    "",
  );
}

/** Fetch every address once, then drop aliases: two addresses serving the same page
 * (the front page at `/` and at `/home`) count once, under the shortest address. */
export async function fetchPages(
  baseUrl: string,
  paths: string[],
  fetcher: (baseUrl: string, path: string) => Promise<Page> = fetchPage,
): Promise<Page[]> {
  const fetched = await mapLimit(
    [...new Set(paths)].sort(compareStrings),
    8,
    (path) => fetcher(baseUrl, path),
  );
  const seen = new Set<string>(),
    unique: Page[] = [];
  for (const page of [...fetched].sort(
    (a, b) => a[0].length - b[0].length || compareStrings(a[0], b[0]),
  )) {
    const key =
      page[1] === 200 && page[2]
        ? createHash("sha256").update(mainContent(page[2])).digest("hex")
        : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    unique.push(page);
  }
  return unique.sort((a, b) => compareStrings(a[0], b[0]));
}
