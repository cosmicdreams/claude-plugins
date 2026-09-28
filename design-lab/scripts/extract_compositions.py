#!/usr/bin/env python3
"""Extract top-level rendered component sequences from published pages."""

import argparse
from html.parser import HTMLParser
from pathlib import Path

from artifact_contracts import write_json
from published_pages import addresses, fetch_pages, site_config

VOID = frozenset("area base br col embed hr img input link meta param source track wbr".split())


class CompositionParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.components = []
        self.title_depth = 0
        self.title_parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        component = attrs.get("data-component-id")
        if component and not any(marked for _, marked in self.stack):
            self.components.append(component)
        if tag not in VOID:
            self.stack.append((tag, bool(component)))
        if tag == "title":
            self.title_depth += 1

    def handle_startendtag(self, tag, attrs):
        attrs = dict(attrs)
        component = attrs.get("data-component-id")
        if component and not any(marked for _, marked in self.stack):
            self.components.append(component)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break
        if tag == "title" and self.title_depth:
            self.title_depth -= 1

    def handle_data(self, data):
        if self.title_depth:
            self.title_parts.append(data)


def parse_page(html):
    parser = CompositionParser()
    parser.feed(html)
    return {"title": " ".join(" ".join(parser.title_parts).split()),
            "components": parser.components}


def build_compositions(pages):
    result = []
    by_component = {}
    failed = []
    for path, status, html in sorted(pages):
        if status != 200:
            failed.append(path)
            continue
        parsed = parse_page(html)
        result.append({"address": path, **parsed})
        for component in dict.fromkeys(parsed["components"]):
            by_component.setdefault(component, []).append(path)
    return {"pages": result, "components": {key: by_component[key] for key in sorted(by_component)},
            "pagesFailed": failed}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--base-url", required=True)
    args = parser.parse_args()
    root, _, front = site_config(args.project)
    document = build_compositions(fetch_pages(args.base_url, addresses(root, front)))
    output = args.project / "compositions.json"
    write_json(output, document)
    print(output)


if __name__ == "__main__":
    main()
