/** A port of baseline 3.14's html.parser.HTMLParser event stream (convert_charrefs=True), and of
 * html.unescape, so the published-page extractors see the same tags and text as the baseline
 * extractors did. Only start tags, end tags and text are reported: comments, declarations and
 * processing instructions are consumed and dropped, as the baseline subclasses ignore them.
 * Like feed() without close(), a construct the input ends inside is dropped. */
import { html5Entities } from "./html-entities.ts";

export type Attrs = Array<[string, string | null]>;
export interface HtmlHandler {
  starttag(tag: string, attrs: Attrs): void;
  endtag(tag: string): void;
  data(text: string): void;
  /** Defaults to starttag followed by endtag, as HTMLParser does. */
  startendtag?(tag: string, attrs: Attrs): void;
}

/** What baseline's str.split() / str.strip() treat as whitespace; JS \s differs at both ends. */
export const PY_SPACE =
  "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const SPACE_RUN = new RegExp(`[${PY_SPACE}]+`, "gu"),
  EDGE = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "gu");
export const pyStrip = (text: string): string => text.replace(EDGE, "");
export const pySplit = (text: string): string[] =>
  pyStrip(text).split(SPACE_RUN).filter(Boolean);
/** `" ".join(text.split())`. */
export const collapse = (text: string): string => pySplit(text).join(" ");

const INVALID_CHARREFS: Record<number, string> = {
  0: "�",
  13: "\r",
  128: "€",
  129: "\x81",
  130: "‚",
  131: "ƒ",
  132: "„",
  133: "…",
  134: "†",
  135: "‡",
  136: "ˆ",
  137: "‰",
  138: "Š",
  139: "‹",
  140: "Œ",
  141: "\x8d",
  142: "Ž",
  143: "\x8f",
  144: "\x90",
  145: "‘",
  146: "’",
  147: "“",
  148: "”",
  149: "•",
  150: "–",
  151: "—",
  152: "˜",
  153: "™",
  154: "š",
  155: "›",
  156: "œ",
  157: "\x9d",
  158: "ž",
  159: "Ÿ",
};
function numeric(ref: string): string {
  const hex = ref[1] === "x" || ref[1] === "X",
    number = hex
      ? Number.parseInt(ref.slice(2).replace(/;+$/, ""), 16)
      : Number.parseInt(ref.slice(1).replace(/;+$/, ""), 10);
  if (Object.hasOwn(INVALID_CHARREFS, number)) return INVALID_CHARREFS[number]!;
  if ((number >= 0xd800 && number <= 0xdfff) || number > 0x10ffff) return "�";
  if (
    (number >= 1 && number <= 8) ||
    number === 11 ||
    (number >= 14 && number <= 31) ||
    (number >= 0x7f && number <= 0x9f) ||
    (number >= 0xfdd0 && number <= 0xfdef) ||
    (number & 0xffff) >= 0xfffe
  )
    return "";
  return String.fromCodePoint(number);
}
const named = (name: string): string | undefined =>
  Object.hasOwn(html5Entities, name) ? html5Entities[name] : undefined;

/** html.unescape: HTML5 rules for valid and invalid references, longest named prefix wins. */
export function unescape(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu,
    (_match, ref: string) => {
      if (ref.startsWith("#")) return numeric(ref);
      const whole = named(ref);
      if (whole !== undefined) return whole;
      const points = Array.from(ref);
      for (let length = points.length - 1; length > 1; length--) {
        const head = named(points.slice(0, length).join(""));
        if (head !== undefined) return head + points.slice(length).join("");
      }
      return "&" + ref;
    },
  );
}
/** Attribute values unescape numeric references always, and a named one only when it is an
 * exact entity not followed by "=" (3.14's _unescape_attrvalue). */
function unescapeAttribute(value: string): string {
  return value.replace(
    /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*)[;=]?/g,
    (ref: string) => {
      if (ref.startsWith("&#")) return unescape(ref);
      return !ref.endsWith("=") && named(ref.slice(1)) !== undefined
        ? unescape(ref)
        : ref;
    },
  );
}

const TAG_OPEN = /<[a-zA-Z]/y,
  END_TAG_OPEN = /<\/[a-zA-Z]/y;
const TAG_NAME = /([a-zA-Z][^\t\n\r\f />]*)(?:[\t\n\r\f ]|\/(?!>))*/y;
const ATTRIBUTE =
  /((?<=['"\t\n\r\f /])[^\t\n\r\f />][^\t\n\r\f /=>]*)([\t\n\r\f ]*=[\t\n\r\f ]*('[^']*'|"[^"]*"|(?!['"])[^>\t\n\r\f ]*))?(?:[\t\n\r\f ]|\/(?!>))*/y;
const TAG_END =
  /[a-zA-Z][^\t\n\r\f />]*[\t\n\r\f /]*(?:(?<=['"\t\n\r\f /])[^\t\n\r\f />][^\t\n\r\f /=>]*(?:[\t\n\r\f ]*=[\t\n\r\f ]*(?:'[^']*'|"[^"]*"|(?!['"])[^>\t\n\r\f ]*))?[\t\n\r\f /]*)*>?/y;
const COMMENT_ABRUPT = /-?>/y,
  COMMENT_CLOSE = /--!?>/g;
const CDATA_ELEMENTS = new Set([
    "script",
    "style",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
  ]),
  RCDATA_ELEMENTS = new Set(["textarea", "title"]);
const at = (
  pattern: RegExp,
  text: string,
  index: number,
): RegExpExecArray | null => {
  pattern.lastIndex = index;
  return pattern.exec(text);
};
const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseHtml(raw: string, handler: HtmlHandler): void {
  const n = raw.length;
  let i = 0,
    escapable = true,
    cdata = null as string | null,
    closing = null as RegExp | null;
  const emitStartEnd =
    handler.startendtag ??
    ((tag: string, attrs: Attrs) => {
      handler.starttag(tag, attrs);
      handler.endtag(tag);
    });
  const enter = (tag: string, rcdata: boolean): void => {
    cdata = tag;
    escapable = rcdata;
    closing =
      tag === "plaintext"
        ? null
        : new RegExp(`</${escapeRegExp(tag)}(?=[\\t\\n\\r\\f />])`, "gi");
  };
  const leave = (): void => {
    cdata = null;
    escapable = true;
    closing = null;
  };
  /** End index of a start tag, or -1 when the input stops inside it. */
  const startTag = (from: number): number => {
    const found = at(TAG_END, raw, from + 1),
      end = from + 1 + found![0].length;
    if (raw[end - 1] !== ">") return -1;
    const name = at(TAG_NAME, raw, from + 1)!,
      tag = name[1]!.toLowerCase(),
      attrs: Attrs = [];
    let k = from + 1 + name[0].length;
    while (k < end) {
      const m = at(ATTRIBUTE, raw, k);
      if (!m) break;
      let value: string | null = m[2] ? (m[3] ?? "") : null;
      if (
        value &&
        (value[0] === "'" || value[0] === '"') &&
        value.at(-1) === value[0]
      )
        value = value.slice(1, -1);
      if (value) value = unescapeAttribute(value);
      attrs.push([m[1]!.toLowerCase(), value]);
      k += m[0].length;
    }
    const tail = pyStrip(raw.slice(k, end));
    if (tail !== ">" && tail !== "/>") {
      handler.data(raw.slice(from, end));
      return end;
    }
    if (tail.endsWith("/>")) emitStartEnd(tag, attrs);
    else {
      handler.starttag(tag, attrs);
      if (CDATA_ELEMENTS.has(tag) || tag === "plaintext") enter(tag, false);
      else if (RCDATA_ELEMENTS.has(tag)) enter(tag, true);
    }
    return end;
  };
  const bogusComment = (from: number): number => {
    const gt = raw.indexOf(">", from + 2);
    return gt < 0 ? -1 : gt + 1;
  };
  const endTag = (from: number): number => {
    if (raw.indexOf(">", from + 2) < 0) return -1;
    if (!at(END_TAG_OPEN, raw, from))
      return raw[from + 2] === ">" ? from + 3 : bogusComment(from);
    const found = at(TAG_END, raw, from + 2),
      end = from + 2 + found![0].length;
    if (raw[end - 1] !== ">") return -1;
    handler.endtag(at(TAG_NAME, raw, from + 2)![1]!.toLowerCase());
    leave();
    return end;
  };
  const comment = (from: number): number => {
    const abrupt = at(COMMENT_ABRUPT, raw, from + 4);
    if (abrupt) return from + 4 + abrupt[0].length;
    COMMENT_CLOSE.lastIndex = from + 4;
    const close = COMMENT_CLOSE.exec(raw);
    return close ? close.index + close[0].length : -1;
  };
  const declaration = (from: number): number => {
    if (raw.startsWith("<![CDATA[", from)) {
      const j = raw.indexOf("]]>", from + 9);
      return j < 0 ? -1 : j + 3;
    }
    if (raw.slice(from, from + 9).toLowerCase() === "<!doctype") {
      const gt = raw.indexOf(">", from + 9);
      return gt < 0 ? -1 : gt + 1;
    }
    return bogusComment(from);
  };
  while (i < n) {
    let j: number;
    if (!cdata) {
      j = raw.indexOf("<", i);
      if (j < 0) {
        // The text may end inside a character reference that more input would complete.
        const last = raw.lastIndexOf("&"),
          amp = last >= Math.max(i, n - 34) ? last : -1;
        if (amp >= 0 && !/[\t\n\r\f ;]/.test(raw.slice(amp))) break;
        j = n;
      }
    } else {
      if (!closing)
        j = n; // plaintext never ends
      else {
        closing.lastIndex = i;
        const match = closing.exec(raw);
        if (!match) break;
        j = match.index;
      }
    }
    if (i < j)
      handler.data(escapable ? unescape(raw.slice(i, j)) : raw.slice(i, j));
    i = j;
    if (i === n) break;
    let k: number;
    if (at(TAG_OPEN, raw, i)) k = startTag(i);
    else if (raw.startsWith("</", i)) k = endTag(i);
    else if (raw.startsWith("<!--", i)) k = comment(i);
    else if (raw.startsWith("<?", i)) {
      const gt = raw.indexOf(">", i + 2);
      k = gt < 0 ? -1 : gt + 1;
    } else if (raw.startsWith("<!", i)) k = declaration(i);
    else if (i + 1 < n) {
      handler.data("<");
      k = i + 1;
    } else break;
    if (k < 0) break;
    i = k;
  }
}
