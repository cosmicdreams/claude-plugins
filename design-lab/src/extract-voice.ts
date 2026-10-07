/** Deterministic, rule-based account of the copy on published pages (port of extract_voice.ts).
 *
 * Syllables use vowel groups after silent terminal e removal, with one syllable minimum.
 * This is an approximation for comparative Flesch-Kincaid grades, not a dictionary. */
import { pyFormatG as formatG } from './extract-tokens-sass.ts';
import { join } from "node:path";
import { parseArgs } from "node:util";
import { writeJson } from "./contracts.ts";
import type { Dict } from "./discovery-io.ts";
import { compareStrings } from "./extract-drupal-usage.ts";
import { comparePages } from "./find-rendered-components.ts";
import type { Page } from "./find-rendered-components.ts";
import { collapse, parseHtml, pyStrip } from "./html-parser.ts";
import { roundDecimal, roundEven } from "./json.ts";
import { addresses, fetchPages, siteConfig } from "./published-pages.ts";

// baseline's \w, \d, \b and \s are Unicode-aware; JS's are ASCII. These are the baseline meanings.
const W = "[\\p{L}\\p{N}_]",
  B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`,
  D = "\\p{Nd}",
  S =
    "[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const WORDS = /[A-Za-z]+(?:['’][A-Za-z]+)?/g,
  SENTENCES = /[^.!?]+[.!?]+|[^.!?]+$/g;
const words = (text: string): string[] => text.match(WORDS) ?? [];
const sentences = (text: string): string[] => text.match(SENTENCES) ?? [];
const hasWord = (text: string): boolean =>
  /[A-Za-z]+(?:['’][A-Za-z]+)?/.test(text);
const set = (text: string): Set<string> => new Set(text.split(" "));
export const STOP = set(
  "a an and are as at be by for from in is it of on or that the to was were with your you our we us",
);
export const IMPERATIVES = set(
  "apply ask book browse buy call check choose contact create discover donate download explore find get give join learn make meet read register request see send share shop sign start subscribe take try use view visit volunteer watch",
);
export const GENERIC = new Set([
  "learn more",
  "click here",
  "read more",
  "details",
  "more",
  "here",
  "submit",
  "view",
]);
const VOID = set(
  "area base br col embed hr img input link meta param source track wbr",
);
const EXCLUDE = set("script style template noscript svg header nav footer");
const NON_PROSE = set("td th dt dd label figcaption button nav figure table");
const UNITS = set("lb lbs kg g oz ft in cm mm m km mph rpm v w kw x");
const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const SECTIONS = [
  "Voice",
  "Naming & terminology",
  "Headlines",
  "Calls to action",
  "Readability",
  "Search",
];
const union = (...sets: Array<Set<string>>): Set<string> =>
  new Set(sets.flatMap((items) => [...items]));

class PageNode {
  tag: string;
  attrs: Map<string, string | null>;
  parent: PageNode | null;
  children: Array<PageNode | string> = [];
  constructor(
    tag = "",
    attrs: Array<[string, string | null]> = [],
    parent: PageNode | null = null,
  ) {
    this.tag = tag;
    this.attrs = new Map(attrs);
    this.parent = parent;
  }
  attr(name: string): string {
    return this.attrs.get(name) ?? "";
  }
  *walk(): Generator<PageNode> {
    yield this;
    for (const child of this.children)
      if (typeof child !== "string") yield* child.walk();
  }
  text(excluded: Set<string> = EXCLUDE): string {
    if (
      excluded.has(this.tag) ||
      this.attrs.has("hidden") ||
      this.attrs.get("aria-hidden") === "true"
    )
      return "";
    return collapse(
      this.children
        .map((child) =>
          typeof child === "string" ? child : child.text(excluded),
        )
        .join(" "),
    );
  }
}

function parseTree(html: string): PageNode {
  const root = new PageNode(),
    stack = [root];
  const open = (tag: string, attrs: Array<[string, string | null]>): void => {
    const node = new PageNode(tag, attrs, stack.at(-1)!);
    stack.at(-1)!.children.push(node);
    if (!VOID.has(tag)) stack.push(node);
  };
  const close = (tag: string): void => {
    for (let index = stack.length - 1; index > 0; index--)
      if (stack[index]!.tag === tag) {
        stack.length = index;
        return;
      }
  };
  parseHtml(html, {
    starttag: open,
    startendtag(tag, attrs) {
      open(tag, attrs);
      if (!VOID.has(tag)) close(tag);
    },
    endtag: close,
    data(text) {
      stack.at(-1)!.children.push(text);
    },
  });
  return root;
}

function* ancestors(node: PageNode, stop: PageNode): Generator<PageNode> {
  let current = node.parent;
  while (current !== null && current !== stop) {
    yield current;
    current = current.parent;
  }
}
const excludedAncestor = (
  node: PageNode,
  stop: PageNode,
  tags: Set<string>,
): boolean => [...ancestors(node, stop)].some((parent) => tags.has(parent.tag));
const STAT = new RegExp(
  `(?:^|[-_])(?:stat|stats|metric|number|figure)(?:$|[-_])`,
  "iu",
);
function statBlock(node: PageNode, stop: PageNode | null): boolean {
  return [node, ...(stop ? ancestors(node, stop) : [])].some((parent) =>
    parent
      .attr("class")
      .split(/\s+/)
      .filter(Boolean)
      .some((token) => STAT.test(token)),
  );
}
function positioningText(node: PageNode, excluded: Set<string>): string {
  if (
    excluded.has(node.tag) ||
    NON_PROSE.has(node.tag) ||
    /^h[1-6]$/.test(node.tag) ||
    node.attrs.has("hidden") ||
    node.attrs.get("aria-hidden") === "true" ||
    (node.parent && statBlock(node, node.parent))
  )
    return "";
  return collapse(
    node.children
      .map((child) =>
        typeof child === "string" ? child : positioningText(child, excluded),
      )
      .join(" "),
  );
}

export interface ParsedPage {
  title: string;
  description: string;
  text: string;
  headings: Record<string, string[]>;
  labels: string[];
  paragraphs: string[];
  prose: string[];
  bundle: string | null;
  positioningText: string;
  listItems: number;
  paragraphCount: number;
}
export function parsePage(html: string): ParsedPage {
  const root = parseTree(html),
    nodes = [...root.walk()];
  const main = nodes.find((node) => node.tag === "main"),
    body = nodes.find((node) => node.tag === "body") ?? root,
    content = main ?? body;
  const excluded = main ? EXCLUDE : union(EXCLUDE, set("header nav footer"));
  const title =
    nodes.find((node) => node.tag === "title")?.text(new Set()) ?? "";
  const meta = nodes.find(
    (node) =>
      node.tag === "meta" && node.attr("name").toLowerCase() === "description",
  );
  const visible = content.text(excluded);
  const inside = [...content.walk()].filter(
    (node) => ![...ancestors(node, content)].some((a) => excluded.has(a.tag)),
  );
  const nonProse = union(excluded, NON_PROSE);
  const headings = Object.fromEntries(
    ["1", "2", "3"].map((level) => [
      level,
      inside
        .filter((node) => node.tag === `h${level}`)
        .map((node) => node.text(excluded)),
    ]),
  );
  const labels = inside
    .filter((node) => node.tag === "a" || node.tag === "button")
    .map(
      (node) =>
        node.text(excluded) || node.attr("aria-label") || node.attr("value"),
    );
  const paragraphs = inside
    .filter(
      (node) =>
        node.tag === "p" &&
        !excludedAncestor(node, content, union(NON_PROSE, set("aside"))) &&
        !statBlock(node, content) &&
        node.text(nonProse),
    )
    .map((node) => node.text(nonProse));
  const proseTags = set("p li blockquote");
  const prose = inside
    .filter(
      (node) =>
        proseTags.has(node.tag) &&
        !excludedAncestor(node, content, NON_PROSE) &&
        !statBlock(node, content) &&
        ![...node.walk()].some(
          (child) => child !== node && proseTags.has(child.tag),
        ) &&
        node.text(nonProse),
    )
    .map((node) => node.text(nonProse));
  const classes = body.attr("class").split(/\s+/).filter(Boolean),
    typed = classes.find((name) => name.startsWith("page-node-type-"));
  return {
    title,
    description: meta ? pyStrip(meta.attr("content")) : "",
    text: visible,
    headings,
    labels: labels.filter(Boolean),
    paragraphs,
    prose,
    bundle: typed === undefined ? null : typed.slice("page-node-type-".length),
    positioningText: positioningText(content, excluded),
    listItems: inside.filter((node) => node.tag === "li").length,
    paragraphCount: paragraphs.length,
  };
}

function pageTemplate(path: string, value: ParsedPage): string {
  if (value.bundle) return "bundle:" + value.bundle;
  let segment = path.replace(/^\/+|\/+$/g, "").split("/")[0] || "<home>";
  if (new RegExp(`^${D}{4}-`, "u").test(segment)) segment = "<year>-slug";
  return "path:" + segment;
}
const cleanPhrase = (tokens: string[]): boolean =>
  tokens.every(
    (token) => token.length > 1 && !UNITS.has(token) && !/\p{Nd}/u.test(token),
  );
export function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b),
    rank = (ordered.length - 1) * fraction,
    low = Math.trunc(rank);
  return roundDecimal(
    ordered[low]! +
      (ordered[Math.min(low + 1, ordered.length - 1)]! - ordered[low]!) *
        (rank - low),
    2,
  );
}
export function syllables(word: string): number {
  let lower = word.toLowerCase();
  if (lower.length > 2 && lower.endsWith("e") && !lower.endsWith("le"))
    lower = lower.slice(0, -1);
  return Math.max(1, (lower.match(/[aeiouy]+/g) ?? []).length);
}
export function grade(text: string): number {
  const found = words(text),
    count = sentences(text).filter(hasWord).length;
  if (!found.length || !count) return 0;
  return roundDecimal(
    (0.39 * found.length) / count +
      (11.8 * found.reduce((sum, word) => sum + syllables(word), 0)) /
        found.length -
      15.59,
    2,
  );
}
const stat = (
  value: unknown,
  numerator: number,
  denominator: number,
  qualifier: string,
): Dict => ({ value, numerator, denominator, qualifier });
const percent = (numerator: number, denominator: number): string =>
  denominator ? `${roundEven((100 * numerator) / denominator)}%` : "0%";
const casefold = (text: string): string =>
  text.toLowerCase().replaceAll("ß", "ss").replaceAll("ſ", "s");
const isCased = (char: string): boolean =>
  char.toLowerCase() !== char.toUpperCase();
const isUpper = (text: string): boolean => {
  const cased = [...text].filter(isCased);
  return cased.length > 0 && cased.every((char) => char === char.toUpperCase());
};
const isLower = (text: string): boolean => {
  const cased = [...text].filter(isCased);
  return cased.length > 0 && cased.every((char) => char === char.toLowerCase());
};
const hasAlpha = (text: string): boolean => /\p{L}/u.test(text);
export function isTitleCase(text: string): boolean {
  const found = words(text);
  return (
    found.length > 0 &&
    found.every(
      (word) => /[A-Z]/.test(word[0]!) || STOP.has(word.toLowerCase()),
    ) &&
    found.some((word) => /[A-Z]/.test(word[0]!))
  );
}
export function isSentenceCase(text: string): boolean {
  const found = words(text);
  return found.length > 0 && /[A-Z]/.test(found[0]![0]!) && !isTitleCase(text);
}
/** baseline's format(value, 'g'): six significant digits, trailing zeros removed. */
export { pyFormatG as formatG } from './extract-tokens-sass.ts';
const byCountThenText =
  <T>(count: (item: T) => number, text: (item: T) => string) =>
  (a: T, b: T): number =>
    count(b) - count(a) || compareStrings(text(a), text(b));

function quotesFor(
  rows: Array<[string, ParsedPage]>,
  predicate: (value: ParsedPage) => string[],
  limit = 2,
): Dict[] {
  const result: Dict[] = [];
  for (const [path, value] of rows)
    for (const quote of predicate(value)) {
      if (
        quote &&
        !result.some(
          (have) => have["quote"] === quote && have["address"] === path,
        )
      )
        result.push({ quote, address: path });
      if (result.length === limit) return result;
    }
  return result;
}
const rule = (
  section: string,
  kind: string,
  name: string,
  numerator: number,
  denominator: number,
  quotes: Dict[] = [],
): Dict => ({
  section,
  kind,
  rule: name,
  evidence: { numerator, denominator, quotes: quotes.slice(0, 2) },
});
const tally = (values: Iterable<string>): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
};
const bySortedKey = <V>(map: Map<string, V>): Array<[string, V]> =>
  [...map].sort((a, b) => compareStrings(a[0], b[0]));
const needleCount = (text: string, pattern: RegExp): number =>
  (text.match(pattern) ?? []).length;

/** Pure reducer: identical inputs yield identical JSON. */
export function buildVoice(
  pages: Page[],
  siteName: string,
  generatedAt: string,
  front = "/",
): Dict {
  const rows: Array<[string, ParsedPage]> = [],
    failed: string[] = [];
  for (const [path, status, html] of [...pages].sort(comparePages)) {
    if (status === 200) rows.push([path, parsePage(html)]);
    else failed.push(path);
  }
  const texts = rows.map(([, value]) => value.text),
    allText = texts.join(" "),
    allWords = words(allText);
  const sentenceLengths = texts.flatMap((text) =>
    sentences(text)
      .filter(hasWord)
      .map((sentence) => words(sentence).length),
  );
  const labels: Array<[string, string]> = rows.flatMap(([path, value]) =>
    value.labels.map((label) => [path, label] as [string, string]),
  );
  const h1s: Array<[string, string]> = rows.flatMap(([path, value]) =>
    value.headings["1"]!.map((h) => [path, h] as [string, string]),
  );
  const headings: Array<[string, string]> = rows.flatMap(([path, value]) =>
    ["1", "2", "3"].flatMap((level) =>
      value.headings[level]!.map((h) => [path, h] as [string, string]),
    ),
  );
  const reader = allWords.filter(
    (word) => word.toLowerCase() === "you" || word.toLowerCase() === "your",
  ).length;
  const organisation = allWords.filter((word) =>
    ["we", "our", "us"].includes(word.toLowerCase()),
  ).length;
  const upperLabels = labels.filter(
    ([, label]) => isUpper(label) && hasAlpha(label),
  ).length;
  const labelCase: Record<string, number> = {
    allCaps: 0,
    titleCase: 0,
    sentenceCase: 0,
    lowerCase: 0,
    other: 0,
  };
  for (const [, label] of labels) {
    const key =
      isUpper(label) && hasAlpha(label)
        ? "allCaps"
        : isTitleCase(label)
          ? "titleCase"
          : isSentenceCase(label)
            ? "sentenceCase"
            : isLower(label)
              ? "lowerCase"
              : "other";
    labelCase[key]!++;
  }
  const titleH1 = h1s.filter(([, h]) => isTitleCase(h)).length;
  const nameWords = words(siteName);
  const namePattern = nameWords.length
    ? new RegExp(
        `${B}` +
          nameWords
            .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("[^\\p{L}\\p{N}]*") +
          `${B}`,
        "giu",
      )
    : null;
  const nameForms = tally(
    namePattern ? texts.flatMap((text) => text.match(namePattern) ?? []) : [],
  );
  const nameTotal = [...nameForms.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const phrasePages = new Map<string, Set<string>>(),
    properPages = new Map<string, Set<string>>();
  const bucket = (map: Map<string, Set<string>>, key: string): Set<string> => {
    let found = map.get(key);
    if (!found) {
      found = new Set();
      map.set(key, found);
    }
    return found;
  };
  const properName = new RegExp(`${B}(?:[A-Z][a-z]+(?:${S}+|$)){2,5}`, "gu");
  for (const [path, value] of rows) {
    for (const passage of value.prose) {
      const tokens = (
        passage.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?/g) ?? []
      ).map((word) => word.toLowerCase());
      for (const size of [2, 3])
        for (let offset = 0; offset <= tokens.length - size; offset++) {
          let phrase = tokens.slice(offset, offset + size);
          while (phrase.length && STOP.has(phrase[0]!))
            phrase = phrase.slice(1);
          while (phrase.length && STOP.has(phrase.at(-1)!))
            phrase = phrase.slice(0, -1);
          if (phrase.length >= 2 && cleanPhrase(phrase))
            bucket(phrasePages, phrase.join(" ")).add(path);
        }
    }
    for (const match of value.text.matchAll(properName))
      bucket(properPages, pyStrip(match[0])).add(path);
  }
  const sortedPaths = (paths: Set<string>): string[] =>
    [...paths].sort(compareStrings);
  const rank = byCountThenText<[string, Set<string>]>(
    ([, paths]) => paths.size,
    ([text]) => text,
  );
  const vocabulary = [...phrasePages]
    .sort(rank)
    .filter(
      ([, paths]) =>
        paths.size >= 3 &&
        new Set(
          rows
            .filter(([path]) => paths.has(path))
            .map(([path, value]) => pageTemplate(path, value)),
        ).size >= 2,
    )
    .slice(0, 16)
    .map(([phrase, paths]) => ({
      phrase,
      count: paths.size,
      pages: sortedPaths(paths),
    }));
  const names = [...properPages]
    .sort(rank)
    .filter(([, paths]) => paths.size >= 3)
    .map(([name, paths]) => ({
      name,
      count: paths.size,
      pages: sortedPaths(paths),
    }));
  const homepage =
    rows.find(([path]) => path === "/") ??
    rows.find(([path]) => path === front);
  let positioning: Dict;
  if (homepage) {
    const longParagraphs = homepage[1].paragraphs.filter(
      (p) => words(p).length >= 8,
    );
    const fallbackText =
      homepage[1].prose.filter((p) => words(p).length >= 8).join(" ") ||
      homepage[1].positioningText;
    const copy =
      longParagraphs.length >= 2
        ? longParagraphs.slice(0, 2)
        : sentences(fallbackText)
            .filter((s) => words(s).length >= 8)
            .map(pyStrip)
            .slice(0, 2);
    positioning = {
      address: homepage[0],
      h1: homepage[1].headings["1"]![0] || "",
      paragraphs: copy,
    };
  } else positioning = { address: null, h1: "", paragraphs: [] };
  const counts = tally(labels.map(([, label]) => label));
  const isGeneric = (label: string): boolean =>
    GENERIC.has(casefold(pyStrip(label)));
  const generic = labels.filter(([, label]) => isGeneric(label)).length;
  const verbFirst = labels.filter(([, label]) =>
    IMPERATIVES.has((words(label)[0] ?? "").toLowerCase()),
  ).length;
  const titleCounts = tally(rows.map(([, v]) => v.title).filter(Boolean)),
    descriptionCounts = tally(
      rows.map(([, v]) => v.description).filter(Boolean),
    );
  const h1Paths = new Map<string, Set<string>>();
  for (const [path, h] of h1s) if (h) bucket(h1Paths, casefold(h)).add(path);
  const h1Counts = new Map(
    [...h1Paths].map(([h, paths]) => [h, paths.size] as const),
  );
  const casing = new Map<string, Set<string>>();
  for (const [, h] of headings) bucket(casing, casefold(h)).add(h);
  const noH1 = rows
    .filter(([, v]) => !v.headings["1"]!.some(Boolean))
    .map(([path]) => path);
  const manyH1 = rows
    .filter(([, v]) => v.headings["1"]!.length > 1)
    .map(([path]) => path);
  const emptyMeta = rows
    .filter(([, v]) => !v.description)
    .map(([path]) => path);
  const grades = rows.map(([path, value]) => ({
    address: path,
    grade: grade(value.text),
  }));
  const commaWith = needleCount(
    allText,
    new RegExp(`${B}${W}+,${S}+${W}+,${S}+and${S}+${W}+`, "giu"),
  );
  const commaWithout = needleCount(
    allText,
    new RegExp(`${B}${W}+,${S}+${W}+${S}+and${S}+${W}+`, "giu"),
  );
  const headingText = headings.map(([, h]) => h).join(" ");
  const formatCounts = {
    thousandsSeparator: needleCount(
      allText,
      new RegExp(`${B}${D}{1,3}(?:,${D}{3})+${B}`, "gu"),
    ),
    percentSign: needleCount(allText, new RegExp(`${D}+(?:\\.${D}+)?%`, "gu")),
    plusSuffix: needleCount(allText, new RegExp(`${B}${D}+\\+`, "gu")),
  };
  const dates = {
    monthName: needleCount(
      allText,
      new RegExp(`${B}(?:${MONTHS})${S}+${D}{1,2}(?:,${S}*${D}{4})?`, "gu"),
    ),
    iso: needleCount(
      allText,
      new RegExp(`${B}${D}{4}-${D}{2}-${D}{2}${B}`, "gu"),
    ),
    slash: needleCount(
      allText,
      new RegExp(`${B}${D}{1,2}/${D}{1,2}/${D}{2,4}${B}`, "gu"),
    ),
  };
  const allCapsHeadings = headings
    .filter(([, h]) => isUpper(h) && hasAlpha(h))
    .map(([address, text]) => ({ address, text }));
  const titleLengths = { under30: 0, from30To60: 0, over60: 0 };
  for (const [, v] of rows) {
    const length = [...v.title].length;
    titleLengths[
      length < 30 ? "under30" : length <= 60 ? "from30To60" : "over60"
    ]++;
  }
  const medianGrade = percentile(
      grades.map((item) => item.grade),
      0.5,
    ),
    medianSentence = percentile(sentenceLengths, 0.5);
  const listItems = rows.reduce((sum, [, v]) => sum + v.listItems, 0),
    listBase = rows.reduce(
      (sum, [, v]) => sum + v.listItems + v.paragraphCount,
      0,
    );
  const evidence = {
    readerToOrganisationPronounRatio: stat(
      organisation ? roundDecimal(reader / organisation, 2) : null,
      reader,
      organisation,
      "null when no organisation pronouns",
    ),
    medianWordsPerSentence: stat(
      medianSentence,
      sentenceLengths.length,
      sentenceLengths.length,
      "interpolated median of non-empty sentences",
    ),
    p90WordsPerSentence: stat(
      percentile(sentenceLengths, 0.9),
      sentenceLengths.length,
      sentenceLengths.length,
      "interpolated 90th percentile",
    ),
    allCapsCallToActionShare: stat(
      labels.length ? roundDecimal(upperLabels / labels.length, 4) : 0,
      upperLabels,
      labels.length,
      "as authored",
    ),
    siteNameCount: stat(
      nameTotal,
      nameTotal,
      rows.length,
      "mentions per fetched page corpus",
    ),
    titleCaseH1Share: stat(
      h1s.length ? roundDecimal(titleH1 / h1s.length, 4) : 0,
      titleH1,
      h1s.length,
      "all level-one heading elements",
    ),
  };
  const mechanics = [
    {
      Rule: "Serial comma",
      "As published": { with: commaWith, without: commaWithout },
      Notes: "Three-item lists ending in and",
    },
    {
      Rule: "Ampersand in headings",
      "As published": {
        ampersand: needleCount(headingText, /&/g),
        and: needleCount(headingText, new RegExp(`${B}and${B}`, "giu")),
      },
      Notes: "Level one to three headings",
    },
    {
      Rule: "Number formatting",
      "As published": formatCounts,
      Notes: "Occurrences in visible copy",
    },
    {
      Rule: "Date formats",
      "As published": dates,
      Notes: "Month name, ISO, and slash forms",
    },
    {
      Rule: "Heading case",
      "As published": {
        titleCase: headings.filter(([, h]) => isTitleCase(h)).length,
        sentenceCase: headings.filter(([, h]) => isSentenceCase(h)).length,
      },
      Notes: "Other casing is excluded",
    },
    {
      Rule: "Call-to-action casing",
      "As published": labelCase,
      Notes: "As authored",
    },
  ];
  // Observations report the dominant measured pattern in each populated section.
  // Watches retain the fixed defect thresholds documented in the reference.
  let rules: Dict[] = [];
  if (allWords.length) {
    const voiceName =
      reader > organisation
        ? "Speaks to 'you' more than as 'we'"
        : organisation > reader
          ? "Speaks as 'we' more than to 'you'"
          : reader
            ? "Uses 'we' and 'you' equally"
            : "No reader or organisation pronouns found";
    rules.push(
      rule(
        "Voice",
        "OBSERVED",
        voiceName,
        Math.max(reader, organisation),
        reader + organisation ? reader + organisation : allWords.length,
      ),
    );
  }
  if (rows.length && siteName) {
    let dominantCount: number, naming: string;
    if (nameForms.size) {
      const [form, found] = [...nameForms].sort(
        byCountThenText<[string, number]>(
          (item) => item[1],
          (item) => item[0],
        ),
      )[0]!;
      dominantCount = found;
      naming = `Most common site-name form: ${form}`;
    } else {
      dominantCount = 0;
      naming = "Configured site name does not appear in main copy";
    }
    rules.push(
      rule(
        "Naming & terminology",
        "OBSERVED",
        naming,
        dominantCount,
        nameForms.size ? nameTotal : allWords.length,
      ),
    );
  }
  if (headings.length) {
    const titleCount = headings.filter(([, h]) => isTitleCase(h)).length,
      sentenceCount = headings.filter(([, h]) => isSentenceCase(h)).length;
    const [caseName, caseCount] = (
      [
        ["title case", titleCount],
        ["sentence case", sentenceCount],
        ["other casing", headings.length - titleCount - sentenceCount],
      ] as Array<[string, number]>
    ).sort(
      byCountThenText<[string, number]>(
        (item) => item[1],
        (item) => item[0],
      ),
    )[0]!;
    rules.push(
      rule(
        "Headlines",
        "OBSERVED",
        `Headings most often use ${caseName}`,
        caseCount,
        headings.length,
      ),
    );
  }
  if (labels.length) {
    // An observation states what the majority does, never the opposite of its own numbers.
    if (verbFirst * 2 >= labels.length)
      rules.push(
        rule(
          "Calls to action",
          "OBSERVED",
          "Call-to-action labels begin with a verb",
          verbFirst,
          labels.length,
        ),
      );
    else
      rules.push(
        rule(
          "Calls to action",
          "OBSERVED",
          "Most call-to-action labels do not begin with a verb",
          labels.length - verbFirst,
          labels.length,
        ),
      );
  }
  if (grades.length) {
    const observed = rule(
      "Readability",
      "OBSERVED",
      `Median reading grade: ${formatG(medianGrade)}`,
      grades.length,
      rows.length,
    );
    observed["evidence"]["value"] = medianGrade;
    rules.push(observed);
  }
  if (rows.length && (rows.length - emptyMeta.length) * 2 >= rows.length)
    rules.push(
      rule(
        "Search",
        "OBSERVED",
        "Pages have a meta description",
        rows.length - emptyMeta.length,
        rows.length,
      ),
    );
  if (nameForms.size > 1) {
    // One quote per distinct form, from the first page (in address order) that uses it.
    const firstPage = new Map<string, string>();
    for (const [address, v] of [...rows].sort((a, b) =>
      compareStrings(a[0], b[0]),
    ))
      for (const m of namePattern ? (v.text.match(namePattern) ?? []) : [])
        if (!firstPage.has(m)) firstPage.set(m, address);
    const formQuotes = [...firstPage.keys()]
      .sort(
        byCountThenText<string>(
          (form) => nameForms.get(form) ?? 0,
          (form) => form,
        ),
      )
      .slice(0, 3)
      .map((form) => ({ quote: form, address: firstPage.get(form)! }));
    rules.push(
      rule(
        "Naming & terminology",
        "WATCH",
        "Site name has multiple published forms",
        nameForms.size,
        nameTotal,
        formQuotes,
      ),
    );
  }
  const casingVariants = new Set(
    [...casing].filter(([, forms]) => forms.size > 1).map(([h]) => h),
  );
  if (casingVariants.size)
    rules.push(
      rule(
        "Headlines",
        "WATCH",
        "Heading casing varies",
        casingVariants.size,
        casing.size,
        headings
          .filter(([, h]) => casingVariants.has(casefold(h)))
          .map(([p, h]) => ({ quote: h, address: p }))
          .slice(0, 2),
      ),
    );
  if (noH1.length)
    rules.push(
      rule(
        "Headlines",
        "WATCH",
        "Pages missing a level-one heading",
        noH1.length,
        rows.length,
      ),
    );
  const duplicates = new Set(
    [...h1Counts].filter(([, c]) => c > 1).map(([h]) => h),
  );
  if (duplicates.size)
    rules.push(
      rule(
        "Headlines",
        "WATCH",
        "Duplicate level-one headings",
        duplicates.size,
        h1Counts.size,
        h1s
          .filter(([, h]) => duplicates.has(casefold(h)))
          .map(([p, h]) => ({ quote: h, address: p }))
          .slice(0, 2),
      ),
    );
  if (generic && labels.length && generic / labels.length > 0.1)
    rules.push(
      rule(
        "Calls to action",
        "WATCH",
        "Generic call-to-action labels",
        generic,
        labels.length,
        labels
          .filter(([, label]) => isGeneric(label))
          .map(([path, label]) => ({ quote: label, address: path }))
          .slice(0, 2),
      ),
    );
  if (sentenceLengths.length && medianSentence > 25)
    rules.push(
      rule(
        "Readability",
        "WATCH",
        "Long typical sentences",
        sentenceLengths.filter((n) => n > 25).length,
        sentenceLengths.length,
        quotesFor(rows, (v) =>
          sentences(v.text)
            .map(pyStrip)
            .filter((s) => words(s).length > 25),
        ),
      ),
    );
  if (emptyMeta.length)
    rules.push(
      rule(
        "Search",
        "WATCH",
        "Pages missing a meta description",
        emptyMeta.length,
        rows.length,
      ),
    );
  rules = rules
    .map((row, index) => [row, index] as const)
    .sort(
      ([a, i], [b, j]) =>
        SECTIONS.indexOf(a["section"]) - SECTIONS.indexOf(b["section"]) ||
        compareStrings(a["rule"], b["rule"]) ||
        i - j,
    )
    .map(([row]) => row);
  const defects = rules.filter(
    (row) =>
      row["kind"] === "WATCH" &&
      [
        "Site name has multiple published forms",
        "Heading casing varies",
        "Duplicate level-one headings",
        "Pages missing a level-one heading",
        "Pages missing a meta description",
      ].includes(row["rule"]),
  );
  const stats = [
    {
      value: `${reader} : ${organisation}`,
      label: "Reader : organisation pronouns",
      qualifier: "you/your : we/our/us",
    },
    {
      value: formatG(medianSentence),
      label: "Median words per sentence",
      qualifier: `${sentenceLengths.length} sentences`,
    },
    {
      value: percent(titleH1, h1s.length),
      label: "Title-case level-one headings",
      qualifier: `${titleH1}/${h1s.length} headings`,
    },
    {
      value: percent(verbFirst, labels.length),
      label: "Verb-first calls to action",
      qualifier: `${verbFirst}/${labels.length} labels`,
    },
    {
      value: formatG(medianGrade),
      label: "Median reading grade",
      qualifier: `${grades.length} pages; approximate`,
    },
  ];
  const countList = (
    map: Map<string, number>,
    only?: (key: string) => boolean,
  ): Array<[string, number]> =>
    bySortedKey(map).filter(([key]) => !only || only(key));
  return {
    generatedAt,
    corpus: {
      pagesFetched: rows.length,
      pagesFailed: failed,
      sentences: sentenceLengths.length,
      words: allWords.length,
      callToActionLabels: labels.length,
      fetchDate: generatedAt.slice(0, 10),
    },
    evidence,
    stats,
    positioning,
    vocabulary: { phrases: vocabulary, names },
    nameForms: {
      forms: bySortedKey(nameForms).map(([form, count]) => ({ form, count })),
      multipleForms: nameForms.size > 1,
    },
    mechanics,
    headlines: {
      noH1,
      multipleH1: manyH1,
      duplicateH1: bySortedKey(h1Counts)
        .filter(([, c]) => c > 1)
        .map(([text, count]) => ({ text, count })),
      casingVariants: bySortedKey(casing)
        .filter(([, forms]) => forms.size > 1)
        .map(([text, forms]) => ({ text, forms: sortedPaths(forms) })),
      allCaps: allCapsHeadings,
    },
    callsToAction: {
      verbFirstShare: stat(
        labels.length ? roundDecimal(verbFirst / labels.length, 4) : 0,
        verbFirst,
        labels.length,
        "fixed imperative verb list",
      ),
      genericLabels: {
        count: generic,
        labels: countList(counts, isGeneric).map(([label, count]) => ({
          label,
          count,
        })),
      },
      mostCommon: [...counts]
        .sort(
          byCountThenText<[string, number]>(
            (item) => item[1],
            (item) => item[0],
          ),
        )
        .slice(0, 12)
        .map(([label, count]) => ({ label, count })),
    },
    readability: {
      pages: grades,
      medianGrade,
      p90Grade: percentile(
        grades.map((item) => item.grade),
        0.9,
      ),
      listItemShare: stat(
        listBase ? roundDecimal(listItems / listBase, 4) : 0,
        listItems,
        listBase,
        "list items divided by list items plus paragraphs",
      ),
    },
    search: {
      titleLengths,
      duplicateTitles: bySortedKey(titleCounts)
        .filter(([, c]) => c > 1)
        .map(([title, count]) => ({ title, count })),
      missingMetaDescription: emptyMeta,
      duplicateMetaDescriptions: bySortedKey(descriptionCounts)
        .filter(([, c]) => c > 1)
        .map(([description, count]) => ({ description, count })),
      h1EmptyOrSiteName: rows
        .filter(
          ([, v]) =>
            !v.headings["1"]!.some(Boolean) ||
            v.headings["1"]!.some((h) => casefold(h) === casefold(siteName)),
        )
        .map(([p]) => p),
    },
    rules,
    inconsistencies: defects,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      "base-url": { type: "string" },
      "max-pages": { type: "string", default: "400" },
    },
  });
  if (!values.project || !values["base-url"])
    throw new Error(
      "usage: extract-voice.ts --project DIR --base-url URL [--max-pages N]",
    );
  const { root, name, front } = siteConfig(values.project);
  const pages = await fetchPages(
    values["base-url"],
    addresses(root, front, Number(values["max-pages"])),
  );
  const output = join(values.project, "voice.json");
  writeJson(
    output,
    buildVoice(
      pages,
      name,
      new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
      front,
    ),
  );
  console.log(output);
}

if (import.meta.main) await main();
