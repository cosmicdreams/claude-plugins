#!/usr/bin/env python3
"""Resolve Drupal authoring bundles to concrete Twig, SDC, and style evidence.

This intentionally stops at evidence collection. A model still decides how the code should be
represented visually, but it no longer has to perform 69 repetitive repository searches.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path

from artifact_contracts import validate, write_json
from extract_sass_style_facts import extract_file as extract_style_file


STANDARD_VERSION = "3.0.0"
INCLUDE = re.compile(r"(?:include|embed)\s*\(\s*['\"]([\w-]+):([\w-]+)['\"]")
FIELD = re.compile(r"\bfield_[a-z0-9_]+\b")
ADD_CLASS = re.compile(r"addClass\(\s*['\"]([^'\"]+)['\"]")
CLASS_ATTR = re.compile(r"class\s*=\s*['\"]([^'\"]+)['\"]")


def relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def direct_templates(twigs: list[Path], kind: str, machine: str) -> list[Path]:
    slug = machine.replace("_", "-")
    prefix = "block" if kind == "block" else "paragraph"
    exact = f"{prefix}--{slug}.html.twig"
    qualified = f"{prefix}--{slug}--"
    result = [path for path in twigs if path.name == exact or path.name.startswith(qualified)]
    if result:
        return sorted(result)
    # Some Drupal suggestions have a view-mode suffix or a singularized directory/name. Only
    # accept a directory match when the template has the correct entity prefix.
    return sorted(path for path in twigs
                  if path.name.startswith(prefix + "--") and slug in path.parts[-2:])


def root_classes(body: str) -> list[str]:
    values = []
    for regex in (ADD_CLASS, CLASS_ATTR):
        for match in regex.finditer(body):
            for value in match.group(1).split():
                if value and "{{" not in value and value not in values:
                    values.append(value)
    return values


def extract(root: str | Path, components: dict) -> dict:
    root = Path(root).resolve()
    themes = root / "docroot" / "themes" / "custom"
    twigs = sorted(themes.rglob("*.html.twig")) if themes.is_dir() else []
    component_yml = sorted(themes.rglob("*.component.yml")) if themes.is_dir() else []
    component_by_key = {path.name[:-len(".component.yml")]: path for path in component_yml}
    items = {}

    for component in components.get("components") or []:
        component_id = component["id"]
        kind, machine = component_id.split(":", 1)
        templates = direct_templates(twigs, kind, machine)
        generic_name = "block.html.twig" if kind == "block" else "paragraph.html.twig"
        generics = [path for path in twigs if path.name == generic_name]
        examined = templates or generics[:1]
        bodies = {path: read(path) for path in examined}

        sdc_refs = []
        for body in bodies.values():
            for namespace, name in INCLUDE.findall(body):
                value = f"{namespace}:{name}"
                if value not in sdc_refs:
                    sdc_refs.append(value)
        sdc_files = []
        style_files = []
        for ref in sdc_refs:
            name = ref.split(":", 1)[1]
            definition = component_by_key.get(name)
            if definition:
                sdc_files.append(definition)
                for suffix in (".scss", ".css"):
                    candidate = definition.with_name(name + suffix)
                    if candidate.is_file():
                        style_files.append(candidate)

        # A Twig template can include a small child SDC and still have its own same-named
        # stylesheet. Treat the bundle stylesheet as additive evidence, not merely a fallback;
        # otherwise banner -> back-link hides banner.scss, and card does the same.
        slug = machine.replace("_", "-")
        for path in themes.rglob("*") if themes.is_dir() else []:
            if path.is_file() and path.suffix in (".scss", ".css") \
                    and path.parent.name == slug and path.stem == slug \
                    and path not in style_files:
                style_files.append(path)

        declared_fields = {field.get("name") for field in component.get("fields") or []}
        declared_fields.update(slot.get("name") for slot in component.get("slots") or [])
        referenced_fields = sorted(set().union(*(set(FIELD.findall(body))
                                                 for body in bodies.values()))) if bodies else []
        missing_fields = [name for name in referenced_fields if name not in declared_fields]
        classes = []
        for body in bodies.values():
            for value in root_classes(body):
                if value not in classes:
                    classes.append(value)

        sass_paths = [path for path in style_files if path.suffix == ".scss"]
        style_facts = {"rootRules": [], "partRules": [], "mediaQueries": 0}
        for style_path in sass_paths:
            facts = extract_style_file(style_path)
            for key in ("rootRules", "partRules"):
                style_facts[key].extend({
                    **rule, "sourceRef": relative(style_path, root)
                } for rule in facts[key])
            style_facts["mediaQueries"] += facts["mediaQueries"]

        items[component_id] = {
            "templates": [relative(path, root) for path in templates],
            "genericTemplate": relative(examined[0], root) if not templates and examined else None,
            "sdc": sdc_refs,
            "sdcDefinitions": [relative(path, root) for path in sdc_files],
            "stylesheets": sorted({relative(path, root) for path in style_files}),
            "styleFacts": style_facts,
            "rootClasses": classes,
            "referencedFields": referenced_fields,
            "defects": [{
                "kind": "template-field-not-in-authoring-config",
                "detail": f"template references {name}, absent from the bundle inventory",
                "evidence": [relative(path, root) for path in examined],
            } for name in missing_fields],
            "confidence": "high" if templates and (sdc_files or style_files) else
                          "medium" if templates else "low",
        }

    document = {
        "standardVersion": STANDARD_VERSION,
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "source": {"strategy": "drupal-render-evidence", "root": str(root)},
        "items": items,
        "totals": {
            "components": len(items),
            "directTemplates": sum(bool(item["templates"]) for item in items.values()),
            "sdcLinks": sum(bool(item["sdcDefinitions"]) for item in items.values()),
            "styleLinks": sum(bool(item["stylesheets"]) for item in items.values()),
            "defects": sum(len(item["defects"]) for item in items.values()),
        },
        "problems": [],
    }
    errors = validate(document, "render-evidence")
    if errors:
        raise ValueError("invalid render evidence: " + "; ".join(errors))
    return document


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo")
    parser.add_argument("components")
    parser.add_argument("--output")
    args = parser.parse_args()
    with open(args.components, encoding="utf-8") as handle:
        components = json.load(handle)
    document = extract(args.repo, components)
    if args.output:
        write_json(args.output, document)
        print(json.dumps({"output": str(Path(args.output).resolve()),
                          "totals": document["totals"]}, indent=2))
    else:
        print(json.dumps(document, indent=2))


if __name__ == "__main__":
    main()
