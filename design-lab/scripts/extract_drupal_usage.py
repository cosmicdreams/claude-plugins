#!/usr/bin/env python3
"""Measure Drupal component usage from a running DDEV database.

The output keeps direct author placements separate from nested structural instances. This is
the distinction that prevents an inner paragraph such as a link from looking independently
placeable merely because thousands of parent components render one.
"""

from __future__ import annotations

import argparse
import collections
import copy
import json
import re
import ssl
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin

from artifact_contracts import load_json, now, tool_version, validate, write_json


STANDARD_VERSION = "3.0.0"
PAGE_HOSTS = {
    "node", "menu_link_content", "dmb_notifications_entity", "group", "user",
    "taxonomy_term",
}
INLINE_BLOCK = re.compile(r"inline_block:([a-z0-9_]+)")
BLOCK_UUID = re.compile(r"block_content:([0-9a-f-]{36})")
TIERS = {
    "high": "Components — High Use",
    "medium": "Components — Medium Use",
    "low": "Components — Low Use",
    "structural": "Components — Structural Only",
    "retirement": "Components — Retirement Candidates",
}

QUERIES = {
    "paragraphs": """
SELECT id, type, IFNULL(parent_type,''), IFNULL(parent_id,''), status
FROM paragraphs_item_field_data WHERE default_langcode=1;
""",
    "layout_sections": """
SELECT entity_id,
       REPLACE(REPLACE(CAST(layout_builder__layout_section AS CHAR), CHAR(10), ' '),
                       CHAR(9), ' ')
FROM node__layout_builder__layout;
""",
    "blocks": """
SELECT b.id, b.uuid, b.type, d.reusable, d.status
FROM block_content b
JOIN block_content_field_data d ON d.id=b.id AND d.default_langcode=1;
""",
    "blocks_in_paragraphs": """
SELECT field_block_plugin_id, COUNT(*) FROM paragraph__field_block
WHERE deleted=0 GROUP BY field_block_plugin_id;
""",
    "block_configuration": """
SELECT name, REPLACE(REPLACE(CAST(data AS CHAR), CHAR(10), ' '), CHAR(9), ' ')
FROM config WHERE name LIKE 'block.block.%';
""",
    "nodes": """
SELECT nid, status, type FROM node_field_data WHERE default_langcode=1;
""",
    "path_aliases": """
SELECT path, alias FROM path_alias
WHERE status=1 AND langcode IN ('en', 'und') AND path REGEXP '^/node/[0-9]+$';
""",
}


def _mysql(ddev_root: Path, project: str | None, sql: str) -> list[list[str]]:
    command = ["ddev"]
    command += ["mysql", "-N", "--raw", "-e", sql.strip()]
    result = subprocess.run(command, cwd=ddev_root, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE)
    if result.returncode:
        raise ValueError("DDEV database query failed: " + result.stderr.strip())
    return [line.split("\t") for line in result.stdout.splitlines() if line]


def collect_rows(ddev_root: str | Path, project: str | None = None) -> dict[str, list[list[str]]]:
    root = Path(ddev_root).resolve()
    describe = ["ddev", "describe", "-j"]
    status = subprocess.run(describe, cwd=root, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE)
    if status.returncode:
        raise ValueError("DDEV project is unavailable: " + status.stderr.strip())
    try:
        raw = json.loads(status.stdout).get("raw") or {}
    except json.JSONDecodeError as error:
        raise ValueError("DDEV describe did not return JSON") from error
    if raw.get("status") != "running":
        raise ValueError(f"DDEV project {raw.get('name') or project or root.name} is not running")
    if project and raw.get("name") != project:
        raise ValueError(
            f"DDEV root resolves to project {raw.get('name')!r}, expected {project!r}")
    rows = {name: _mysql(root, project, sql) for name, sql in QUERIES.items()}
    rows["__ddev"] = [[str(raw.get("name") or project or root.name),
                       str(raw.get("primary_url") or "")]]
    return rows


def _root_of(paragraph_id: str, paragraphs: dict[str, dict]) -> tuple[str | None, str | None]:
    current = paragraph_id
    seen = set()
    for _ in range(24):
        if current in seen or current not in paragraphs:
            return None, None
        seen.add(current)
        row = paragraphs[current]
        if row["parentType"] == "paragraph":
            current = row["parentId"]
            continue
        return row["parentType"] or None, row["parentId"] or None
    return None, None


def build_usage(components: dict, rows: dict[str, list[list[str]]], source: dict) -> dict:
    aliases = {}
    for values in rows.get("path_aliases", []):
        if len(values) >= 2:
            aliases.setdefault(values[0], values[1])

    def paths_for(ids):
        return [aliases.get("/node/" + node_id, "/node/" + node_id)
                for node_id in sorted(ids, key=lambda value: int(value))[:3]]

    paragraphs = {}
    for values in rows.get("paragraphs", []):
        if len(values) >= 5:
            paragraph_id, bundle, parent_type, parent_id, status = values[:5]
            paragraphs[paragraph_id] = {
                "bundle": bundle, "parentType": parent_type, "parentId": parent_id,
                "status": status,
            }

    paragraph_placements = collections.Counter()
    paragraph_structural = collections.Counter()
    paragraph_pages: dict[str, set[str]] = collections.defaultdict(set)
    paragraph_unpublished = collections.Counter()
    paragraph_orphans = collections.Counter()
    for paragraph_id, row in paragraphs.items():
        component_id = "paragraph:" + row["bundle"]
        if row["parentType"] in ("paragraph", "block_content"):
            paragraph_structural[component_id] += 1
        elif row["parentType"] in PAGE_HOSTS:
            paragraph_placements[component_id] += 1
        elif not row["parentType"]:
            paragraph_orphans[component_id] += 1
        else:
            paragraph_placements[component_id] += 1
        if row["status"] == "0":
            paragraph_unpublished[component_id] += 1
        host_type, host_id = _root_of(paragraph_id, paragraphs)
        if host_type == "node" and host_id:
            paragraph_pages[component_id].add(host_id)

    by_uuid = {}
    inline_entities = collections.Counter()
    for values in rows.get("blocks", []):
        if len(values) >= 5:
            _block_id, uuid, bundle, reusable, _status = values[:5]
            by_uuid[uuid] = bundle
            if reusable == "0":
                inline_entities["block:" + bundle] += 1

    block_placements = collections.Counter()
    block_pages: dict[str, set[str]] = collections.defaultdict(set)
    layout_rows = 0
    for values in rows.get("layout_sections", []):
        if len(values) < 2:
            continue
        layout_rows += 1
        node_id, blob = values[0], "\t".join(values[1:])
        for bundle in INLINE_BLOCK.findall(blob):
            key = "block:" + bundle
            block_placements[key] += 1
            block_pages[key].add(node_id)
        for uuid in BLOCK_UUID.findall(blob):
            if uuid in by_uuid:
                key = "block:" + by_uuid[uuid]
                block_placements[key] += 1
                block_pages[key].add(node_id)

    configured_blocks = collections.Counter()
    for values in rows.get("block_configuration", []):
        blob = "\t".join(values[1:])
        for uuid in BLOCK_UUID.findall(blob):
            if uuid in by_uuid:
                key = "block:" + by_uuid[uuid]
                configured_blocks[key] += 1
                block_placements[key] += 1

    block_structural = collections.Counter()
    for values in rows.get("blocks_in_paragraphs", []):
        if len(values) < 2:
            continue
        match = BLOCK_UUID.search(values[0])
        if match and match.group(1) in by_uuid:
            block_structural["block:" + by_uuid[match.group(1)]] += int(values[1])

    component_ids = [component["id"] for component in components.get("components") or []]
    database_ids = (set(paragraph_placements) | set(paragraph_structural) |
                    set(block_placements) | set(block_structural) | set(inline_entities))
    usage = {}
    for component_id in component_ids:
        usage[component_id] = {
            "placements": int(paragraph_placements[component_id] +
                              block_placements[component_id]),
            "structuralRefs": int(paragraph_structural[component_id] +
                                  block_structural[component_id]),
            "pages": len(paragraph_pages[component_id]) + len(block_pages[component_id]),
            "unpublishedInstances": int(paragraph_unpublished[component_id]),
            "inlineBlockEntities": int(inline_entities[component_id]),
            "configPlacedBlocks": int(configured_blocks[component_id]),
            "orphanInstances": int(paragraph_orphans[component_id]),
            "exampleCandidates": paths_for(
                paragraph_pages[component_id] | block_pages[component_id]),
        }

    zero = sorted(component_id for component_id, value in usage.items()
                  if value["placements"] == 0 and value["structuralRefs"] == 0)
    extra = sorted(database_ids - set(component_ids))
    problems = []
    if extra:
        problems.append({
            "check": "bundle-in-database-not-in-inventory",
            "detail": f"database contains {len(extra)} bundle(s) absent from the inventory",
            "evidence": extra,
        })
    if zero:
        problems.append({
            "check": "inventoried-bundle-absent-from-database",
            "detail": f"{len(zero)} inventoried bundle(s) have zero measured instances",
            "evidence": zero,
        })
    orphan_total = sum(paragraph_orphans.values())
    if orphan_total:
        problems.append({
            "check": "paragraph-without-parent",
            "detail": f"{orphan_total} paragraph instance(s) have no attributable parent",
        })

    document = {
        "standardVersion": STANDARD_VERSION,
        "toolVersion": tool_version(),
        "generatedAt": now(),
        "source": {
            **source,
            "strategy": "drupal-db",
            "scope": "current revisions, default language; placements and nested instances separate",
            "definitions": {
                "placements": ("paragraphs whose immediate parent is a page-level host, plus "
                               "blocks referenced by Layout Builder or block configuration"),
                "structuralRefs": ("paragraphs whose immediate parent is another paragraph or "
                                   "block, plus blocks embedded through a paragraph block field"),
            },
            "population": {
                "paragraphInstances": len(paragraphs),
                "blockContentEntities": len(by_uuid),
                "nodes": len(rows.get("nodes", [])),
                "layoutBuilderSections": layout_rows,
            },
        },
        "usage": usage,
        "problems": problems,
    }
    errors = validate(document, "usage")
    if errors:
        raise ValueError("invalid usage artifact: " + "; ".join(errors))
    return document


def _ssl_context(url: str) -> ssl.SSLContext | None:
    """Verify certificates everywhere except local development hosts, whose certificates are self-signed."""
    if not url.startswith("https://"):
        return None
    host = urllib.parse.urlparse(url).hostname or ""
    if host in {"localhost", "127.0.0.1", "::1"} or host.endswith((".ddev.site", ".localhost")):
        return ssl._create_unverified_context()
    return ssl.create_default_context()


def _fetch_page(url: str) -> tuple[int, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "design-lab/0.14"})
    context = _ssl_context(url)
    try:
        with urllib.request.urlopen(request, timeout=20, context=context) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, ""
    except Exception:
        return 0, ""


def enrich_examples(document: dict, base_url: str) -> dict:
    """Verify DB-derived node paths anonymously against component-specific markers."""
    urls = sorted({urljoin(base_url.rstrip('/') + '/', path.lstrip('/'))
                   for value in document.get("usage", {}).values()
                   for path in value.get("exampleCandidates") or []})
    with ThreadPoolExecutor(max_workers=8) as executor:
        fetched = dict(zip(urls, executor.map(_fetch_page, urls)))
    for component_id, value in document.get("usage", {}).items():
        machine = component_id.split(":", 1)[-1]
        marker = ("block--" + machine.replace("_", "-") if component_id.startswith("block:")
                  else "paragraph--type--" + machine.replace("_", "-"))
        examples = []
        for path in value.pop("exampleCandidates", []):
            url = urljoin(base_url.rstrip('/') + '/', path.lstrip('/'))
            status, body = fetched.get(url, (0, ""))
            count = len(re.findall(r"\b" + re.escape(marker) + r"\b", body))
            if status == 200 and count:
                examples.append({
                    "url": url, "path": path, "marker": marker, "markerKind": "class",
                    "markerUniqueToThisComponent": True, "instancesOnPage": count,
                    "status": status, "anonymous": True, "verifiedAt": now(),
                })
        value["examples"] = examples
        value["noExampleReason"] = None if examples else (
            "no component-specific rendered marker was found on the DB-derived anonymous pages")
    document["source"]["exampleVerification"] = {
        "baseUrl": base_url, "pagesFetched": len(urls), "anonymous": True,
    }
    return document


def usage_tier(placements: int, structural_refs: int, high: int = 50,
               medium: int = 10) -> str:
    if placements >= high:
        return TIERS["high"]
    if placements >= medium:
        return TIERS["medium"]
    if placements:
        return TIERS["low"]
    if structural_refs:
        return TIERS["structural"]
    return TIERS["retirement"]


def merge_usage(components: dict, usage_document: dict, high: int = 50,
                medium: int = 10) -> dict:
    result = copy.deepcopy(components)
    measured_at = usage_document["generatedAt"]
    by_id = usage_document["usage"]
    for component in result.get("components") or []:
        if component["id"] not in by_id:
            raise ValueError(f"usage has no row for {component['id']}")
        evidence = copy.deepcopy(by_id[component["id"]])
        evidence["tier"] = usage_tier(evidence["placements"],
                                      evidence["structuralRefs"], high, medium)
        evidence["source"] = "drupal-db"
        evidence["measuredAt"] = measured_at
        component["usage"] = evidence
        component["category"] = evidence["tier"]
    result.setdefault("totals", {})["placements"] = sum(
        component["usage"]["placements"] for component in result.get("components") or [])
    result["totals"]["structuralRefs"] = sum(
        component["usage"]["structuralRefs"] for component in result.get("components") or [])
    result["problems"] = [
        problem for problem in result.get("problems") or []
        if problem.get("check") != "usage-data-missing"
    ] + copy.deepcopy(usage_document.get("problems") or [])
    return result


def extract(ddev_root: str | Path, components: dict, project: str | None = None) -> dict:
    root = Path(ddev_root).resolve()
    rows = collect_rows(root, project)
    document = build_usage(components, rows, {
        "ddevProject": project,
        "approot": str(root),
    })
    ddev = (rows.get("__ddev") or [[project or root.name, ""]])[0]
    base_url = ddev[1] or f"https://{ddev[0]}.ddev.site"
    return enrich_examples(document, base_url)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("components")
    parser.add_argument("--ddev-root", required=True)
    parser.add_argument("--ddev-project")
    parser.add_argument("--output", required=True)
    parser.add_argument("--merge-components")
    parser.add_argument("--high", type=int, default=50)
    parser.add_argument("--medium", type=int, default=10)
    args = parser.parse_args()
    components = load_json(args.components)
    document = extract(args.ddev_root, components, args.ddev_project)
    write_json(args.output, document)
    if args.merge_components:
        write_json(args.merge_components,
                   merge_usage(components, document, args.high, args.medium))
    print(json.dumps({
        "output": str(Path(args.output).resolve()),
        "components": len(document["usage"]),
        "placements": sum(value["placements"] for value in document["usage"].values()),
        "structuralRefs": sum(value["structuralRefs"] for value in document["usage"].values()),
    }, indent=2))


if __name__ == "__main__":
    main()
