/** Extract top-level rendered component sequences from published pages (port of extract_compositions.py). */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { writeJson } from "./contracts.ts";
import { compareStrings } from "./extract-drupal-usage.ts";
import { comparePages } from "./find-rendered-components.ts";
import type { Page } from "./find-rendered-components.ts";
import { collapse, parseHtml } from "./html-parser.ts";
import type { Attrs } from "./html-parser.ts";
import { addresses, fetchPages, siteConfig } from "./published-pages.ts";

export const VOID = new Set(
  "area base br col embed hr img input link meta param source track wbr".split(
    " ",
  ),
);

export interface ParsedComposition {
  title: string;
  components: string[];
}
export function parsePage(html: string): ParsedComposition {
  const stack: Array<[tag: string, marked: boolean]> = [],
    components: string[] = [],
    titleParts: string[] = [];
  let titleDepth = 0;
  const component = (attrs: Attrs): string | null => {
    // dict(attrs): a repeated attribute keeps its last value.
    let found: string | null = null;
    for (const [key, value] of attrs)
      if (key === "data-component-id") found = value;
    return found;
  };
  parseHtml(html, {
    starttag(tag, attrs) {
      const id = component(attrs);
      if (id && !stack.some(([, marked]) => marked)) components.push(id);
      if (!VOID.has(tag)) stack.push([tag, Boolean(id)]);
      if (tag === "title") titleDepth++;
    },
    startendtag(_tag, attrs) {
      const id = component(attrs);
      if (id && !stack.some(([, marked]) => marked)) components.push(id);
    },
    endtag(tag) {
      for (let index = stack.length - 1; index >= 0; index--)
        if (stack[index]![0] === tag) {
          stack.length = index;
          break;
        }
      if (tag === "title" && titleDepth) titleDepth--;
    },
    data(text) {
      if (titleDepth) titleParts.push(text);
    },
  });
  return { title: collapse(titleParts.join(" ")), components };
}

export interface Compositions {
  pages: Array<{ address: string } & ParsedComposition>;
  components: Record<string, string[]>;
  pagesFailed: string[];
}
export function buildCompositions(pages: Page[]): Compositions {
  const result: Compositions["pages"] = [],
    byComponent = new Map<string, string[]>(),
    failed: string[] = [];
  for (const [path, status, html] of [...pages].sort(comparePages)) {
    if (status !== 200) {
      failed.push(path);
      continue;
    }
    const parsed = parsePage(html);
    result.push({ address: path, ...parsed });
    for (const component of new Set(parsed.components)) {
      const paths = byComponent.get(component) ?? [];
      paths.push(path);
      byComponent.set(component, paths);
    }
  }
  return {
    pages: result,
    components: Object.fromEntries(
      [...byComponent].sort((a, b) => compareStrings(a[0], b[0])),
    ),
    pagesFailed: failed,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { project: { type: "string" }, "base-url": { type: "string" } },
  });
  if (!values.project || !values["base-url"])
    throw new Error(
      "usage: extract-compositions.ts --project DIR --base-url URL",
    );
  const { root, front } = siteConfig(values.project);
  const output = join(values.project, "compositions.json");
  writeJson(
    output,
    buildCompositions(
      await fetchPages(values["base-url"], addresses(root, front)),
    ),
  );
  console.log(output);
}

if (import.meta.main) await main();
