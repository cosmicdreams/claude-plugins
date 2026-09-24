#!/usr/bin/env python3
"""Merge Drupal Canvas authoring registrations with source SDC definitions."""

import copy
import json
import sys
from pathlib import Path

from artifact_contracts import validate
from detect import config_sync, docroot
from extract_sdc import KIND, extract as extract_sdc, load


def extract(root):
    root = Path(root).resolve()
    web = Path(docroot(str(root)))
    config = config_sync(str(root))
    if not config:
        raise ValueError("Canvas configuration directory not found")
    config = Path(config)
    raw = extract_sdc(str(root))
    by_name = {component["id"]: component for component in raw["components"]}
    folders = {}
    for path in sorted(config.glob("canvas.folder.*.yml")):
        data = load(path)
        if data.get("configEntityTypeId") != "component":
            continue
        for item in data.get("items") or []:
            folders.setdefault(item, (data.get("name"), str(path.relative_to(root))))

    components, problems = [], list(raw["problems"])
    for path in sorted(config.glob("canvas.component.sdc.*.yml")):
        data = load(path)
        source_id = data.get("source_local_id") or ""
        provider, separator, machine = source_id.partition(":")
        if not separator or not (web / "themes/custom" / provider).is_dir():
            continue
        base = by_name.get(machine)
        if base is None:
            problems.append({"kind": "missing-source-sdc", "detail": source_id,
                             "sourceRef": str(path.relative_to(root))})
            continue
        component = copy.deepcopy(base)
        component_id = data.get("id") or "sdc." + provider + "." + machine
        config_ref = str(path.relative_to(root))
        component.update({"id": component_id, "machineName": machine,
                          "sourceSdcId": source_id,
                          "label": data.get("label") or component["label"],
                          "componentVersion": data.get("active_version"),
                          "canvasRef": config_ref})
        folder = folders.get(component_id)
        if folder:
            component["group"] = folder[0]
            component["folder"] = folder[0]
            component["folderRef"] = folder[1]
        component["provenance"] = {"definition": component["sourceRef"],
                                   "label": config_ref if data.get("label") else component["sourceRef"],
                                   "componentVersion": config_ref,
                                   "group": folder[1] if folder else component["sourceRef"]}
        definitions = (((data.get("versioned_properties") or {}).get("active") or {})
                       .get("settings") or {}).get("prop_field_definitions") or {}
        fields = {field["name"]: field for field in component["fields"]}
        for name, spec in definitions.items():
            if not isinstance(spec, dict):
                continue
            field = fields.get(name)
            if field is None:
                field = {"name": name, "label": name, "kind": "text", "sourceWidget": None,
                         "required": False, "default": None, "options": None,
                         "showWhen": None, "tokenFamily": None, "uid": name}
                component["fields"].append(field)
            field_type = spec.get("field_type")
            if field_type:
                field["kind"] = ("enum" if field_type.startswith("list_") else
                                 "reference" if field_type.startswith("entity_reference") else
                                 KIND.get(field_type, field["kind"]))
                field["canvasFieldType"] = field_type
            field["required"] = bool(spec.get("required"))
            field["sourceWidget"] = spec.get("field_widget") or field["sourceWidget"]
            default = spec.get("default_value")
            if isinstance(default, list) and len(default) == 1 and isinstance(default[0], dict):
                default = default[0].get("value", default[0])
            field["default"] = default if default not in ({}, []) else None
            field["provenance"] = {"label": component["sourceRef"],
                                   "options": component["sourceRef"],
                                   "kind": config_ref if field_type else component["sourceRef"],
                                   "required": config_ref, "default": config_ref,
                                   "sourceWidget": config_ref}
        for field in component["fields"]:
            field.setdefault("provenance", {key: component["sourceRef"] for key in
                           ("label", "options", "kind", "required", "default", "sourceWidget")})
        components.append(component)
    document = {key: raw[key] for key in ("standardVersion", "toolVersion", "generatedAt")}
    document.update({"source": {"strategy": "canvas", "root": str(root),
                                "config": str(config), "sdcParser": raw["source"]["parser"]},
                     "components": components, "problems": problems})
    errors = validate(document, "components")
    if errors:
        raise ValueError("invalid Canvas inventory: " + "; ".join(errors))
    return document


if __name__ == "__main__":
    print(json.dumps(extract(sys.argv[1] if len(sys.argv) > 1 else "."), indent=2))
