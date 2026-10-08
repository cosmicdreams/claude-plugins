/** Find a verified, anonymously-reachable page address for every component (port of find_examples.ts).
 *
 * The specification file that shipped with one Site Studio library listed live example paths,
 * and they could not be trusted: two were behind login and at least one named a page the
 * component was not on. So this does not read claimed addresses - it crawls the public site
 * as an anonymous visitor and records where each component actually rendered.
 *
 * That the fetch is anonymous is the whole point. A page a designer cannot open is not an
 * example, so every recorded address carries the status code that proves it.
 *
 * Placement counts come out of the same pass for free, which is the `usage` plug point of
 * references/model.md. They are a LOWER BOUND over the pages actually scanned - never
 * present them as a site total unless the whole sitemap was walked. */
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import type { UsageInventory } from "./usage-types.ts";
import { compareStrings, httpGet } from "./extract-drupal-usage.ts";

export const UA =
  "design-lab/0.2 (+component library extraction; contact site owner)";

// How a rendered instance names its component in the markup.
//   Site Studio emits  class="coh-ce-cpt_text-280a9f1d"  - machine name, then an
//   instance hash. The machine name itself contains underscores, the hash is hex, so the
//   split has to be anchored on the LAST hyphen group being hex.
//   Drupal's paragraph templates emit  class="paragraph--type--full-width-row"  with
//   underscores in the bundle name converted to hyphens - so the extracted name needs
//   converting back before it will match a bundle machine name.
export const MARKERS = {
  sitestudio: /\bcoh-ce-([a-z0-9_]+)-[0-9a-f]{6,}\b/g,
  paragraphs: /\bparagraph--type--([a-z0-9-]+)\b/g,
} as const;
// A class attribute, so the two Site Studio markers can be read from the SAME element.
const CLASS_ATTR = /class="([^"]*)"/g;
// The per-placement identifier. This is the one that counts.
const INSTANCE = /\bcoh-component-instance-([0-9a-fA-F-]{8,})/;

export type Strategy = keyof typeof MARKERS;
export type Fetcher = (
  url: string,
  timeoutSeconds?: number,
) => Promise<[status: number, body: string]>;

/** Marker capture -> component machine name as it appears in configuration. */
export const normalise = (strategy: Strategy, raw: string): string =>
  strategy === "paragraphs" ? raw.replaceAll("-", "_") : raw;

/** Sitemaps often advertise the hosting origin rather than the public hostname.
 * One site's sitemap returns example.prod.acquia-sites.com, so an address recorded
 * straight from it sends a designer to an origin host that may be blocked or may serve a
 * different cache. Rewrite onto the host the caller actually asked for. */
export function canonical(url: string, baseHost: string): [string, number] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [url, 0];
  }
  if (parsed.host && baseHost && parsed.host !== baseHost) {
    parsed.host = baseHost;
    return [parsed.href, 1];
  }
  return [url, 0];
}

/** Anonymous GET. Returns [status, body] - never rejects, never sends a cookie. Certificates are
 * always verified here (unlike the Drupal extractors, no local-host exemption). */
export const fetchUrl: Fetcher = async (url, timeoutSeconds = 20) => {
  try {
    const result = await httpGet(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      timeoutMs: timeoutSeconds * 1000,
      relaxLocalTls: false,
    });
    if (result.status < 200 || result.status >= 300) return [result.status, ""];
    let raw = result.body;
    if (
      result.headers["content-encoding"] === "gzip" ||
      (raw[0] === 0x1f && raw[1] === 0x8b)
    )
      raw = gunzipSync(raw);
    return [result.status, raw.toString("utf8")];
  } catch (error) {
    return [0, String((error as Error).message ?? error)];
  } // DNS, timeout, TLS, redirect loop
};

/** Walk sitemap.xml, following one level of sitemap index. Falls back to the root. */
export async function sitemapUrls(
  base: string,
  limit: number,
  delay: number,
  fetcher: Fetcher = fetchUrl,
  log: (message: string) => void = console.error,
): Promise<string[]> {
  const seen = new Set<string>(),
    queue = [new URL("/sitemap.xml", base).href];
  let out: string[] = [];
  while (queue.length && out.length < limit) {
    const sitemap = queue.shift()!;
    if (seen.has(sitemap)) continue;
    seen.add(sitemap);
    const [status, body] = await fetcher(sitemap);
    if (status !== 200) continue;
    const locs = [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(
      (match) => match[1]!,
    );
    // A sitemap index points at more sitemaps; a urlset points at pages.
    if (body.includes("<sitemapindex")) queue.push(...locs);
    else out.push(...locs);
    await sleep(delay * 1000);
  }
  if (!out.length) {
    out = [base];
    log(
      `no sitemap found at ${new URL("/sitemap.xml", base).href} - falling back to the base address alone. Pass --urls to supply a list.`,
    );
  }
  return out.slice(0, limit);
}

/** Return [presence, placements] for one page.
 *
 * Two markers, and conflating them is the trap. Site Studio stamps
 * `coh-ce-<name>-<hash>` on EVERY styled element of a component template - the theme's
 * cpt_content_card_0 template carries eight different hashes across its root, image,
 * text wrapper, heading and paragraph. So the hash identifies an element of the
 * definition, not a placement, and counting distinct hashes reports a number that never
 * changes no matter how often the component is placed.
 *
 * `coh-component-instance-<uuid>` is the per-placement identifier. Pairing the two within
 * a single class attribute gives the real count: distinct instance uuids per component. */
export function scanSitestudio(
  body: string,
): [Set<string>, Record<string, number>] {
  const presence = new Set<string>(),
    instances = new Map<string, Set<string>>();
  for (const attr of body.matchAll(CLASS_ATTR)) {
    const classes = attr[1]!,
      names = [...classes.matchAll(MARKERS.sitestudio)].map(
        (match) => match[1]!,
      );
    if (!names.length) continue;
    for (const name of names) presence.add(name);
    const uuid = INSTANCE.exec(classes);
    if (uuid) {
      // The root element of a placement carries both markers.
      const found = instances.get(names[0]!) ?? new Set<string>();
      found.add(uuid[1]!);
      instances.set(names[0]!, found);
    }
  }
  return [
    presence,
    Object.fromEntries(
      [...instances].map(([name, uuids]) => [name, uuids.size]),
    ),
  ];
}

/** Drupal emits paragraph--type--<bundle> once per rendered paragraph, so occurrences
 * are already placements. */
export function scanParagraphs(
  body: string,
): [Set<string>, Record<string, number>] {
  const presence = new Set<string>(),
    counts: Record<string, number> = {};
  for (const match of body.matchAll(MARKERS.paragraphs)) {
    const name = normalise("paragraphs", match[1]!);
    presence.add(name);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return [presence, counts];
}

type CrawlExample = {url:string;marker:string;instancesOnPage:number;status:number;anonymous:boolean};
type CrawlUsage = {placements:number;tier:keyof typeof TIER_PAGE;figmaPage:string} & {examples:CrawlExample[];structuralRefs?:number;note?:string};
type UsageScan = {base:string;strategy:Strategy;pagesScanned:number;pagesFailed:{url:string;status:number}[];pagesFailedCount:number;placementsAreLowerBound:boolean;addressesRehostedOnto:string|null;addressesRehostedCount:number;componentsSeen:number;componentsUnseen:string[]};
type CrawlInventory = Omit<UsageInventory,'components'> & {components:(Omit<UsageInventory['components'][number],'usage'> & {usage?:Partial<CrawlUsage>})[];usageScan?:Partial<UsageScan>};
export type CrawlReport = {usageScan:UsageScan;usage?:Record<string,CrawlUsage>;components?:CrawlInventory['components']};
export interface Crawl {
  placements: Map<string, number>;
  examples: Map<string, CrawlExample[]>;
  scanned: number;
  failed: Array<{ url: string; status: number }>;
  rehosted: number;
}
export async function crawl(
  urls: string[],
  strategy: Strategy,
  delay: number,
  baseHost: string,
  fetcher: Fetcher = fetchUrl,
): Promise<Crawl> {
  const scan = strategy === "sitestudio" ? scanSitestudio : scanParagraphs;
  const placements = new Map<string, number>(),
    examples = new Map<string, CrawlExample[]>(),
    failed: Crawl["failed"] = [];
  let scanned = 0,
    rehosted = 0;
  for (const original of urls) {
    const [url, changed] = canonical(original, baseHost);
    rehosted += changed;
    const [status, body] = await fetcher(url);
    if (status !== 200) {
      failed.push({ url, status });
      await sleep(delay * 1000);
      continue;
    }
    scanned++;
    const [presence, counts] = scan(body);
    for (const name of presence) {
      const n = counts[name] ?? 0;
      placements.set(name, (placements.get(name) ?? 0) + n);
      const list = examples.get(name) ?? [];
      list.push({
        url,
        marker:
          strategy === "sitestudio"
            ? `coh-ce-${name}-`
            : `paragraph--type--${name.replaceAll("_", "-")}`,
        instancesOnPage: n,
        status: 200,
        anonymous: true,
      });
      examples.set(name, list);
    }
    await sleep(delay * 1000);
  }
  return { placements, examples, scanned, failed, rehosted };
}

// The Figma file organises components by usage tier, and these are the thresholds that
// organisation was built on. They are ABSOLUTE, not relative. An earlier version bucketed by
// thirds of the ranked distribution, which is wrong twice over: on a lightly-used site it
// still labels something "high", and it has no way to express the two categories that
// actually matter for a library review - a component placed nowhere but referenced by other
// components, and a component placed nowhere at all.
export const TIER_PAGE = {
  high: "Components — High Use",
  medium: "Components — Medium Use",
  low: "Components — Low Use",
  "structural only": "Components — Structural Only",
  unused: "Components — Retirement Candidates",
} as const;

/** Bucket a component for the Figma file organisation. */
export function tier(
  placements: number,
  structural = 0,
): keyof typeof TIER_PAGE {
  if (placements === 0 && structural === 0) return "unused";
  if (placements === 0 && structural > 0) return "structural only";
  if (placements >= 50) return "high";
  if (placements >= 10) return "medium";
  return "low";
}

export interface ReportOptions {
  base: string;
  strategy: Strategy;
  examplesPerComponent?: number;
  components?: CrawlInventory;
  merge?: boolean;
}
/** The JSON `main` prints: usage per observed component, optionally merged into components.json. */
export function buildReport(result: Crawl, options: ReportOptions): CrawlReport {
  const perComponent = options.examplesPerComponent ?? 3,
    baseHost = new URL(options.base).host;
  const usage: Record<string,CrawlUsage> = {};
  for (const [name, n] of result.placements) {
    const best = [...result.examples.get(name)!].sort(
      (a, b) => b["instancesOnPage"] - a["instancesOnPage"],
    );
    usage[name] = {
      placements: n,
      tier: tier(n),
      figmaPage: TIER_PAGE[tier(n)],
      examples: best.slice(0, perComponent),
    };
  }
  let doc: CrawlInventory | null = null,
    unseen: string[] = [];
  if (options.components) {
    doc = structuredClone(options.components);
    const known = new Set<string>(
      doc["components"].map((component) => component["id"]),
    );
    unseen = [...known]
      .filter((id) => !Object.hasOwn(usage, id))
      .sort(compareStrings);
    for (const component of doc["components"]) {
      const found = Object.hasOwn(usage, component["id"])
        ? usage[component["id"]]
        : undefined;
      if (found) {
        component["usage"] = found;
        continue;
      }
      // structuralRefs, when the inventory recorded them, is what separates a
      // component that other components use from one nobody uses at all.
      const structural: number = component["usage"]?.["structuralRefs"] || 0,
        t = tier(0, structural);
      component["usage"] = {
        placements: 0,
        structuralRefs: structural,
        tier: t,
        figmaPage: TIER_PAGE[t],
        examples: [],
        note: `not observed on any of the ${result.scanned} pages scanned. A page crawl undercounts badly - prefer counting placements from production layout canvases where the database is reachable.`,
      };
    }
  }
  const meta = {
    base: options.base,
    strategy: options.strategy,
    pagesScanned: result.scanned,
    pagesFailed: result.failed.slice(0, 20),
    pagesFailedCount: result.failed.length,
    placementsAreLowerBound: true,
    addressesRehostedOnto: result.rehosted ? baseHost : null,
    addressesRehostedCount: result.rehosted,
    componentsSeen: Object.keys(usage).length,
    componentsUnseen: unseen,
  };
  if (options.merge && doc) {
    doc["usageScan"] = { ...doc["usageScan"], ...meta };
    return {...doc,usageScan:{...doc.usageScan,...meta}};
  }
  return { usageScan: meta, usage };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      strategy: { type: "string" },
      limit: { type: "string", default: "200" },
      delay: { type: "string", default: "0.5" },
      urls: { type: "string" },
      components: { type: "string" },
      merge: { type: "boolean", default: false },
      "examples-per-component": { type: "string", default: "3" },
    },
  });
  const strategy = values.strategy as Strategy;
  if (!positionals[0] || !Object.hasOwn(MARKERS, strategy))
    throw new Error(
      "usage: find-examples.ts BASE --strategy sitestudio|paragraphs [--limit N] [--delay S] [--urls FILE] [--components FILE] [--merge]",
    );
  const base = positionals[0],
    limit = Number(values.limit),
    delay = Number(values.delay);
  const urls = values.urls
    ? readFileSync(values.urls, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : await sitemapUrls(base, limit, delay);
  const result = await crawl(
    urls.slice(0, limit),
    strategy,
    delay,
    new URL(base).host,
  );
  const components = values.components
    ? JSON.parse(readFileSync(values.components, "utf8"))
    : undefined;
  const report = buildReport(result, {
    base,
    strategy,
    examplesPerComponent: Number(values["examples-per-component"]),
    components,
    merge: values.merge,
  });
  console.log(JSON.stringify(report, null, 2));
  console.error(
    `scanned ${result.scanned} page(s), ${result.failed.length} failed; ${result.placements.size} component(s) observed`,
  );
}

if (import.meta.main) await main();
