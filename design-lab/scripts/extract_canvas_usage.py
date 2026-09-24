#!/usr/bin/env python3
"""Count published Canvas page placements and configured content-template nodes."""

import argparse
import collections
import json
import re
import subprocess
from pathlib import Path

from artifact_contracts import load_json, now, tool_version, validate, write_json
from detect import config_sync, docroot
from extract_drupal_usage import TIERS, merge_usage, usage_tier
from extract_sdc import load


PLACEMENTS_SQL = """
SELECT c.bundle, c.deleted, c.entity_id, c.revision_id, c.langcode, c.delta,
       IFNULL(c.components_parent_uuid,''), IFNULL(c.components_slot,''),
       c.components_uuid, c.components_component_id, c.components_component_version,
       REPLACE(REPLACE(IFNULL(c.components_inputs,''), CHAR(10), ' '), CHAR(9), ' '),
       IFNULL(c.components_label,'')
FROM canvas_page__components c
JOIN canvas_page_field_data p ON p.id=c.entity_id
 AND p.revision_id=c.revision_id AND p.langcode=c.langcode
WHERE c.deleted=0 AND p.status=1;
"""
PAGES_SQL = "SELECT DISTINCT id, revision_id FROM canvas_page_field_data WHERE status=1;"
ALIASES_SQL = """
SELECT path, alias FROM path_alias WHERE status=1
 AND langcode IN ('en','und') AND path REGEXP '^/page/[0-9]+$';
"""
TWIG_SDC = re.compile(r"\{%\s*(?:include|embed|source)\s+['\"]([^:'\"]+):([^'\"]+)['\"]")


def parse_sqlq_rows(output, columns):
    """Drush sqlq emits headerless tab-separated rows, including empty columns."""
    rows = []
    for number, line in enumerate(output.splitlines(), 1):
        if not line.strip():
            continue
        row = line.rstrip("\r").split("\t")
        if len(row) != columns:
            raise ValueError(f"sqlq row {number}: expected {columns} columns, got {len(row)}")
        rows.append(row)
    return rows


def sqlq_rows(root, sql, columns):
    result = subprocess.run(["ddev", "drush", "sqlq", sql.strip()], cwd=root, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise ValueError("DDEV database query failed: " + result.stderr.strip())
    return parse_sqlq_rows(result.stdout, columns)


def scan_theme_templates(root, components):
    """Find literal SDC references in the active theme's Twig files."""
    web = Path(docroot(str(root)))
    names = {component.get("sourceSdcId") for component in components.get("components") or []}
    providers = {name.split(":", 1)[0] for name in names if name and ":" in name}
    refs = collections.defaultdict(list)
    for provider in sorted(providers):
        theme = web / "themes" / "custom" / provider
        paths = list((theme / "templates").rglob("*.twig")) + list(
            (theme / "components").rglob("*.twig"))
        for path in sorted(paths):
            relative = path.relative_to(root).as_posix()
            theme_relative = path.relative_to(theme).as_posix()
            global_template = bool(re.match(
                r"templates/(?:layout/page[^/]*\.html\.twig|(?:[^/]+/)?html\.html\.twig|"
                r"(?:[^/]+/)?region--[^/]*\.html\.twig)$", theme_relative))
            for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                for match in TWIG_SDC.finditer(line):
                    sdc_id = match.group(1) + ":" + match.group(2)
                    if sdc_id in names:
                        refs[sdc_id].append({"file": relative, "line": line_number,
                                             "global": global_template})
    return refs


def collect_rows(ddev_root, project=None):
    """Thin DDEV layer; build_usage accepts plain rows and needs no database."""
    import subprocess
    root = Path(ddev_root).resolve()
    status = subprocess.run(["ddev", "describe", "-j"], cwd=root, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if status.returncode:
        raise ValueError("DDEV project is unavailable: " + status.stderr.strip())
    raw = (json.loads(status.stdout).get("raw") or {})
    if raw.get("status") != "running":
        raise ValueError("DDEV project is not running")
    if project and raw.get("name") != project:
        raise ValueError("DDEV project name does not match " + project)
    return {"placements": sqlq_rows(root, PLACEMENTS_SQL, 13),
            "pages": sqlq_rows(root, PAGES_SQL, 2),
            "aliases": sqlq_rows(root, ALIASES_SQL, 2)}


def template_rows(root):
    config = config_sync(str(root))
    if not config:
        return []
    rows = []
    for path in sorted(Path(config).glob("canvas.content_template.*.yml")):
        data = load(path)
        if data.get("status") is False:
            continue
        bundle = data.get("content_entity_type_bundle")
        for entry in (data.get("component_tree") or {}).values():
            if isinstance(entry, dict) and entry.get("component_id"):
                rows.append([entry["component_id"], data.get("id"), bundle,
                             str(path.relative_to(root))])
    return rows


def build_usage(components, rows, source):
    """Pure row reducer. `rows` contains query and content-template fixture rows."""
    ids = {component["id"] for component in components.get("components") or []}
    aliases = {path: alias for path, alias in rows.get("aliases", [])}
    twig_refs = rows.get("twig_refs") or {}
    usage = collections.defaultdict(lambda: {"placements": 0, "structuralRefs": 0,
        "templatePlacements": 0, "pages": 0, "exampleCandidates": [],
        "templateBundles": [], "templateRefs": []})
    pages = collections.defaultdict(set)
    for row in rows.get("placements", []):
        if len(row) < 13:
            raise ValueError("Canvas placement row has fewer than 13 columns")
        _bundle, deleted, page_id, _revision, _lang, _delta, parent, _slot, _uuid, component_id, *_ = row
        if deleted != "0":
            continue
        value = usage[component_id]
        value["structuralRefs" if parent else "placements"] += 1
        pages[component_id].add(page_id)
    for component_id, template_id, bundle, reference in rows.get("templates", []):
        value = usage[component_id]
        value["placements"] += 1
        value["templatePlacements"] += 1
        if bundle not in value["templateBundles"]:
            value["templateBundles"].append(bundle)
        if reference not in value["templateRefs"]:
            value["templateRefs"].append(reference)
    for component in components.get("components") or []:
        component_id = component["id"]
        value = usage[component_id]
        page_ids = pages[component_id]
        value["pages"] = len(page_ids)
        value["exampleCandidates"] = [aliases.get("/page/" + item, "/page/" + item)
            for item in sorted(page_ids, key=lambda item: int(item) if item.isdigit() else item)[:3]]
        for reference in twig_refs.get(component.get("sourceSdcId"), []):
            if reference not in value["templateRefs"]:
                value["templateRefs"].append(reference)
        value["globalTemplate"] = any(isinstance(ref, dict) and ref.get("global")
                                      for ref in value["templateRefs"])
    extra = sorted(set(usage) - ids)
    problems = ([{"check": "component-in-placements-not-in-inventory",
                  "detail": "Canvas contains components absent from the inventory",
                  "evidence": extra}] if extra else [])
    document = {"standardVersion": "3.0.0", "toolVersion": tool_version(),
                "generatedAt": now(),
                "source": {**source, "strategy": "canvas-db",
                    "scope": "published Canvas pages, current revisions and content templates",
                    "definitions": {"placements": "top-level page placements plus template nodes",
                        "structuralRefs": "nested page placements",
                        "templatePlacements": "one per content-template tree entry"},
                    "population": {"publishedPages": len(rows.get("pages", [])),
                        "pagePlacementRows": len(rows.get("placements", [])),
                        "templateNodes": len(rows.get("templates", []))}},
                "usage": dict(sorted(usage.items())), "problems": problems}
    errors = validate(document, "usage")
    if errors:
        raise ValueError("invalid Canvas usage: " + "; ".join(errors))
    return document


def extract(ddev_root, components, project=None):
    root = Path(ddev_root).resolve()
    rows = collect_rows(root, project)
    rows["templates"] = template_rows(root)
    rows["twig_refs"] = scan_theme_templates(root, components)
    return build_usage(components, rows, {"approot": str(root), "ddevProject": project})


def merge_canvas_usage(components, document, high=50, medium=10):
    merged = merge_usage(components, document, high, medium)
    for component in merged["components"]:
        evidence = component["usage"]
        evidence["structuralReferences"] = evidence["structuralRefs"]
        evidence["source"] = "canvas-db"
        if evidence.get("globalTemplate"):
            tier = TIERS["high"]
            evidence["tierReason"] = "referenced by a global theme template"
        elif evidence.get("templateRefs") or evidence.get("renderedPages", 0):
            tier = usage_tier(evidence["placements"],
                              max(1, evidence["structuralRefs"]), high, medium)
            if evidence.get("templateRefs"):
                evidence["tierReason"] = "referenced by a theme or content template"
            else:
                evidence["tierReason"] = "observed on a public rendered page"
        else:
            tier = evidence["tier"]
        evidence["tier"] = tier
        component["category"] = tier
    return merged


def main():
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
        merged = merge_canvas_usage(components, document, args.high, args.medium)
        write_json(args.merge_components, merged)
    print(json.dumps({"components": len(document["usage"]),
                      "publishedPages": document["source"]["population"]["publishedPages"],
                      "placements": sum(value["placements"] for value in document["usage"].values()),
                      "structuralRefs": sum(value["structuralRefs"] for value in document["usage"].values())}))


if __name__ == "__main__":
    main()
