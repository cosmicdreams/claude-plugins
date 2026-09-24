#!/usr/bin/env python3
"""Stateful, atomic front door for the design-lab extraction and planning pipeline."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PLUGIN_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))

from artifact_contracts import (SCHEMA_VERSION, load_json, now, register_artifact,
                                sha256, validate, write_json)
from detect import detect
from extract_drupal_authoring import extract as extract_drupal_authoring
from extract_drupal_rendering import extract as extract_drupal_rendering
from extract_drupal_usage import extract as extract_drupal_usage, merge_usage
from extract_paragraphs import extract as extract_paragraphs
from extract_sdc import extract as extract_sdc
from extract_sitestudio import extract as extract_sitestudio
from extract_tokens_cssvars import extract as extract_tokens_cssvars
from extract_tokens_sitestudio import extract as extract_tokens_sitestudio
from extract_tokens_sass import extract as extract_tokens_sass
from extract_tokens_sourcemap import extract as extract_tokens_sourcemap
from plan import plan_component
from plan_variables import build as plan_variables


def plugin_version() -> str:
    return load_json(PLUGIN_DIR / ".claude-plugin" / "plugin.json")["version"]


def standard_version() -> str:
    text = (PLUGIN_DIR / "references" / "library-standard.md").read_text(encoding="utf-8")
    marker = "**Standard version: "
    return text.split(marker, 1)[1].split("**", 1)[0]


def git_value(repo: Path, *args: str) -> str | None:
    proc = subprocess.run(["git", "-C", str(repo), *args], text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    return proc.stdout.strip() if proc.returncode == 0 else None


def project_path(value: str | Path) -> Path:
    path = Path(value).resolve()
    return path / "project.json" if path.is_dir() else path


def load_project(value: str | Path) -> tuple[Path, dict]:
    path = project_path(value)
    project = load_json(path)
    errors = validate(project, "project")
    if errors:
        raise ValueError(f"{path}: " + "; ".join(errors))
    return path, project


def set_phase(project_path_: Path, project: dict, phase: str, status: str,
              detail: dict | None = None) -> None:
    project.setdefault("phases", {})[phase] = {
        "status": status,
        "updatedAt": now(),
        **({"detail": detail} if detail else {}),
    }
    write_json(project_path_, project)


def invalidate(project: dict, phases: tuple[str, ...], kinds: tuple[str, ...]) -> None:
    """Invalidate dependent claims without deleting evidence files.

    Raw artifacts remain on disk for diagnosis, but they stop authorising resume/completion
    once an upstream input has changed.
    """
    for phase in phases:
        if phase in project.get("phases", {}):
            project["phases"][phase] = {"status": "pending"}
    project["artifacts"] = {
        name: artifact for name, artifact in project.get("artifacts", {}).items()
        if artifact.get("kind") not in kinds
    }


def init_command(args):
    repo = Path(args.repo).resolve()
    if not repo.is_dir():
        raise ValueError(f"repository does not exist: {repo}")
    workspace = Path(args.workspace).resolve()
    path = workspace / "project.json"
    if path.exists() and not args.force:
        raise ValueError(f"{path} exists; use --force only to intentionally replace it")
    dirty = bool(git_value(repo, "status", "--porcelain"))
    project = {
        "schemaVersion": SCHEMA_VERSION,
        "standardVersion": standard_version(),
        "pluginVersion": plugin_version(),
        "createdAt": now(),
        "repository": {
            "root": str(repo),
            "commit": git_value(repo, "rev-parse", "HEAD"),
            "dirty": dirty,
        },
        "target": {"figmaFileKey": None, "figmaUrl": None},
        "decisions": {"componentSource": None, "tokenSource": None,
                      "usageSource": None, "pageStrategy": "usage-tier"},
        "phases": {name: {"status": "pending"} for name in
                   ("discovery", "inventory", "usage", "capture", "tokens", "plan",
                    "foundation", "components", "index", "verify")},
        "artifacts": {},
    }
    write_json(path, project)
    print(json.dumps({"project": str(path), "repository": project["repository"]}, indent=2))


def detect_command(args):
    path, project = load_project(args.project)
    document = detect(project["repository"]["root"])
    output = path.parent / "detection.json"
    errors = validate(document, "detection")
    if errors:
        raise ValueError("invalid detection artifact: " + "; ".join(errors))
    write_json(output, document)
    register_artifact(path, "detection", output, "detection")
    path, project = load_project(path)
    invalidate(project,
               ("inventory", "usage", "capture", "tokens", "plan", "foundation",
                "components", "index", "verify"),
               ("components", "render-evidence", "capture-evidence", "tokens", "usage", "plan",
                "variable-plan", "foundation", "build-record", "index", "verify-report"))
    recommendations = document.get("recommended") or {}
    project["decisions"]["componentSource"] = recommendations.get("component")
    project["decisions"]["tokenSource"] = recommendations.get("token")
    project["decisions"]["usageSource"] = recommendations.get("usage")
    set_phase(path, project, "discovery", "complete", {
        "priorArtCount": len(document.get("priorArt") or []),
        "componentCandidates": len(document.get("componentSources") or []),
        "tokenCandidates": len(document.get("tokenSources") or []),
    })
    print(json.dumps({"output": str(output), "recommended": recommendations,
                      "priorArt": document.get("priorArt") or []}, indent=2))


def select_command(args):
    path, project = load_project(args.project)
    detection_path = path.parent / "detection.json"
    detection = load_json(detection_path)
    candidates = {
        "component": {x["strategy"] for x in detection.get("componentSources") or []},
        "token": {x["strategy"] for x in detection.get("tokenSources") or []},
        "usage": {x["strategy"] for x in detection.get("usageSources") or []},
    }
    previous = dict(project.get("decisions") or {})
    for name, value in (("component", args.component), ("token", args.token),
                        ("usage", args.usage)):
        if value and value not in candidates[name] and value != "none":
            raise ValueError(f"{value!r} is not a detected {name} strategy: "
                             + ", ".join(sorted(candidates[name])))
    if args.component and args.component != previous.get("componentSource"):
        invalidate(project, ("inventory", "usage", "capture", "plan", "components",
                             "index", "verify"),
                   ("components", "render-evidence", "capture-evidence", "usage", "plan", "build-record",
                    "index", "verify-report"))
    if args.token and args.token != previous.get("tokenSource"):
        invalidate(project, ("tokens", "foundation", "components", "index", "verify"),
                   ("tokens", "variable-plan", "foundation", "build-record", "index",
                    "verify-report"))
    if args.usage and args.usage != previous.get("usageSource"):
        invalidate(project, ("usage", "capture", "plan", "components", "index", "verify"),
                   ("usage", "capture-evidence", "plan", "build-record", "index", "verify-report"))
    if args.component:
        project["decisions"]["componentSource"] = args.component
    if args.token:
        project["decisions"]["tokenSource"] = args.token
    if args.usage:
        if args.usage == "none":
            if not args.degraded_reason:
                raise ValueError("--usage none requires --degraded-reason")
            if not args.by:
                raise ValueError("--usage none requires --by <human-decider>")
            project["decisions"]["usageSource"] = "none"
            set_phase(path, project, "usage", "waived", {
                "reason": args.degraded_reason,
                "by": args.by,
                "waivedAt": now(),
                "effect": "usage tiers and prioritisation are unverified",
            })
            path, project = load_project(path)
        else:
            project["decisions"]["usageSource"] = args.usage
            project["phases"]["usage"] = {"status": "pending"}
    project["decisions"]["selectedAt"] = now()
    write_json(path, project)
    print(json.dumps(project["decisions"], indent=2))


COMPONENT_EXTRACTORS = {
    "drupal-authoring": extract_drupal_authoring,
    "paragraphs": extract_paragraphs,
    "sdc": extract_sdc,
    "sitestudio": extract_sitestudio,
}
TOKEN_EXTRACTORS = {
    "css-custom-properties": extract_tokens_cssvars,
    "sass-sourcemap": extract_tokens_sourcemap,
    "sass-source": extract_tokens_sass,
    "sitestudio-styles": extract_tokens_sitestudio,
}


def extract_command(args):
    path, project = load_project(args.project)
    root = project["repository"]["root"]
    decisions = project["decisions"]
    if args.kind in ("components", "all"):
        strategy = decisions.get("componentSource")
        if strategy not in COMPONENT_EXTRACTORS:
            raise ValueError(f"component strategy {strategy!r} has no extractor; run select")
        document = COMPONENT_EXTRACTORS[strategy](root)
        output = path.parent / "components.json"
        errors = validate(document, "components")
        if errors:
            raise ValueError("invalid components: " + "; ".join(errors))
        write_json(output, document)
        invalidate(project, ("usage", "capture", "plan", "components", "index", "verify"),
                   ("usage", "capture-evidence", "plan", "build-record", "index", "verify-report"))
        write_json(path, project)
        register_artifact(path, "components", output, "components")
        if strategy == "drupal-authoring":
            rendering = extract_drupal_rendering(root, document)
            rendering_output = path.parent / "render-evidence.json"
            write_json(rendering_output, rendering)
            register_artifact(path, "renderEvidence", rendering_output, "render-evidence")
        path, project = load_project(path)
        set_phase(path, project, "inventory", "complete", {
            "strategy": strategy, "components": len(document["components"])})
    if args.kind in ("tokens", "all"):
        path, project = load_project(path)
        strategy = project["decisions"].get("tokenSource")
        if strategy not in TOKEN_EXTRACTORS:
            raise ValueError(f"token strategy {strategy!r} has no extractor; run select")
        document = TOKEN_EXTRACTORS[strategy](root)
        output = path.parent / "tokens.json"
        errors = validate(document, "tokens")
        if errors:
            raise ValueError("invalid tokens: " + "; ".join(errors))
        write_json(output, document)
        invalidate(project, ("plan", "foundation", "components", "index", "verify"),
                   ("plan", "variable-plan", "foundation", "build-record", "index",
                    "verify-report"))
        write_json(path, project)
        register_artifact(path, "tokens", output, "tokens")
        path, project = load_project(path)
        set_phase(path, project, "tokens", "complete", {"strategy": strategy})
    print(status(path))


def usage_command(args):
    path, project = load_project(args.project)
    strategy = project["decisions"].get("usageSource")
    if strategy != "drupal-db":
        raise ValueError(f"usage strategy {strategy!r} has no extractor; select drupal-db")
    components_path = path.parent / "components.json"
    components = load_json(components_path)
    ddev_root = Path(args.ddev_root or project["repository"]["root"]).resolve()
    document = extract_drupal_usage(ddev_root, components, args.ddev_project)
    output = path.parent / "usage.json"
    write_json(output, document)
    register_artifact(path, "usage", output, "usage")
    merged = merge_usage(components, document, args.high, args.medium)
    errors = validate(merged, "components")
    if errors:
        raise ValueError("usage merge made components invalid: " + "; ".join(errors))
    write_json(components_path, merged)
    register_artifact(path, "components", components_path, "components")
    path, project = load_project(path)
    invalidate(project, ("capture", "plan", "components", "index", "verify"),
               ("capture-evidence", "plan", "build-record", "index", "verify-report"))
    set_phase(path, project, "usage", "complete", {
        "strategy": strategy,
        "artifact": "usage",
        "ddevRoot": str(ddev_root),
        "ddevProject": args.ddev_project,
        "components": len(document["usage"]),
        "placements": sum(value["placements"] for value in document["usage"].values()),
        "structuralRefs": sum(value["structuralRefs"] for value in document["usage"].values()),
        "thresholds": {"high": args.high, "medium": args.medium},
    })
    print(json.dumps(project["phases"]["usage"], indent=2))


def plan_command(args):
    path, project = load_project(args.project)
    detection_path = path.parent / "detection.json"
    detection = load_json(detection_path) if detection_path.is_file() else {}
    detected_usage = detection.get("usageSources") or []
    usage_source = project["decisions"].get("usageSource")
    usage_status = (project.get("phases", {}).get("usage") or {}).get("status")
    if detected_usage and usage_source != "none" and usage_status != "complete":
        raise ValueError(
            "usage evidence was detected but is not complete; run `workflow.py usage`, "
            "or obtain approval and select --usage none --degraded-reason <reason> "
            "--by <human-decider>")
    if detected_usage and usage_source == "none" and usage_status != "waived":
        raise ValueError("degraded usage requires a recorded waiver")
    components = load_json(path.parent / "components.json")
    render_path = path.parent / "render-evidence.json"
    capture_path = path.parent / "capture-evidence.json"
    renders = load_json(render_path).get("items", {}) if render_path.is_file() else {}
    captures = load_json(capture_path).get("captures", {}) if capture_path.is_file() else {}
    plans = [plan_component(component, renders.get(component["id"]),
                            captures.get(component["id"]))
             for component in components["components"]]
    document = {"standardVersion": project["standardVersion"], "generatedAt": now(),
                "maxVariants": 64, "plans": plans}
    errors = validate(document, "plan")
    if errors:
        raise ValueError("invalid plan: " + "; ".join(errors))
    output = path.parent / "plan.json"
    write_json(output, document)
    register_artifact(path, "plan", output, "plan")
    path, project = load_project(path)
    invalidate(project, ("components", "index", "verify"),
               ("build-record", "index", "verify-report"))
    set_phase(path, project, "plan", "awaiting-approval", {
        "build": sum(p["verdict"] == "build" for p in plans),
        "refuse": sum(p["verdict"] == "refuse" for p in plans),
        "flags": sum(len(p["flags"]) for p in plans),
    })
    print(json.dumps(project["phases"]["plan"], indent=2))


def variables_command(args):
    path, project = load_project(args.project)
    document = plan_variables(load_json(path.parent / "tokens.json"))
    errors = validate(document, "variable-plan")
    if errors:
        raise ValueError("invalid variable plan: " + "; ".join(errors))
    output = path.parent / "variable-plan.json"
    write_json(output, document)
    register_artifact(path, "variablePlan", output, "variable-plan")
    path, project = load_project(path)
    invalidate(project, ("foundation", "components", "index", "verify"),
               ("foundation", "build-record", "index", "verify-report"))
    write_json(path, project)
    print(json.dumps({"output": str(output), "collections": len(document["collections"]),
                      "warnings": document.get("warnings") or []}, indent=2))


def approve_command(args):
    path, project = load_project(args.project)
    if project["phases"]["plan"]["status"] != "awaiting-approval":
        raise ValueError("plan is not awaiting approval")
    project["phases"]["plan"]["status"] = "approved"
    project["phases"]["plan"]["approvedAt"] = now()
    project["phases"]["plan"]["approvedBy"] = args.by
    write_json(path, project)
    print(json.dumps(project["phases"]["plan"], indent=2))


def target_command(args):
    path, project = load_project(args.project)
    match = re.search(r"/design/([A-Za-z0-9]+)", args.figma_url)
    if not match:
        raise ValueError("Figma URL does not contain a /design/<file-key> target")
    previous = (project.get("target") or {}).get("figmaFileKey")
    if previous and previous != match.group(1):
        invalidate(project, ("foundation", "components", "index", "verify"),
                   ("foundation", "build-record", "index", "verify-report"))
    project["target"] = {"figmaFileKey": match.group(1), "figmaUrl": args.figma_url,
                         "recordedAt": now()}
    write_json(path, project)
    print(json.dumps(project["target"], indent=2))


def register_command(args):
    path, project_before = load_project(args.project)
    if args.phase == "capture":
        invalidate(project_before, ("plan", "components", "index", "verify"),
                   ("plan", "build-record", "index", "verify-report"))
        write_json(path, project_before)
    target = Path(args.path).resolve()
    project = register_artifact(path, args.name, target, args.kind)
    artifact = project["artifacts"][args.name]
    if not artifact["valid"]:
        raise ValueError(f"invalid {args.name} artifact: " + "; ".join(artifact["errors"]))
    coverage = None
    if args.phase == "components":
        path, project = load_project(path)
        coverage = component_coverage(path, project)
        status_ = ("complete" if coverage["planAvailable"] and
                   not coverage["missing"] and not coverage["unexpected"] and
                   not coverage["invalid"] else "running")
        set_phase(path, project, "components", status_, coverage)
    elif args.phase:
        path, project = load_project(path)
        set_phase(path, project, args.phase, "complete", {"artifact": args.name})
    print(json.dumps({"name": args.name, "path": str(target), "sha256": sha256(target),
                      **({"componentCoverage": coverage} if coverage else {})}, indent=2))


def record_command(args):
    path, project = load_project(args.project)
    detail = json.loads(args.detail) if args.detail else None
    if args.status == "waived":
        if not args.by:
            raise ValueError("waived status requires --by <human-decider>")
        if not isinstance(detail, dict) or not str(detail.get("reason") or "").strip():
            raise ValueError("waived status requires --detail with a non-empty `reason`")
        detail = {**detail, "by": args.by, "waivedAt": now()}
    set_phase(path, project, args.phase, args.status, detail)
    print(json.dumps(project["phases"][args.phase], indent=2))


def validate_command(args):
    path, project = load_project(args.project)
    results = {}
    project_errors = validate(project, "project")
    results["project"] = project_errors
    for name, artifact in project.get("artifacts", {}).items():
        target = (path.parent / artifact["path"]).resolve()
        try:
            document = load_json(target)
            results[name] = validate(document, artifact.get("kind"), filename=str(target))
            if artifact.get("sha256") != sha256(target):
                results[name].append("content hash differs from project manifest")
        except Exception as error:
            results[name] = [str(error)]
    components_phase = (project.get("phases", {}).get("components") or {}).get("status")
    if components_phase == "complete":
        coverage = component_coverage(path, project)
        coverage_errors = []
        if not coverage["planAvailable"]:
            coverage_errors.append("component phase is complete but no valid plan is registered")
        if coverage["missing"]:
            coverage_errors.append("missing build records: " + ", ".join(coverage["missing"][:12]))
        if coverage["unexpected"]:
            coverage_errors.append("stale build records: " + ", ".join(coverage["unexpected"][:12]))
        if coverage["invalid"]:
            coverage_errors.append("invalid build records: " + ", ".join(coverage["invalid"][:12]))
        results["componentCoverage"] = coverage_errors
    verify_phase = (project.get("phases", {}).get("verify") or {}).get("status")
    if verify_phase == "complete":
        completion_errors = []
        required_phases = ("discovery", "inventory", "usage", "capture", "tokens", "plan",
                           "foundation", "components", "index")
        incomplete = [phase for phase in required_phases
                      if (project.get("phases", {}).get(phase) or {}).get("status")
                      not in ("complete", "approved")]
        if incomplete:
            completion_errors.append("required phases are not resolved: " + ", ".join(incomplete))
        if not (project.get("target") or {}).get("figmaFileKey"):
            completion_errors.append("verified project has no Figma target")
        receipt = next((artifact for artifact in project.get("artifacts", {}).values()
                        if artifact.get("kind") == "verify-report" and artifact.get("valid")), None)
        if not receipt:
            completion_errors.append("verified project has no valid verification receipt")
        else:
            report = load_json((path.parent / receipt["path"]).resolve())
            blocking = [item for item in report.get("open") or []
                        if item.get("severity") in ("blocker", "major")]
            if blocking:
                completion_errors.append(
                    f"verification has {len(blocking)} open blocker/major finding(s)")
        results["completionGate"] = completion_errors
    failures = {name: errors for name, errors in results.items() if errors}
    print(json.dumps({"valid": not failures, "results": results}, indent=2))
    if failures:
        raise SystemExit(1)


def status(value: str | Path) -> str:
    path, project = load_project(value)
    next_phase = next((name for name, phase in project["phases"].items()
                       if phase["status"] not in ("complete", "approved", "waived")), None)
    return json.dumps({
        "project": str(path),
        "pluginVersion": project["pluginVersion"],
        "standardVersion": project["standardVersion"],
        "repository": project["repository"],
        "decisions": project["decisions"],
        "nextPhase": next_phase,
        "phases": project["phases"],
        "artifacts": {name: {"path": value["path"], "valid": value["valid"]}
                      for name, value in project["artifacts"].items()},
    }, indent=2)


def component_coverage(project_path_: Path, project: dict) -> dict:
    """Derive component-phase completion from the approved plan and valid receipts."""
    plan_receipt = project.get("artifacts", {}).get("plan")
    expected: set[str] = set()
    plan_available = False
    if plan_receipt and plan_receipt.get("kind") == "plan" and plan_receipt.get("valid"):
        try:
            plan = load_json((project_path_.parent / plan_receipt["path"]).resolve())
            expected = {entry["id"] for entry in plan.get("plans") or []
                        if entry.get("verdict") == "build"}
            plan_available = True
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
            pass

    built: set[str] = set()
    invalid: list[str] = []
    for name, artifact in project.get("artifacts", {}).items():
        if artifact.get("kind") != "build-record":
            continue
        try:
            target = (project_path_.parent / artifact["path"]).resolve()
            record = load_json(target)
            errors = validate(record, "build-record", filename=str(target))
            if (errors or not artifact.get("valid") or
                    artifact.get("sha256") != sha256(target)):
                invalid.append(name)
            else:
                built.add(record["id"])
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
            invalid.append(name)
    return {
        "planAvailable": plan_available,
        "expected": len(expected),
        "built": len(built & expected),
        "missing": sorted(expected - built),
        "unexpected": sorted(built - expected),
        "invalid": sorted(invalid),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    command = sub.add_parser("init")
    command.add_argument("--repo", required=True)
    command.add_argument("--workspace", default=".design-lab")
    command.add_argument("--force", action="store_true")
    command.set_defaults(func=init_command)

    command = sub.add_parser("detect")
    command.add_argument("--project", default=".design-lab")
    command.set_defaults(func=detect_command)

    command = sub.add_parser("select")
    command.add_argument("--project", default=".design-lab")
    command.add_argument("--component")
    command.add_argument("--token")
    command.add_argument("--usage")
    command.add_argument("--degraded-reason")
    command.add_argument("--by", help="human decider authorising degraded usage")
    command.set_defaults(func=select_command)

    command = sub.add_parser("extract")
    command.add_argument("--project", default=".design-lab")
    command.add_argument("--kind", choices=("components", "tokens", "all"), default="all")
    command.set_defaults(func=extract_command)

    command = sub.add_parser("usage")
    command.add_argument("--project", default=".design-lab")
    command.add_argument("--ddev-root")
    command.add_argument("--ddev-project")
    command.add_argument("--high", type=int, default=50)
    command.add_argument("--medium", type=int, default=10)
    command.set_defaults(func=usage_command)

    command = sub.add_parser("plan")
    command.add_argument("--project", default=".design-lab")
    command.set_defaults(func=plan_command)

    command = sub.add_parser("variables")
    command.add_argument("--project", default=".design-lab")
    command.set_defaults(func=variables_command)

    command = sub.add_parser("approve")
    command.add_argument("--project", default=".design-lab")
    command.add_argument("--by", required=True)
    command.set_defaults(func=approve_command)

    command = sub.add_parser("target")
    command.add_argument("--project", default=".design-lab")
    command.add_argument("--figma-url", required=True)
    command.set_defaults(func=target_command)

    command = sub.add_parser("register")
    command.add_argument("--project", default=".design-lab")
    command.add_argument("--name", required=True)
    command.add_argument("--path", required=True)
    command.add_argument("--kind", choices=("detection", "components", "render-evidence", "capture-evidence", "tokens", "usage", "plan",
                                                  "variable-plan", "foundation", "index",
                                                  "build-record", "verify-report"))
    command.add_argument("--phase", choices=("usage", "capture", "foundation", "components",
                                                "index", "verify"))
    command.set_defaults(func=register_command)

    command = sub.add_parser("record")
    command.add_argument("--project", default=".design-lab")
    command.add_argument("--phase", required=True,
                         choices=("usage", "capture", "foundation", "components", "index", "verify"))
    command.add_argument("--status", required=True,
                         choices=("pending", "running", "complete", "failed", "waived"))
    command.add_argument("--detail")
    command.add_argument("--by", help="human decider; required when status is waived")
    command.set_defaults(func=record_command)

    command = sub.add_parser("validate")
    command.add_argument("--project", default=".design-lab")
    command.set_defaults(func=validate_command)

    command = sub.add_parser("status")
    command.add_argument("--project", default=".design-lab")
    command.set_defaults(func=lambda args: print(status(args.project)))

    args = parser.parse_args()
    try:
        args.func(args)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        parser.exit(2, f"error: {error}\n")


if __name__ == "__main__":
    main()
