#!/usr/bin/env python3
"""Small, dependency-free contracts for design-lab's durable artifacts."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import tempfile
from pathlib import Path


SCHEMA_VERSION = 1
ARTIFACT_KINDS = (
    "project", "detection", "components", "render-evidence", "capture-evidence", "tokens", "usage", "plan", "variable-plan",
    "foundation", "index", "build-record", "verify-report",
)


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def tool_version() -> str:
    """Return the installed plugin version without making every extractor hard-code it."""
    manifest = Path(__file__).resolve().parents[1] / ".claude-plugin" / "plugin.json"
    try:
        version = load_json(manifest).get("version")
    except (OSError, ValueError):
        version = None
    return "design-lab " + (version or "unknown")


def sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def write_json(path: str | Path, document: dict) -> Path:
    """Validate JSON serialisation, fsync it, then atomically replace the target."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(document, indent=2, ensure_ascii=False) + "\n"
    fd, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise
    return target


def load_json(path: str | Path) -> dict:
    with open(path, encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path}: top level must be an object")
    return value


def _required(doc: dict, keys: tuple[str, ...], errors: list[str]) -> None:
    for key in keys:
        if key not in doc:
            errors.append(f"missing `{key}`")


def _unique(items: list[dict], key: str, label: str, errors: list[str]) -> None:
    values = [item.get(key) for item in items if isinstance(item, dict)]
    duplicate = sorted({v for v in values if v is not None and values.count(v) > 1})
    if duplicate:
        errors.append(f"duplicate {label}: {', '.join(map(str, duplicate[:12]))}")


def identify(doc: dict, filename: str = "") -> str | None:
    name = Path(filename).name
    if name == "project.json" or {"repository", "phases", "artifacts"} <= doc.keys():
        return "project"
    if name == "detection.json" or "componentSources" in doc:
        return "detection"
    if name == "components.json" or "components" in doc and "source" in doc:
        return "components"
    if name == "render-evidence.json" or doc.get("source", {}).get("strategy") == "drupal-render-evidence":
        return "render-evidence"
    if name == "capture-evidence.json" or "captures" in doc and "componentId" not in doc:
        return "capture-evidence"
    if name == "tokens.json" or "colors" in doc and "spacing" in doc:
        return "tokens"
    if name == "usage.json" or doc.get("source", {}).get("strategy") == "drupal-db":
        return "usage"
    if name == "plan.json" or "plans" in doc:
        return "plan"
    if name == "variable-plan.json" or "collections" in doc:
        return "variable-plan"
    if name == "foundation.json" or {"figmaFileKey", "pages", "validation"} <= doc.keys():
        return "foundation"
    if name == "index.json" or {"rows", "totals", "notBuilt"} <= doc.keys():
        return "index"
    if name == "verify-report.json" or {"open", "waived", "passed", "completeness"} <= doc.keys():
        return "verify-report"
    if name.endswith(".json") and "figma" in doc and "assertions" in doc:
        return "build-record"
    return None


def validate(doc: dict, kind: str | None = None, filename: str = "") -> list[str]:
    kind = kind or identify(doc, filename)
    errors: list[str] = []
    if kind is None:
        return ["artifact type could not be identified"]
    if kind not in ARTIFACT_KINDS:
        return [f"unsupported artifact kind: {kind}"]

    if kind == "project":
        _required(doc, ("schemaVersion", "standardVersion", "pluginVersion", "repository",
                        "decisions", "phases", "artifacts"), errors)
        if doc.get("schemaVersion") != SCHEMA_VERSION:
            errors.append(f"schemaVersion must be {SCHEMA_VERSION}")
        repo = doc.get("repository") or {}
        _required(repo, ("root", "commit", "dirty"), errors)
        for phase, value in (doc.get("phases") or {}).items():
            if isinstance(value, dict) and value.get("status") == "waived":
                detail = value.get("detail") or {}
                if not str(detail.get("reason") or "").strip():
                    errors.append(f"phases.{phase} waiver missing `reason`")
                if not str(detail.get("by") or "").strip():
                    errors.append(f"phases.{phase} waiver missing human `by`")

    elif kind == "detection":
        _required(doc, ("root", "componentSources", "tokenSources", "usageSources",
                        "recommended", "priorArt"), errors)
        for key in ("componentSources", "tokenSources", "usageSources", "priorArt"):
            if not isinstance(doc.get(key), list):
                errors.append(f"`{key}` must be an array")

    elif kind == "components":
        _required(doc, ("standardVersion", "toolVersion", "generatedAt", "source", "components"), errors)
        items = doc.get("components")
        if not isinstance(items, list):
            errors.append("`components` must be an array")
        else:
            _unique(items, "id", "component ids", errors)
            for index, component in enumerate(items):
                if not isinstance(component, dict):
                    errors.append(f"components[{index}] must be an object")
                    continue
                for key in ("id", "label", "sourceRef", "fields", "slots", "defects"):
                    if key not in component:
                        errors.append(f"components[{index}] missing `{key}`")
                if not isinstance(component.get("fields"), list):
                    errors.append(f"components[{index}].fields must be an array")
                if not isinstance(component.get("slots"), list):
                    errors.append(f"components[{index}].slots must be an array")

    elif kind == "render-evidence":
        _required(doc, ("standardVersion", "generatedAt", "source", "items", "totals",
                        "problems"), errors)
        items = doc.get("items")
        if not isinstance(items, dict) or not items:
            errors.append("`items` must be a non-empty object")
        else:
            for component_id, item in items.items():
                if not isinstance(item, dict):
                    errors.append(f"items[{component_id}] must be an object")
                    continue
                for key in ("templates", "sdc", "sdcDefinitions", "stylesheets",
                            "styleFacts", "rootClasses", "referencedFields", "defects",
                            "confidence"):
                    if key not in item:
                        errors.append(f"items[{component_id}] missing `{key}`")

    elif kind == "capture-evidence":
        _required(doc, ("standardVersion", "toolVersion", "generatedAt", "canonicalBaseUrl",
                        "captures", "problems"), errors)
        captures = doc.get("captures")
        if not isinstance(captures, dict):
            errors.append("`captures` must be an object")
        else:
            for component_id, evidence in captures.items():
                if not isinstance(evidence, dict):
                    errors.append(f"captures[{component_id}] must be an object")
                    continue
                _required(evidence, ("path", "verificationUrl", "linkUrl", "selector",
                                     "states", "images"), errors)
                path = evidence.get("path")
                if not isinstance(path, str) or not path.startswith("/"):
                    errors.append(f"captures[{component_id}].path must be root-relative")
                for key in ("verificationUrl", "linkUrl", "selector"):
                    if not str(evidence.get(key) or "").strip():
                        errors.append(f"captures[{component_id}].{key} must be non-empty")
                if ".ddev.site" in str(evidence.get("linkUrl") or ""):
                    errors.append(f"captures[{component_id}].linkUrl must not use a DDEV hostname")
                images = evidence.get("images")
                if not isinstance(images, list) or not images:
                    errors.append(f"captures[{component_id}].images must be non-empty")

    elif kind == "tokens":
        _required(doc, ("standardVersion", "toolVersion"), errors)
        domains = ("tokens", "colors", "schemes", "spacing", "type", "radii", "elevation", "motion")
        present = [key for key in domains if isinstance(doc.get(key), list) and doc[key]]
        if not present:
            errors.append("no populated token domain found")

    elif kind == "usage":
        _required(doc, ("standardVersion", "toolVersion", "generatedAt", "source",
                        "usage", "problems"), errors)
        usage = doc.get("usage")
        if not isinstance(usage, dict):
            errors.append("`usage` must be an object")
        else:
            for component_id, value in usage.items():
                if not isinstance(value, dict):
                    errors.append(f"usage[{component_id}] must be an object")
                    continue
                for key in ("placements", "structuralRefs", "pages"):
                    if not isinstance(value.get(key), int) or value[key] < 0:
                        errors.append(f"usage[{component_id}].{key} must be a non-negative integer")

    elif kind == "plan":
        _required(doc, ("standardVersion", "plans"), errors)
        plans = doc.get("plans")
        if not isinstance(plans, list):
            errors.append("`plans` must be an array")
        else:
            _unique(plans, "id", "plan ids", errors)
            for index, entry in enumerate(plans):
                if entry.get("verdict") not in ("build", "map", "document", "refuse"):
                    errors.append(f"plans[{index}].verdict must be build, map, document, or refuse")
                if entry.get("libraryRole") not in ("component", "subcomponent", "schema-only",
                                                     "retirement"):
                    errors.append(f"plans[{index}].libraryRole is missing or invalid")

    elif kind == "variable-plan":
        collections = doc.get("collections")
        if not isinstance(collections, (list, dict)) or not collections:
            errors.append("`collections` must be a non-empty array or object")

    elif kind == "foundation":
        _required(doc, ("standardVersion", "toolVersion", "figmaFileKey", "pages",
                        "collections", "validation"), errors)
        if not isinstance(doc.get("pages"), dict) or not doc.get("pages"):
            errors.append("`pages` must be a non-empty object")
        if not isinstance(doc.get("collections"), dict) or not doc.get("collections"):
            errors.append("`collections` must be a non-empty object")
        validation = doc.get("validation")
        if not isinstance(validation, dict):
            errors.append("`validation` must be an object")
        else:
            validation_errors = validation.get("errors")
            if not isinstance(validation_errors, list):
                errors.append("`validation.errors` must be an array")
            elif validation_errors:
                errors.append("`validation.errors` must be empty")

    elif kind == "index":
        _required(doc, ("standardVersion", "generatedAt", "totals", "rows",
                        "notBuilt", "problems"), errors)
        rows = doc.get("rows")
        if not isinstance(rows, list):
            errors.append("`rows` must be an array")
        else:
            _unique(rows, "id", "index row ids", errors)
            totals = doc.get("totals")
            if not isinstance(totals, dict):
                errors.append("`totals` must be an object")
            elif isinstance(totals.get("components"), int) and totals["components"] != len(rows):
                errors.append("`totals.components` must equal the number of rows")
        for key in ("notBuilt", "problems"):
            if not isinstance(doc.get(key), list):
                errors.append(f"`{key}` must be an array")

    elif kind == "build-record":
        _required(doc, ("standardVersion", "toolVersion", "id", "figma", "documentation",
                        "nativeComponent", "assertions", "sourceHash"), errors)
        figma = doc.get("figma") or {}
        _required(figma, ("fileKey", "pageId", "documentationCardId"), errors)
        if not (figma.get("componentSetId") or figma.get("componentId")):
            errors.append("figma must identify a componentSetId or componentId")
        evidence = doc.get("visualEvidence")
        if not isinstance(evidence, dict):
            errors.append("missing `visualEvidence`")
        else:
            _required(evidence, ("path", "captureFiles", "states", "breakpoints",
                                 "comparison"), errors)
            if not str(evidence.get("path") or "").startswith("/"):
                errors.append("visualEvidence.path must be root-relative")
            if (not isinstance(evidence.get("captureFiles"), list) or
                    len(evidence["captureFiles"]) < 3):
                errors.append("visualEvidence.captureFiles must contain at least three captures")
            breakpoints = evidence.get("breakpoints") or {}
            missing_breakpoints = [name for name in ("desktop", "tablet", "mobile")
                                   if not isinstance(breakpoints.get(name), dict) or
                                   not breakpoints[name].get("captureFile") or
                                   not breakpoints[name].get("viewportWidth")]
            if missing_breakpoints:
                errors.append("visualEvidence.breakpoints must include desktop, tablet, and "
                              "mobile captureFile + viewportWidth evidence")
            comparison = evidence.get("comparison") or {}
            if comparison.get("verdict") != "pass":
                errors.append("visualEvidence.comparison must explicitly pass")
            compared = comparison.get("breakpoints") or {}
            if any(compared.get(name) != "pass" for name in ("desktop", "tablet", "mobile")):
                errors.append("visualEvidence.comparison.breakpoints must pass desktop, "
                              "tablet, and mobile")
        documentation = doc.get("documentation")
        if not isinstance(documentation, dict):
            errors.append("missing `documentation`")
        else:
            _required(documentation, ("anatomy", "breakpointScreenshots"), errors)
            anatomy = documentation.get("anatomy") or {}
            fields = anatomy.get("fields")
            relationships = anatomy.get("relationships")
            if not isinstance(fields, list) or not isinstance(relationships, list):
                errors.append("documentation.anatomy fields and relationships must be arrays")
            elif not fields and not relationships and not anatomy.get("emptyReason"):
                errors.append("documentation.anatomy must document a field, a relationship, "
                              "or an explicit emptyReason")
            else:
                for index, field in enumerate(fields):
                    if not isinstance(field, dict):
                        errors.append(f"documentation.anatomy.fields[{index}] must be an object")
                        continue
                    for key in ("field", "kind", "required", "default", "figmaTreatment"):
                        if key not in field:
                            errors.append("documentation.anatomy.fields[%d] missing `%s`" %
                                          (index, key))
                for index, relationship in enumerate(relationships):
                    if not isinstance(relationship, dict):
                        errors.append("documentation.anatomy.relationships[%d] must be an object"
                                      % index)
                        continue
                    for key in ("field", "accepts", "cardinality", "required", "rendered"):
                        if key not in relationship:
                            errors.append("documentation.anatomy.relationships[%d] missing `%s`"
                                          % (index, key))
            shots = documentation.get("breakpointScreenshots") or {}
            if any(not shots.get(name) for name in ("desktop", "tablet", "mobile")):
                errors.append("documentation.breakpointScreenshots must identify desktop, "
                              "tablet, and mobile Figma nodes")
        native = doc.get("nativeComponent")
        if not isinstance(native, dict):
            errors.append("missing `nativeComponent`")
        else:
            _required(native, ("nodeType", "rootHasImageFill", "componentProperties",
                               "nestedInstances", "validation"), errors)
            if native.get("nodeType") not in ("COMPONENT", "COMPONENT_SET"):
                errors.append("nativeComponent.nodeType must be COMPONENT or COMPONENT_SET")
            if native.get("rootHasImageFill") is not False:
                errors.append("nativeComponent.rootHasImageFill must be false")
            for key in ("componentProperties", "nestedInstances"):
                if not isinstance(native.get(key), list):
                    errors.append(f"nativeComponent.{key} must be an array")
            validation = native.get("validation") or {}
            for key in ("nativeNode", "noScreenshotSurrogate", "authoringCoverage",
                        "relationshipCoverage"):
                if validation.get(key) is not True:
                    errors.append(f"nativeComponent.validation.{key} must explicitly pass")
        assertions = doc.get("assertions")
        if not isinstance(assertions, dict) or not assertions:
            errors.append("`assertions` must be a non-empty object")
        else:
            for name, value in assertions.items():
                passed = value is True or (isinstance(value, dict) and (
                    value.get("pass") is True or value.get("verdict") in ("pass", "passed")))
                if not passed:
                    errors.append(f"assertion `{name}` is not a passing assertion")

    elif kind == "verify-report":
        _required(doc, ("standardVersion", "generatedAt", "open", "waived", "passed",
                        "inapplicable", "completeness"), errors)
        for key in ("open", "waived", "passed", "inapplicable"):
            if not isinstance(doc.get(key), list):
                errors.append(f"`{key}` must be an array")
        if not isinstance(doc.get("completeness"), dict):
            errors.append("`completeness` must be an object")

    return errors


def register_artifact(project_path: str | Path, name: str, path: str | Path,
                      kind: str | None = None) -> dict:
    # Resolve both sides before computing a relative path. On macOS /var is a symlink to
    # /private/var; mixing the two otherwise produces a syntactically valid path that walks
    # out of the workspace and can no longer be loaded by the completion gate.
    project_path = Path(project_path).resolve()
    project = load_json(project_path)
    artifact_path = Path(path).resolve()
    document = load_json(artifact_path)
    errors = validate(document, kind, str(artifact_path))
    project.setdefault("artifacts", {})[name] = {
        "path": os.path.relpath(artifact_path, project_path.parent),
        "kind": kind or identify(document, str(artifact_path)),
        "sha256": sha256(artifact_path),
        "valid": not errors,
        "errors": errors,
        "updatedAt": now(),
    }
    write_json(project_path, project)
    return project
