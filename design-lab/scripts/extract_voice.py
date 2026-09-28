#!/usr/bin/env python3
"""Deterministic, rule-based account of the copy on published pages.

Syllables use vowel groups after silent terminal e removal, with one syllable minimum.
This is an approximation for comparative Flesch-Kincaid grades, not a dictionary.
"""

import argparse
import collections
import datetime
import json
import re
import statistics
from html.parser import HTMLParser
from pathlib import Path

from artifact_contracts import write_json
from published_pages import addresses, fetch_pages, site_config

WORDS = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")
SENTENCES = re.compile(r"[^.!?]+[.!?]+|[^.!?]+$")
STOP = frozenset("a an and are as at be by for from in is it of on or that the to was were with your you our we us".split())
IMPERATIVES = frozenset("apply ask book browse buy call check choose contact create discover donate download explore find get give join learn make meet read register request see send share shop sign start subscribe take try use view visit volunteer watch".split())
GENERIC = frozenset(("learn more", "click here", "read more", "details", "more", "here", "submit", "view"))
VOID = frozenset("area base br col embed hr img input link meta param source track wbr".split())
EXCLUDE = frozenset("script style template noscript svg header nav footer".split())
NON_PROSE = frozenset("td th dt dd label figcaption button nav figure table".split())
UNITS = frozenset("lb lbs kg g oz ft in cm mm m km mph rpm v w kw x".split())
MONTHS = r"January|February|March|April|May|June|July|August|September|October|November|December"


class Node:
    def __init__(self, tag="", attrs=(), parent=None):
        self.tag, self.attrs, self.parent = tag, dict(attrs), parent
        self.children = []

    def walk(self):
        yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.walk()

    def text(self, excluded=EXCLUDE):
        if self.tag in excluded or "hidden" in self.attrs or self.attrs.get("aria-hidden") == "true":
            return ""
        pieces = [child.text(excluded) if isinstance(child, Node) else child for child in self.children]
        return " ".join(" ".join(pieces).split())


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def parse_page(html):
    parser = PageParser()
    parser.feed(html)
    nodes = list(parser.root.walk())
    main = next((n for n in nodes if n.tag == "main"), None)
    body = next((n for n in nodes if n.tag == "body"), parser.root)
    content = main or body
    excluded = EXCLUDE if main else EXCLUDE | {"header", "nav", "footer"}
    title = next((n.text(frozenset()) for n in nodes if n.tag == "title"), "")
    meta = next((n.attrs.get("content", "").strip() for n in nodes if n.tag == "meta"
                 and n.attrs.get("name", "").lower() == "description"), "")
    visible = content.text(excluded)
    inside = [n for n in content.walk() if not any(a.tag in excluded for a in ancestors(n, content))]
    headings = {str(level): [n.text(excluded) for n in inside if n.tag == f"h{level}"] for level in (1, 2, 3)}
    labels = [n.text(excluded) or n.attrs.get("aria-label", "") or n.attrs.get("value", "")
              for n in inside if n.tag in ("a", "button")]
    paragraphs = [n.text(excluded | NON_PROSE) for n in inside if n.tag == "p"
                  and not excluded_ancestor(n, content, NON_PROSE | {"aside"})
                  and not stat_block(n, content) and n.text(excluded | NON_PROSE)]
    prose = [n.text(excluded | NON_PROSE) for n in inside if n.tag in ("p", "li", "blockquote")
             and not excluded_ancestor(n, content, NON_PROSE)
             and not stat_block(n, content)
             and not any(child.tag in ("p", "li", "blockquote") for child in n.walk() if child is not n)
             and n.text(excluded | NON_PROSE)]
    classes = body.attrs.get("class", "").split()
    bundle = next((name.removeprefix("page-node-type-") for name in classes
                   if name.startswith("page-node-type-")), None)
    return {"title": title, "description": meta, "text": visible, "headings": headings,
            "labels": [x for x in labels if x], "paragraphs": paragraphs, "prose": prose,
            "bundle": bundle, "positioningText": positioning_text(content, excluded),
            "listItems": sum(n.tag == "li" for n in inside), "paragraphCount": len(paragraphs)}


def ancestors(node, stop):
    current = node.parent
    while current is not None and current is not stop:
        yield current
        current = current.parent


def excluded_ancestor(node, stop, tags):
    return any(parent.tag in tags for parent in ancestors(node, stop))


def stat_block(node, stop):
    return any(re.search(r"(?:^|[-_])(?:stat|stats|metric|number|figure)(?:$|[-_])", token, re.I)
               for parent in (node, *ancestors(node, stop))
               for token in parent.attrs.get("class", "").split())


def positioning_text(node, excluded):
    if (node.tag in excluded | NON_PROSE | {"h1", "h2", "h3", "h4", "h5", "h6"}
            or "hidden" in node.attrs or node.attrs.get("aria-hidden") == "true"
            or stat_block(node, node.parent)):
        return ""
    pieces = [positioning_text(child, excluded) if isinstance(child, Node) else child
              for child in node.children]
    return " ".join(" ".join(pieces).split())


def page_template(path, value):
    if value["bundle"]:
        return "bundle:" + value["bundle"]
    segment = path.strip("/").split("/")[0] or "<home>"
    if re.match(r"^\d{4}-", segment):
        segment = "<year>-slug"
    return "path:" + segment


def clean_phrase(tokens):
    return all(len(token) > 1 and token not in UNITS and not any(c.isdigit() for c in token)
               for token in tokens)


def percentile(values, fraction):
    if not values:
        return 0
    ordered = sorted(values)
    rank = (len(ordered) - 1) * fraction
    low = int(rank)
    return round(ordered[low] + (ordered[min(low + 1, len(ordered) - 1)] - ordered[low]) * (rank - low), 2)


def syllables(word):
    lower = word.lower()
    if len(lower) > 2 and lower.endswith("e") and not lower.endswith("le"):
        lower = lower[:-1]
    return max(1, len(re.findall(r"[aeiouy]+", lower)))


def grade(text):
    words = WORDS.findall(text)
    sentences = [s for s in SENTENCES.findall(text) if WORDS.search(s)]
    if not words or not sentences:
        return 0
    return round(0.39 * len(words) / len(sentences) +
                 11.8 * sum(syllables(word) for word in words) / len(words) - 15.59, 2)


def stat(value, numerator, denominator, qualifier):
    return {"value": value, "numerator": numerator, "denominator": denominator,
            "qualifier": qualifier}


def percent(numerator, denominator):
    return f"{round(100 * numerator / denominator):d}%" if denominator else "0%"


def quotes_for(rows, predicate, limit=2):
    result = []
    for path, value in rows:
        for quote in predicate(value):
            if quote and {"quote": quote, "address": path} not in result:
                result.append({"quote": quote, "address": path})
            if len(result) == limit:
                return result
    return result


def rule(section, kind, name, numerator, denominator, quotes=()):
    return {"section": section, "kind": kind, "rule": name,
            "evidence": {"numerator": numerator, "denominator": denominator,
                         "quotes": list(quotes)[:2]}}


def build_voice(pages, site_name, generated_at, front="/"):
    """Pure reducer: identical inputs yield identical JSON bytes with sort_keys=True."""
    rows, failed = [], []
    for path, status, html in sorted(pages):
        if status == 200:
            rows.append((path, parse_page(html)))
        else:
            failed.append(path)
    texts = [value["text"] for _, value in rows]
    all_text = " ".join(texts)
    words = WORDS.findall(all_text)
    sentence_lengths = [len(WORDS.findall(s)) for text in texts for s in SENTENCES.findall(text)
                        if WORDS.search(s)]
    labels = [(path, label) for path, value in rows for label in value["labels"]]
    h1s = [(path, h) for path, value in rows for h in value["headings"]["1"]]
    headings = [(path, h) for path, value in rows for level in ("1", "2", "3") for h in value["headings"][level]]
    reader = sum(w.lower() in ("you", "your") for w in words)
    organisation = sum(w.lower() in ("we", "our", "us") for w in words)
    upper_labels = sum(label.isupper() and any(c.isalpha() for c in label) for _, label in labels)
    label_case = {"allCaps": 0, "titleCase": 0, "sentenceCase": 0, "lowerCase": 0, "other": 0}
    for _, label in labels:
        key = ("allCaps" if label.isupper() and any(c.isalpha() for c in label) else
               "titleCase" if is_title_case(label) else
               "sentenceCase" if is_sentence_case(label) else
               "lowerCase" if label.islower() else "other")
        label_case[key] += 1
    title_h1 = sum(is_title_case(h) for _, h in h1s)
    name_pattern = re.compile(r"\b" + r"[\s\W_]*".join(map(re.escape, WORDS.findall(site_name))) + r"\b", re.I) if WORDS.findall(site_name) else None
    name_forms = collections.Counter(m.group() for text in texts for m in (name_pattern.finditer(text) if name_pattern else ()))
    phrase_pages = collections.defaultdict(set)
    proper_pages = collections.defaultdict(set)
    for path, value in rows:
        for passage in value["prose"]:
            tokens = [w.lower() for w in re.findall(r"[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?", passage)]
            for size in (2, 3):
                for offset in range(len(tokens) - size + 1):
                    phrase = tokens[offset:offset + size]
                    while phrase and phrase[0] in STOP:
                        phrase = phrase[1:]
                    while phrase and phrase[-1] in STOP:
                        phrase = phrase[:-1]
                    if len(phrase) >= 2 and clean_phrase(phrase):
                        phrase_pages[" ".join(phrase)].add(path)
        for match in re.finditer(r"\b(?:[A-Z][a-z]+(?:\s+|$)){2,5}", value["text"]):
            proper_pages[match.group().strip()].add(path)
    vocabulary = [{"phrase": phrase, "count": len(paths), "pages": sorted(paths)}
                  for phrase, paths in sorted(phrase_pages.items(), key=lambda item: (-len(item[1]), item[0]))
                  if len(paths) >= 3 and len({page_template(path, value) for path, value in rows
                                               if path in paths}) >= 2][:16]
    names = [{"name": name, "count": len(paths), "pages": sorted(paths)}
             for name, paths in sorted(proper_pages.items(), key=lambda item: (-len(item[1]), item[0]))
             if len(paths) >= 3]
    homepage = next(((path, value) for path, value in rows if path == "/"), None)
    if homepage is None:
        homepage = next(((path, value) for path, value in rows if path == front), None)
    if homepage:
        long_paragraphs = [p for p in homepage[1]["paragraphs"] if len(WORDS.findall(p)) >= 8]
        fallback_text = (" ".join(p for p in homepage[1]["prose"] if len(WORDS.findall(p)) >= 8)
                         or homepage[1]["positioningText"])
        positioning_copy = (long_paragraphs[:2] if len(long_paragraphs) >= 2 else
                            [s.strip() for s in SENTENCES.findall(fallback_text)
                             if len(WORDS.findall(s)) >= 8][:2])
        positioning = {"address": homepage[0], "h1": (homepage[1]["headings"]["1"] or [""])[0],
                       "paragraphs": positioning_copy}
    else:
        positioning = {"address": None, "h1": "", "paragraphs": []}
    counts = collections.Counter(label for _, label in labels)
    generic = sum(label.casefold().strip() in GENERIC for _, label in labels)
    verb_first = sum((WORDS.findall(label) or [""])[0].lower() in IMPERATIVES for _, label in labels)
    title_counts = collections.Counter(v["title"] for _, v in rows if v["title"])
    description_counts = collections.Counter(v["description"] for _, v in rows if v["description"])
    h1_paths = collections.defaultdict(set)
    for path, h in h1s:
        if h:
            h1_paths[h.casefold()].add(path)
    h1_counts = {h: len(paths) for h, paths in h1_paths.items()}
    casing = collections.defaultdict(set)
    for _, h in headings:
        casing[h.casefold()].add(h)
    no_h1 = [path for path, v in rows if not any(v["headings"]["1"])]
    many_h1 = [path for path, v in rows if len(v["headings"]["1"]) > 1]
    empty_meta = [path for path, v in rows if not v["description"]]
    grades = [{"address": path, "grade": grade(value["text"])} for path, value in rows]
    comma_with = len(re.findall(r"\b\w+,\s+\w+,\s+and\s+\w+", all_text, re.I))
    comma_without = len(re.findall(r"\b\w+,\s+\w+\s+and\s+\w+", all_text, re.I))
    heading_text = " ".join(h for _, h in headings)
    format_counts = {"thousandsSeparator": len(re.findall(r"\b\d{1,3}(?:,\d{3})+\b", all_text)),
                     "percentSign": len(re.findall(r"\d+(?:\.\d+)?%", all_text)),
                     "plusSuffix": len(re.findall(r"\b\d+\+", all_text))}
    dates = {"monthName": len(re.findall(rf"\b(?:{MONTHS})\s+\d{{1,2}}(?:,\s*\d{{4}})?", all_text)),
             "iso": len(re.findall(r"\b\d{4}-\d{2}-\d{2}\b", all_text)),
             "slash": len(re.findall(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", all_text))}
    all_caps_headings = [{"address": p, "text": h} for p, h in headings if h.isupper() and any(c.isalpha() for c in h)]
    title_lengths = {"under30": 0, "from30To60": 0, "over60": 0}
    for _, v in rows:
        length = len(v["title"])
        title_lengths["under30" if length < 30 else "from30To60" if length <= 60 else "over60"] += 1
    evidence = {
        "readerToOrganisationPronounRatio": stat(round(reader / organisation, 2) if organisation else None, reader, organisation, "null when no organisation pronouns"),
        "medianWordsPerSentence": stat(percentile(sentence_lengths, .5), len(sentence_lengths), len(sentence_lengths), "interpolated median of non-empty sentences"),
        "p90WordsPerSentence": stat(percentile(sentence_lengths, .9), len(sentence_lengths), len(sentence_lengths), "interpolated 90th percentile"),
        "allCapsCallToActionShare": stat(round(upper_labels / len(labels), 4) if labels else 0, upper_labels, len(labels), "as authored"),
        "siteNameCount": stat(sum(name_forms.values()), sum(name_forms.values()), len(rows), "mentions per fetched page corpus"),
        "titleCaseH1Share": stat(round(title_h1 / len(h1s), 4) if h1s else 0, title_h1, len(h1s), "all level-one heading elements"),
    }
    mechanics = [
        {"Rule": "Serial comma", "As published": {"with": comma_with, "without": comma_without}, "Notes": "Three-item lists ending in and"},
        {"Rule": "Ampersand in headings", "As published": {"ampersand": len(re.findall(r"&", heading_text)), "and": len(re.findall(r"\band\b", heading_text, re.I))}, "Notes": "Level one to three headings"},
        {"Rule": "Number formatting", "As published": format_counts, "Notes": "Occurrences in visible copy"},
        {"Rule": "Date formats", "As published": dates, "Notes": "Month name, ISO, and slash forms"},
        {"Rule": "Heading case", "As published": {"titleCase": sum(is_title_case(h) for _, h in headings), "sentenceCase": sum(is_sentence_case(h) for _, h in headings)}, "Notes": "Other casing is excluded"},
        {"Rule": "Call-to-action casing", "As published": label_case, "Notes": "As authored"},
    ]
    # Observations report the dominant measured pattern in each populated section.
    # Watches retain the fixed defect thresholds documented in the reference.
    rules = []
    if words:
        voice_name = ("Speaks to 'you' more than as 'we'" if reader > organisation else
                      "Speaks as 'we' more than to 'you'" if organisation > reader else
                      "Uses 'we' and 'you' equally" if reader else
                      "No reader or organisation pronouns found")
        rules.append(rule("Voice", "OBSERVED", voice_name, max(reader, organisation),
                          reader + organisation if reader + organisation else len(words)))
    if rows and site_name:
        if name_forms:
            dominant_form, dominant_count = sorted(name_forms.items(), key=lambda item: (-item[1], item[0]))[0]
            naming = f"Most common site-name form: {dominant_form}"
        else:
            dominant_count, naming = 0, "Configured site name does not appear in main copy"
        rules.append(rule("Naming & terminology", "OBSERVED", naming,
                          dominant_count, sum(name_forms.values()) if name_forms else len(words)))
    if headings:
        title_count = sum(is_title_case(h) for _, h in headings)
        sentence_count = sum(is_sentence_case(h) for _, h in headings)
        other_count = len(headings) - title_count - sentence_count
        case_name, case_count = sorted((("title case", title_count), ("sentence case", sentence_count),
                                        ("other casing", other_count)), key=lambda item: (-item[1], item[0]))[0]
        rules.append(rule("Headlines", "OBSERVED", f"Headings most often use {case_name}", case_count, len(headings)))
    if labels:
        # An observation states what the majority does, never the opposite of its own numbers.
        if verb_first * 2 >= len(labels):
            rules.append(rule("Calls to action", "OBSERVED", "Call-to-action labels begin with a verb",
                              verb_first, len(labels)))
        else:
            rules.append(rule("Calls to action", "OBSERVED", "Most call-to-action labels do not begin with a verb",
                              len(labels) - verb_first, len(labels)))
    if grades:
        median_grade = percentile([item["grade"] for item in grades], .5)
        observed_grade = rule("Readability", "OBSERVED", f"Median reading grade: {median_grade:g}",
                              len(grades), len(rows))
        observed_grade["evidence"]["value"] = median_grade
        rules.append(observed_grade)
    if rows and (len(rows) - len(empty_meta)) * 2 >= len(rows):
        rules.append(rule("Search", "OBSERVED", "Pages have a meta description",
                          len(rows) - len(empty_meta), len(rows)))
    if len(name_forms) > 1:
        # One quote per distinct form, from the first page (in address order) that uses it.
        first_page = {}
        for address, v in sorted(rows, key=lambda r: r[0]):
            for m in (name_pattern.finditer(v["text"]) if name_pattern else []):
                first_page.setdefault(m.group(), address)
        form_quotes = [{"quote": f, "address": first_page[f]} for f in sorted(first_page, key=lambda f: (-name_forms.get(f, 0), f))][:3]
        rules.append(rule("Naming & terminology", "WATCH", "Site name has multiple published forms", len(name_forms), sum(name_forms.values()),
                          form_quotes))
    casing_variants = {h for h, forms in casing.items() if len(forms) > 1}
    if casing_variants:
        rules.append(rule("Headlines", "WATCH", "Heading casing varies", len(casing_variants), len(casing),
                          [{"quote": h, "address": p} for p, h in headings if h.casefold() in casing_variants][:2]))
    if no_h1:
        rules.append(rule("Headlines", "WATCH", "Pages missing a level-one heading", len(no_h1), len(rows)))
    duplicates = {h for h, c in h1_counts.items() if c > 1}
    if duplicates:
        rules.append(rule("Headlines", "WATCH", "Duplicate level-one headings", len(duplicates), len(h1_counts),
                          [{"quote": h, "address": p} for p, h in h1s if h.casefold() in duplicates][:2]))
    if generic and labels and generic / len(labels) > .10:
        rules.append(rule("Calls to action", "WATCH", "Generic call-to-action labels", generic, len(labels),
                          [{"quote": label, "address": path} for path, label in labels if label.casefold().strip() in GENERIC][:2]))
    if sentence_lengths and percentile(sentence_lengths, .5) > 25:
        rules.append(rule("Readability", "WATCH", "Long typical sentences", sum(n > 25 for n in sentence_lengths), len(sentence_lengths),
                          quotes_for(rows, lambda v: [s.strip() for s in SENTENCES.findall(v["text"]) if len(WORDS.findall(s)) > 25])))
    if empty_meta:
        rules.append(rule("Search", "WATCH", "Pages missing a meta description", len(empty_meta), len(rows)))
    rules.sort(key=lambda row: (["Voice", "Naming & terminology", "Headlines", "Calls to action", "Readability", "Search"].index(row["section"]), row["rule"]))
    defects = [row for row in rules if row["kind"] == "WATCH" and row["rule"] in {"Site name has multiple published forms", "Heading casing varies", "Duplicate level-one headings", "Pages missing a level-one heading", "Pages missing a meta description"}]
    stats = [
        {"value": f"{reader} : {organisation}", "label": "Reader : organisation pronouns", "qualifier": "you/your : we/our/us"},
        {"value": f"{percentile(sentence_lengths, .5):g}", "label": "Median words per sentence", "qualifier": f"{len(sentence_lengths)} sentences"},
        {"value": percent(title_h1, len(h1s)), "label": "Title-case level-one headings", "qualifier": f"{title_h1}/{len(h1s)} headings"},
        {"value": percent(verb_first, len(labels)), "label": "Verb-first calls to action", "qualifier": f"{verb_first}/{len(labels)} labels"},
        {"value": f"{percentile([item['grade'] for item in grades], .5):g}", "label": "Median reading grade", "qualifier": f"{len(grades)} pages; approximate"},
    ]
    return {"generatedAt": generated_at, "corpus": {"pagesFetched": len(rows), "pagesFailed": failed,
            "sentences": len(sentence_lengths), "words": len(words), "callToActionLabels": len(labels),
            "fetchDate": generated_at[:10]}, "evidence": evidence, "stats": stats, "positioning": positioning,
            "vocabulary": {"phrases": vocabulary, "names": names},
            "nameForms": {"forms": [{"form": name, "count": count} for name, count in sorted(name_forms.items())],
                          "multipleForms": len(name_forms) > 1}, "mechanics": mechanics,
            "headlines": {"noH1": no_h1, "multipleH1": many_h1,
                          "duplicateH1": [{"text": h, "count": c} for h, c in sorted(h1_counts.items()) if c > 1],
                          "casingVariants": [{"text": key, "forms": sorted(forms)} for key, forms in sorted(casing.items()) if len(forms) > 1],
                          "allCaps": all_caps_headings},
            "callsToAction": {"verbFirstShare": stat(round(verb_first / len(labels), 4) if labels else 0, verb_first, len(labels), "fixed imperative verb list"),
                              "genericLabels": {"count": generic, "labels": [{"label": label, "count": count} for label, count in sorted(counts.items()) if label.casefold().strip() in GENERIC]},
                              "mostCommon": [{"label": label, "count": count} for label, count in sorted(counts.items(), key=lambda x: (-x[1], x[0]))[:12]]},
            "readability": {"pages": grades, "medianGrade": percentile([x["grade"] for x in grades], .5),
                            "p90Grade": percentile([x["grade"] for x in grades], .9),
                            "listItemShare": stat(round(sum(v["listItems"] for _, v in rows) / sum(v["listItems"] + v["paragraphCount"] for _, v in rows), 4) if sum(v["listItems"] + v["paragraphCount"] for _, v in rows) else 0,
                                                  sum(v["listItems"] for _, v in rows), sum(v["listItems"] + v["paragraphCount"] for _, v in rows), "list items divided by list items plus paragraphs")},
            "search": {"titleLengths": title_lengths,
                       "duplicateTitles": [{"title": t, "count": c} for t, c in sorted(title_counts.items()) if c > 1],
                       "missingMetaDescription": empty_meta,
                       "duplicateMetaDescriptions": [{"description": d, "count": c} for d, c in sorted(description_counts.items()) if c > 1],
                       "h1EmptyOrSiteName": [p for p, v in rows if not any(v["headings"]["1"]) or any(h.casefold() == site_name.casefold() for h in v["headings"]["1"])]},
            "rules": rules, "inconsistencies": defects}


def is_title_case(text):
    words = WORDS.findall(text)
    return bool(words) and all(w[0].isupper() or w.lower() in STOP for w in words) and any(w[0].isupper() for w in words)


def is_sentence_case(text):
    words = WORDS.findall(text)
    return bool(words) and words[0][0].isupper() and not is_title_case(text)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--max-pages", type=int, default=400)
    args = parser.parse_args()
    root, name, front = site_config(args.project)
    pages = fetch_pages(args.base_url, addresses(root, front, args.max_pages))
    timestamp = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()
    document = build_voice(pages, name, timestamp, front)
    output = args.project / "voice.json"
    write_json(output, document)
    print(output)


if __name__ == "__main__":
    main()
