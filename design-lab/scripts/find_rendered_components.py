#!/usr/bin/env python3
"""Find Drupal SDC markers on a bounded set of anonymous public pages."""

from __future__ import annotations

import argparse
import collections
import json
import re
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

from artifact_contracts import load_json, write_json
from extract_canvas_usage import sqlq_rows
from extract_drupal_usage import _ssl_context

ALIASES_SQL = """SELECT path, alias FROM path_alias WHERE status=1
AND langcode IN ('en','und') AND path REGEXP '^/(page|node)/[0-9]+$';"""


class ComponentParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.counts = collections.Counter()

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key == "data-component-id" and value:
                self.counts[value] += 1

    handle_startendtag = handle_starttag


def parse_components(html):
    """Return component instance counts from a single HTML document."""
    parser = ComponentParser()
    parser.feed(html)
    return dict(parser.counts)


def public_paths(alias_rows, limit=60):
    """Take every Canvas alias first, then a deterministic node alias sample."""
    if limit < 1:
        raise ValueError("path limit must be positive")
    selected = {}
    for source, alias in alias_rows:
        if re.fullmatch(r"/(page|node)/[0-9]+", source) and alias.startswith("/"):
            selected.setdefault(source, alias)
    canvas = sorted((source for source in selected if source.startswith("/page/")),
                    key=lambda source: (int(source.rsplit("/", 1)[1]), selected[source]))
    nodes = sorted((source for source in selected if source.startswith("/node/")),
                   key=lambda source: (int(source.rsplit("/", 1)[1]), selected[source]))
    return sorted(set(selected[source] for source in (canvas + nodes)[:limit]))


def fetch_page(base_url, path):
    url = urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
    request = urllib.request.Request(url, headers={"User-Agent": "design-lab/0.14"})
    # Certificates are verified except on local development hosts; published_pages.py,
    # extract_voice.py and extract_compositions.py fetch through here too.
    context = _ssl_context(url)
    try:
        with urllib.request.urlopen(request, timeout=20, context=context) as response:
            return path, response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return path, error.code, ""
    except (OSError, TimeoutError):
        return path, 0, ""


def summarize_pages(pages, components):
    """Pure reducer of (path, status, HTML) results against inventory SDC IDs."""
    id_by_sdc = {}
    for component in components.get("components") or []:
        source_id = component.get("sourceSdcId")
        if not source_id:
            source = component.get("sourceRef", "")
            match = re.search(r"(?:^|/)themes/(?:custom|contrib)/([^/]+)/components/([^/]+)/",
                              source)
            source_id = (match.group(1) + ":" + match.group(2)) if match else component["id"]
        id_by_sdc[source_id] = component["id"]
    evidence = {component_id: {"renderedPages": 0, "renderedInstances": 0,
                               "renderedExamples": []} for component_id in id_by_sdc.values()}
    for path, status, html in sorted(pages):
        if status != 200:
            continue
        for sdc_id, count in parse_components(html).items():
            component_id = id_by_sdc.get(sdc_id)
            if component_id is None:
                continue
            value = evidence[component_id]
            value["renderedPages"] += 1
            value["renderedInstances"] += count
            if len(value["renderedExamples"]) < 3:
                value["renderedExamples"].append(path)
    return evidence


def scan(base_url, ddev_root, components, limit=60):
    rows = sqlq_rows(Path(ddev_root).resolve(), ALIASES_SQL, 2)
    paths = public_paths(rows, limit)
    with ThreadPoolExecutor(max_workers=8) as executor:
        pages = list(executor.map(lambda path: fetch_page(base_url, path), paths))
    return summarize_pages(pages, components), {
        "baseUrl": base_url, "pathsSelected": len(paths),
        "pagesFetched": sum(status == 200 for _, status, _ in pages),
        "pathsFailed": [path for path, status, _ in pages if status != 200],
    }


def enrich_usage(document, evidence, scan_details):
    document["source"]["renderedVerification"] = scan_details
    for component_id, rendered in evidence.items():
        value = document["usage"].get(component_id)
        if value is None:
            continue
        value.update(rendered)
        if not value.get("exampleCandidates"):
            value["exampleCandidates"] = rendered["renderedExamples"][:]
    return document


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("components")
    parser.add_argument("--ddev-root", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--max-pages", type=int, default=60)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    evidence, details = scan(args.base_url, args.ddev_root, load_json(args.components),
                             args.max_pages)
    write_json(args.output, {"source": details, "components": evidence})
    print(json.dumps({"output": args.output, **details}))


if __name__ == "__main__":
    main()
