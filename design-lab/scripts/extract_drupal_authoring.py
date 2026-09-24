#!/usr/bin/env python3
"""Extract Drupal block-content and paragraph authoring components as one model."""

from __future__ import annotations

import argparse
import datetime
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from artifact_contracts import tool_version, validate, write_json
from extract_paragraphs import KIND, _default_value, _options, load, token_family
from detect import config_sync

STANDARD_VERSION = "3.0.0"
SPECS = (
    ("block_content", "block", "block_content.type."),
    ("paragraph", "paragraph", "paragraphs.paragraphs_type."),
)


def _storage(cfg, entity_type):
    result = {}
    prefix = f"field.storage.{entity_type}."
    for path in glob.glob(os.path.join(cfg, prefix + "*.yml")):
        data = load(path) or {}
        name = data.get("field_name") or os.path.basename(path)[len(prefix):-4]
        result[name] = data
    return result


def _targets(instance, storage):
    configured = ((instance.get("settings") or {}).get("handler_settings") or {}).get(
        "target_bundles") or {}
    bundles = sorted(configured.keys()) if isinstance(configured, dict) else sorted(configured)
    target_type = (storage.get("settings") or {}).get("target_type")
    return target_type, bundles


def _method_body(text: str, method: str) -> str:
    match = re.search(rf"function\s+{re.escape(method)}\s*\([^)]*\)\s*\{{", text)
    if not match:
        return ""
    start = match.end()
    depth = 1
    for index in range(start, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[start:index]
    return ""


def _predefined_options(root: str) -> dict[str, list[dict]]:
    """Read static values returned by list_predefined_options plugins.

    Drupal exports only a placeholder allowed_values row when this module owns a list.
    The actual editor-facing values live in PHP and are configuration evidence, not a
    runtime guess. Both common return forms are supported.
    """
    plugins: dict[str, list[dict]] = {}
    pattern = os.path.join(root, "docroot", "modules", "**", "src", "Plugin",
        "ListOptions", "*.php")
    for path in sorted(glob.glob(pattern, recursive=True)):
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                text = handle.read()
        except OSError:
            continue
        annotation = re.search(r"@ListOptions\s*\((.*?)\)\s*\*/", text, re.S)
        plugin_id = None
        if annotation:
            found = re.search(r'\bid\s*=\s*["\']([^"\']+)["\']', annotation.group(1))
            plugin_id = found.group(1) if found else None
        if not plugin_id:
            continue
        body = _method_body(text, "getListOptions")
        values = []
        patterns = (
            r'["\']([^"\']+)["\']\s*=>\s*\$this->t\(\s*["\']([^"\']+)["\']',
            r'\$options\s*\[\s*["\']([^"\']+)["\']\s*\]\s*=\s*'
            r'\$this->t\(\s*["\']([^"\']+)["\']',
        )
        for regex in patterns:
            for value, label in re.findall(regex, body):
                if not any(option["value"] == value for option in values):
                    values.append({"value": value, "label": label})
        if values:
            plugins[plugin_id] = values
    return plugins


def extract(root, cfg=None):
    root = os.path.abspath(root)
    cfg = cfg or config_sync(root)
    if not cfg:
        raise ValueError(f"no Drupal configuration directory found under {root}")

    definitions = []
    predefined = _predefined_options(root)
    known = set()
    for entity_type, kind, prefix in SPECS:
        for path in sorted(glob.glob(os.path.join(cfg, prefix + "*.yml"))):
            data = load(path) or {}
            bundle = data.get("id") or os.path.basename(path)[len(prefix):-4]
            key = f"{kind}:{bundle}"
            definitions.append((entity_type, kind, prefix, path, data, bundle, key))
            known.add(key)

    components = []
    for entity_type, kind, _prefix, type_path, type_data, bundle, key in definitions:
        storage_index = _storage(cfg, entity_type)
        fields, slots, defects = [], [], []
        pattern = os.path.join(cfg, f"field.field.{entity_type}.{bundle}.*.yml")
        for field_path in sorted(glob.glob(pattern)):
            instance = load(field_path) or {}
            name = instance.get("field_name")
            source_type = instance.get("field_type")
            storage = storage_index.get(name) or {}
            if not storage:
                defects.append({"kind": "dangling-storage-ref",
                                "detail": f"{name} has no field.storage entity",
                                "evidence": os.path.relpath(field_path, root)})
            target_type, targets = _targets(instance, storage)
            cardinality = storage.get("cardinality", 1)

            if source_type == "entity_reference_revisions" and target_type == "paragraph":
                qualified = [f"paragraph:{target}" for target in targets]
                for target in qualified:
                    if target not in known:
                        defects.append({"kind": "dangling-bundle-ref",
                                        "detail": f"target bundle {target} does not exist",
                                        "evidence": os.path.relpath(field_path, root)})
                slots.append({"name": name, "label": instance.get("label") or name,
                              "accepts": qualified or "any", "cardinality": cardinality,
                              "required": bool(instance.get("required")),
                              "sourceRef": os.path.relpath(field_path, root)})
                continue

            model_kind = KIND.get(source_type)
            if model_kind is None:
                model_kind = "text"
                defects.append({"kind": "unmapped-field-type",
                                "detail": f"field type {source_type} has no model kind",
                                "evidence": os.path.relpath(field_path, root)})
            if source_type == "entity_reference" and target_type in ("media", "file"):
                model_kind = "media"
            plugin_id = (((storage.get("third_party_settings") or {})
                          .get("list_predefined_options") or {}).get("plugin_id"))
            options = (predefined.get(plugin_id) if model_kind == "enum" and plugin_id
                       else _options(storage) if model_kind == "enum" else None)
            if model_kind == "enum" and not options:
                defects.append({"kind": ("predefined-options-plugin-unresolved"
                                         if plugin_id else "enum-without-options"),
                                "detail": (f"{name} references list options plugin {plugin_id}, "
                                           "but its static values could not be read"
                                           if plugin_id else
                                           f"{name} declares no static allowed_values"),
                                "evidence": os.path.relpath(field_path, root)})
            fields.append({
                "name": name,
                "label": instance.get("label") or name,
                "kind": model_kind,
                "required": bool(instance.get("required")),
                "default": _default_value(instance),
                "defaultSource": "declared" if _default_value(instance) is not None else "unset",
                "optionsSource": (f"list_predefined_options:{plugin_id}"
                                  if plugin_id and options else "config"),
                "options": options,
                "showWhen": None,
                "tokenFamily": token_family(name or "", instance.get("label")),
                "appliesToken": None,
                "sourceType": source_type,
                "cardinality": cardinality,
                "targetType": target_type,
                "targetBundles": targets or None,
                "description": instance.get("description") or None,
                "sourceRef": os.path.relpath(field_path, root),
            })

        components.append({
            "id": key,
            "machineName": bundle,
            "label": type_data.get("label") or bundle,
            "description": type_data.get("description") or "",
            "group": "Blocks" if kind == "block" else "Paragraphs",
            "category": "Components — Untiered",
            "aliases": [],
            "sourceRef": os.path.relpath(type_path, root),
            "fields": fields,
            "slots": slots,
            "usage": None,
            "defects": defects,
            "status": type_data.get("status", True),
        })

    contained_by = {component["id"]: [] for component in components}
    for component in components:
        for slot in component["slots"]:
            for target in slot["accepts"] if isinstance(slot["accepts"], list) else []:
                contained_by.setdefault(target, []).append(f"{component['id']}.{slot['name']}")
    for component in components:
        component["containedBy"] = sorted(contained_by.get(component["id"], []))

    document = {
        "standardVersion": STANDARD_VERSION,
        "toolVersion": tool_version(),
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "source": {"strategy": "drupal-authoring", "root": root,
                   "configDir": os.path.relpath(cfg, root)},
        "totals": {
            "all": len(components),
            "blocks": sum(c["id"].startswith("block:") for c in components),
            "paragraphs": sum(c["id"].startswith("paragraph:") for c in components),
            "withDefects": sum(bool(c["defects"]) for c in components),
        },
        "components": components,
        "problems": [],
    }
    errors = validate(document, "components")
    if errors:
        raise ValueError("invalid component artifact: " + "; ".join(errors))
    return document


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("repo")
    parser.add_argument("--output")
    args = parser.parse_args()
    document = extract(args.repo)
    if args.output:
        write_json(args.output, document)
        print(json.dumps({"output": os.path.abspath(args.output), "totals": document["totals"]}))
    else:
        print(json.dumps(document, indent=2))


if __name__ == "__main__":
    main()
