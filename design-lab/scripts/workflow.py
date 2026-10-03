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
from extract_canvas import extract as extract_canvas
from extract_canvas_usage import extract as extract_canvas_usage, merge_canvas_usage
from extract_drupal_authoring import extract as extract_drupal_authoring
from extract_drupal_rendering import extract as extract_drupal_rendering
from extract_drupal_usage import extract as extract_drupal_usage, merge_usage
from find_rendered_components import enrich_usage as enrich_rendered_usage, scan as scan_rendered
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


PHASE_LOG = "phase-log.jsonl"


def append_jsonl(path: Path, entry: dict) -> None:
    """Append one JSON line and fsync it; these logs are evidence for design-lab:evaluate."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def set_phase(project_path_: Path, project: dict, phase: str, status: str,
              detail: dict | None = None, at: str | None = None) -> None:
    project.setdefault("phases", {})[phase] = {
        "status": status,
        "updatedAt": at or now(),
        **({"detail": detail} if detail else {}),
    }
    write_json(project_path_, project)
    append_jsonl(project_path_.parent / PHASE_LOG,
                 {"at": project["phases"][phase]["updatedAt"], "phase": phase, "status": status})


def plugin_source() -> dict:
    """Plugin version, plus its commit when this copy is tracked by git (an installed cache is not)."""
    tracked = git_value(PLUGIN_DIR, "ls-files", "--error-unmatch", ".claude-plugin/plugin.json")
    commit = git_value(PLUGIN_DIR, "rev-parse", "HEAD") if tracked else None
    dirty = bool(git_value(PLUGIN_DIR, "status", "--porcelain", "--", ".")) if commit else None
    return {"version": plugin_version(), "commit": commit, "dirty": dirty}


def claude_config_dir() -> str:
    return os.environ.get("CLAUDE_CONFIG_DIR") or str(Path.home() / ".claude")


def transcript_folder(config_dir: str, cwd: str) -> str:
    """Where Claude Code keeps session transcripts for sessions started in `cwd`."""
    return str(Path(config_dir) / "projects" / re.sub(r"[^A-Za-z0-9]", "-", cwd))


def run_identity(args, repo: Path) -> dict:
    """Who ran this, with what, against what: the evidence that makes two runs comparable."""
    cwd = os.getcwd()
    config_dir = claude_config_dir()
    operator = (getattr(args, "operator", None) or git_value(repo, "config", "user.name")
                or os.environ.get("USER"))
    return {
        "startedAt": now(),
        "siteLabel": getattr(args, "site_label", None),
        "siteUrl": getattr(args, "site_url", None),
        "operator": operator,
        "plugin": plugin_source(),
        "claude": {"configDir": config_dir,
                   "model": (getattr(args, "model", None) or os.environ.get("ANTHROPIC_MODEL")
                             or os.environ.get("CLAUDE_MODEL")),
                   "insideClaudeCode": bool(os.environ.get("CLAUDECODE")),
                   "workingDirectory": cwd,
                   "transcripts": transcript_folder(config_dir, cwd)},
    }


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
        "run": run_identity(args, repo),
    }
    write_json(path, project)
    append_jsonl(workspace / PHASE_LOG, {"at": project["createdAt"], "phase": "init",
                                         "status": "complete"})
    write_active_run(workspace)
    print(json.dumps({"project": str(path), "repository": project["repository"],
                      "run": project["run"]}, indent=2))


def identity_command(args):
    """Fill in or correct run identity; also works on manifests written before 0.15."""
    path, project = load_project(args.project)
    run = project.get("run")
    if not isinstance(run, dict):
        run = run_identity(argparse.Namespace(), Path(project["repository"]["root"]))
        run["startedAt"] = project.get("createdAt") or run["startedAt"]
        run["recordedLate"] = True
    for key, value in (("siteLabel", args.site_label), ("siteUrl", args.site_url),
                       ("operator", args.operator)):
        if value:
            run[key] = value
    if args.model:
        run.setdefault("claude", {})["model"] = args.model
    if args.no_schema_change and args.schema_change:
        raise ValueError("use --no-schema-change or --schema-change, not both")
    if args.no_schema_change:
        run["schemaChurn"] = {"changed": False, "changes": [], "recordedAt": now()}
    if args.schema_change:
        churn = run.get("schemaChurn") if (run.get("schemaChurn") or {}).get("changed") else {"changes": []}
        churn["changes"] = list(churn.get("changes") or []) + [
            {"at": now(), "text": text} for text in args.schema_change]
        run["schemaChurn"] = {"changed": True, "changes": churn["changes"], "recordedAt": now()}
    project["run"] = run
    write_json(path, project)
    print(json.dumps(run, indent=2))


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
    "canvas": extract_canvas,
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
    if strategy not in ("drupal-db", "canvas-db"):
        raise ValueError(f"usage strategy {strategy!r} has no extractor")
    components_path = path.parent / "components.json"
    components = load_json(components_path)
    ddev_root = Path(args.ddev_root or project["repository"]["root"]).resolve()
    extractor = extract_canvas_usage if strategy == "canvas-db" else extract_drupal_usage
    render_path = path.parent / "render-evidence.json"
    if strategy == "drupal-db":
        rendering = load_json(render_path) if render_path.is_file() else None
        document = extractor(ddev_root, components, args.ddev_project, rendering)
        verification = (document.get("source") or {}).get("exampleVerification") or {}
        if verification.get("pagesFetched") and not verification.get("twigDebug") \
                and not args.without_twig_debug:
            # Without the debug comments every bundle printed by its own template has no marker,
            # and the run quietly loses those components (269 placements of one card on one site).
            raise ValueError(
                "Twig debug is off on the local site. Turn on Twig debug only (not the Twig cache "
                "switch), rebuild caches, and run usage again; pass --without-twig-debug to "
                "accept losing every component located by its template")
    else:
        document = extractor(ddev_root, components, args.ddev_project)
    if args.base_url:
        evidence, details = scan_rendered(args.base_url, ddev_root, components)
        document = enrich_rendered_usage(document, evidence, details)
    output = path.parent / "usage.json"
    write_json(output, document)
    register_artifact(path, "usage", output, "usage")
    merged = (merge_canvas_usage(components, document, args.high, args.medium)
              if strategy == "canvas-db" else
              merge_usage(components, document, args.high, args.medium))
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
    relationships_path = path.parent / "capture" / "relationships.json"
    relationships = load_json(relationships_path) if relationships_path.is_file() else {}
    nested = {}
    for evidence in relationships.values():
        for child, count in (evidence.get("children") or {}).items():
            nested[child] = nested.get(child, 0) + count
    plans = [plan_component(component, renders.get(component["id"]),
                            captures.get(component["id"]), nested.get(component["id"], 0))
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


def site_reachable(url: str) -> tuple[bool, str]:
    """Whether the local site answers. A local development certificate is accepted as it is."""
    import ssl
    import urllib.error
    import urllib.request
    context = ssl._create_unverified_context() if url.startswith("https://") else None
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=10, context=context) as response:
            return response.status < 500, f"HTTP {response.status}"
    except urllib.error.HTTPError as error:
        return error.code < 500, f"HTTP {error.code}"
    except (urllib.error.URLError, OSError, ValueError) as error:
        return False, str(getattr(error, "reason", error))


def runner_handshake(workspace: Path, file_key: str, figma_url: str, timeout: float,
                     project: dict | None = None) -> dict:
    """Refresh the runner in ~/.design-lab/runner/, start or reuse the runner server, tell the
    person what to do, and wait for the runner to check the target file and draw a name-only
    Cover in it through the real cover.js. The token is never printed: the person copies it
    from ~/.design-lab/runner-token once per machine."""
    import figma_build
    import figma_runner
    import library_counts
    install = figma_runner.install_runner()
    try:
        server = figma_runner.ensure_server(workspace)
    except (RuntimeError, OSError) as error:
        return {"ok": False, "runnerConnected": False, "install": install,
                "failure": f"the runner server could not start: {error}"}
    token_file = figma_runner.HOME / figma_runner.TOKEN_FILE
    steps = ([f"Import the runner once: in Figma desktop, Plugins, Development, Import plugin from manifest, and "
              f"choose {install['manifest']}. Later versions only need a restart of the runner."]
             if install["firstInstall"] else
             [f"The runner was updated to {install['version']}: if it is open, close it and start it again, so "
              "Figma loads the new code."] if install["updated"] else [])
    steps += [f"Open the target file ({figma_url}) in Figma desktop and start the design-lab runner (Plugins, "
              f"Development, design-lab runner). If it asks for a token, paste yours (copy it with: pbcopy < {token_file}).",
              f"Waiting up to {timeout:g} seconds for it to connect."]
    print("\n".join(steps), file=sys.stderr, flush=True)
    # The Cover's name-only form: the site's name and "Component Library", nothing computed.
    cover = {"ground": library_counts.COVER_GROUND,
             "headline": figma_build.site_name(Path((project or {}).get("repository", {}).get("root") or workspace)),
             "subtitle": "Component Library", "provenance": {"stage": "preflight"},
             "version": figma_build.STANDARD_VERSION}
    expected = (((project or {}).get("target") or {}).get("preflight") or {}).get("coverPageId")
    # A resumed run whose build has begun in this file: the file is no longer empty, so preflight
    # proves only that the runner is connected to it.
    try:
        begun = json.loads((workspace / "figma" / "state.json").read_text()).get("fileKey") == file_key
    except (OSError, ValueError):
        begun = False
    figma_runner.request_handshake(workspace, cover, expected, connection_only=begun)
    outcome = figma_runner.wait_for_handshake(workspace, timeout)
    if not outcome.get("runnerConnected") and install["firstInstall"]:
        outcome["failure"] = (f"Import the runner in Figma desktop (Plugins, Development, Import plugin from manifest, "
                              f"{install['manifest']}), open the target file and start it, then run preflight again; "
                              + outcome.get("failure", "no runner connected"))
    return {**outcome, "server": {"pid": server.get("pid"), "started": server.get("started")},
            "install": install, "instructions": steps[:-1]}


RUNNER_ABSENT_MINUTES = 2


def build_phase(project: dict) -> str:
    phases = project.get("phases") or {}
    return next((name for name in ("foundation", "components", "index")
                 if (phases.get(name) or {}).get("status") not in ("complete", "approved", "waived")), "components")


def await_runner(workspace: Path, project: dict, minutes: float = RUNNER_ABSENT_MINUTES, poll: float = 5) -> dict:
    """At the start of the build and any time during it: the runner must have asked for a step
    within the last `minutes`, or ask within that long now. If it does not, the run stops with
    what is needed first and why, and the stop is logged as an interruption with its phase."""
    import datetime as dt
    import time
    import figma_runner
    figma_runner.ensure_server(workspace)
    seen_file = workspace / "figma" / figma_runner.SEEN_FILE

    def seen():
        try:
            return dt.datetime.fromisoformat(seen_file.read_text().strip())
        except (OSError, ValueError):
            return None

    window = dt.timedelta(minutes=minutes)
    deadline = time.monotonic() + minutes * 60
    while True:
        last = seen()
        if last and dt.datetime.now(dt.timezone.utc) - last <= window:
            return {"connected": True, "lastSeen": last.isoformat()}
        if figma_runner.server_status(workspace).get("inflight"):
            # The server is still working on a step the runner asked for (a slow image fetch):
            # the runner is there, waiting for the answer.
            return {"connected": True, "inflight": True, "lastSeen": last.isoformat() if last else None}
        if time.monotonic() >= deadline:
            break
        time.sleep(poll)
    absent = (dt.datetime.now(dt.timezone.utc) - last).total_seconds() / 60 if last else minutes
    address = ((project.get("target") or {}).get("figmaUrl")
               or ((project.get("target") or {}).get("preflight") or {}).get("fileUrl") or "the target Figma file")
    whole = max(1, round(absent))
    message = (f"Open Figma desktop, open {address}, and start the design-lab runner. The build writes the component "
               f"library into that file through the runner, and it has not connected for {whole} "
               f"minute{'s' if whole != 1 else ''}.")
    phase = build_phase(project)
    append_jsonl(workspace / PHASE_LOG, {"at": now(), "phase": phase, "status": "stopped",
                                         "reason": "runner not connected", "message": message})
    return {"connected": False, "phase": phase, "message": message}


def runner_command(args):
    """Whether this run's runner server is alive; with --ensure, restart it if it is not, so the
    runner in Figma desktop reconnects without the person; with --await-runner, stop the run with
    what is needed when the runner has not asked for a step for about two minutes."""
    import figma_runner
    path, project = load_project(args.project)
    if args.await_runner:
        outcome = await_runner(path.parent, project, args.minutes)
        print(json.dumps(outcome, indent=2))
        if not outcome["connected"]:
            print(outcome["message"], file=sys.stderr)
            sys.exit(1)
        return
    state = figma_runner.ensure_server(path.parent) if args.ensure else figma_runner.server_status(path.parent)
    print(json.dumps(state, indent=2))


PREFLIGHT_CHECKS = "preflight-checks.json"


class Checklist:
    """preflight-checks.json: every check preflight makes, in order, rewritten as each one starts
    and settles, so anything watching the run (the design-lab pane, workflow.py watch) ticks it
    off as it goes. Statuses: waiting (on another check), checking, done, failed, needs-you."""

    def __init__(self, workspace: Path):
        self.path = Path(workspace) / PREFLIGHT_CHECKS
        self.document = {"pass": now(), "at": now(), "ready": None, "checks": []}

    def record_check(self, id: str, label: str, status: str, message: str | None = None,
                     depends_on: tuple[str, ...] = ()) -> None:
        check = {"id": id, "label": label, "status": status, "message": message,
                 "dependsOn": list(depends_on), "at": now()}
        checks = self.document["checks"]
        index = next((i for i, c in enumerate(checks) if c["id"] == id), None)
        if index is None:
            checks.append(check)
        else:
            checks[index] = check
        self.write()

    def status(self, id: str) -> str | None:
        return next((c["status"] for c in self.document["checks"] if c["id"] == id), None)

    def finish(self, ready: bool, go_ahead: str | None = None) -> None:
        self.document.update({"ready": ready, "goAheadAt": go_ahead})
        self.write()

    def write(self) -> None:
        self.document["at"] = now()
        write_json(self.path, self.document)


def preflight_command(args):
    """Gather every answer the run needs in one pass, check what can be checked, and either give
    the go-ahead (recorded as the preflight phase, so the benchmark knows when the run was left to
    itself) or list exactly what is still missing. The run's end product is a Figma file, so the
    go-ahead also needs proof that the target file can be written: the runner server is started
    (or reused), the runner in Figma desktop connects, and one check step confirms the open file
    is the target, is empty, and accepts a node that is created and deleted again."""
    path, project = load_project(args.project)
    run = project.get("run") if isinstance(project.get("run"), dict) else {}
    missing, checks = [], {}
    checklist = Checklist(path.parent)

    def answer(id, label, value, needed):
        if not value:
            missing.append(needed)
        checklist.record_check(id, label, "done" if value else "needs-you",
                               None if value else f"Still needed: {needed}.")

    site_url = args.site_url or run.get("siteUrl")
    figma_key = re.search(r"/design/([A-Za-z0-9]+)", args.figma_url or "")
    site_label = args.site_label or run.get("siteLabel")
    operator = args.operator or run.get("operator")
    usage = (project.get("decisions") or {}).get("usageSource")
    # The whole list first, so the pane shows what is coming before anything is checked.
    checklist.record_check("site-url", "Local site address", "checking")
    checklist.record_check("site", "The local site answers", "waiting", depends_on=("site-url",))
    checklist.record_check("site-label", "Site label for reports", "checking")
    checklist.record_check("operator", "Operator's name", "checking")
    if usage and usage != "none":
        checklist.record_check("usage", f"DDEV project for the {usage} usage source", "checking")
    checklist.record_check("figma-url", "Target Figma file address", "checking")
    checklist.record_check("runner", "Runner connected to the target file", "waiting", depends_on=("figma-url",))
    checklist.record_check("cover", "Target file accepts writes", "waiting", depends_on=("runner",))

    answer("site-url", "Local site address", site_url, "the local site address (--site-url)")
    if site_url:
        checklist.record_check("site", "The local site answers", "checking", f"Opening {site_url}.", ("site-url",))
        ok, detail = site_reachable(site_url)
        checks["site"] = {"url": site_url, "reachable": ok, "detail": detail}
        if not ok:
            missing.append(f"a running local site at {site_url} ({detail})")
        checklist.record_check("site", "The local site answers", "done" if ok else "needs-you",
                               None if ok else f"Start the local site at {site_url}: it did not answer ({detail}).",
                               ("site-url",))
    answer("site-label", "Site label for reports", site_label, "a neutral site label for reports (--site-label)")
    answer("operator", "Operator's name", operator, "the operator's name (--operator)")
    if usage and usage != "none":
        ddev_root = Path(args.ddev_root or project["repository"]["root"]).resolve()
        checks["usage"] = {"source": usage, "ddevRoot": str(ddev_root), "ddevProject": (ddev_root / ".ddev").is_dir()}
        usable = checks["usage"]["ddevProject"] or args.usage_fallback == "untiered"
        if not usable:
            missing.append(f"a DDEV project for the {usage} usage source at {ddev_root} (--ddev-root), or "
                           "--usage-fallback untiered to build without usage tiers")
        checklist.record_check("usage", f"DDEV project for the {usage} usage source", "done" if usable else "needs-you",
                               None if checks["usage"]["ddevProject"] else
                               "No DDEV project: building without usage tiers." if usable else
                               f"Start or point at the DDEV project for the {usage} usage source ({ddev_root}).")
    answer("figma-url", "Target Figma file address", figma_key,
           "the target Figma file address, https://www.figma.com/design/<file-key>/... (--figma-url)")
    answers = {"siteUrl": site_url, "publicUrl": args.public_url, "figmaUrl": args.figma_url,
               "siteLabel": site_label, "operator": operator, "model": args.model,
               "planApproval": args.plan_approval, "usageFallback": args.usage_fallback,
               "ddevRoot": args.ddev_root,
               "schemaChurn": "recorded by the run at the benchmark, without asking"}
    if figma_key:
        # The server finds this run by its target file, so the target is recorded before it starts.
        previous = (project.get("target") or {}).get("figmaFileKey")
        if previous and previous != figma_key.group(1):
            invalidate(project, ("foundation", "components", "index", "verify"),
                       ("foundation", "build-record", "index", "verify-report"))
        kept = (project.get("target") or {}).get("preflight") if previous == figma_key.group(1) else None
        project["target"] = {"figmaFileKey": figma_key.group(1), "figmaUrl": args.figma_url, "recordedAt": now(),
                             **({"preflight": kept} if kept else {})}
        write_json(path, project)
        checklist.record_check("runner", "Runner connected to the target file", "checking",
                               f"Waiting for the design-lab runner in Figma desktop, with {args.figma_url} open.",
                               ("figma-url",))
        handshake = runner_handshake(path.parent, figma_key.group(1), args.figma_url, args.runner_timeout, project)
        checks["runner"] = handshake
        write_active_run(path.parent, (handshake.get("server") or {}).get("pid"))
        failure = handshake.get("failure") or "the Figma file could not be proven writable"
        connected = bool(handshake.get("runnerConnected"))
        checklist.record_check("runner", "Runner connected to the target file", "done" if connected else "needs-you",
                               None if connected else " ".join(handshake.get("instructions") or []) or failure,
                               ("figma-url",))
        checklist.record_check("cover", "Target file accepts writes",
                               "done" if handshake.get("ok") else "waiting" if not connected else "failed",
                               "A resumed build: the file already holds it, so only the connection is proven."
                               if handshake.get("ok") and handshake.get("connectionOnly") else
                               None if handshake.get("ok") or not connected else failure, ("runner",))
        if not handshake.get("ok"):
            missing.append(failure)
        elif not handshake.get("connectionOnly"):
            # What the name-only Cover proved; the build reuses this Cover page and this address.
            path, project = load_project(path)
            project["target"]["preflight"] = {
                "fileKey": figma_key.group(1), "fileUrl": args.figma_url, "coverPageId": handshake.get("coverPageId"),
                "coverId": handshake.get("coverId"), "font": handshake.get("font"),
                "fontLoaded": handshake.get("fontLoaded"), "at": handshake.get("at")}
            write_json(path, project)
    if missing:
        checklist.finish(False)
        print(json.dumps({"ready": False, "missing": missing, "checks": checks,
                          "message": "Still needed before the run can go ahead unattended: " + "; ".join(m.rstrip(".") for m in missing) + "."},
                         indent=2))
        sys.exit(1)
    for key, value in (("siteLabel", site_label), ("siteUrl", site_url), ("operator", operator)):
        run[key] = value
    if args.model:
        run.setdefault("claude", {})["model"] = args.model
    project["run"] = run
    go_ahead = now()
    set_phase(path, project, "preflight", "complete", {**answers, "checks": checks, "goAheadAt": go_ahead},
              at=go_ahead)
    checklist.finish(True, go_ahead)
    print(json.dumps({"ready": True, "goAheadAt": go_ahead, "checks": checks,
                      "message": "I have everything I need; it's safe to let this run to completion."}, indent=2))


def approve_command(args):
    path, project = load_project(args.project)
    if project["phases"]["plan"]["status"] != "awaiting-approval":
        raise ValueError("plan is not awaiting approval")
    by = args.by
    if args.from_preflight:
        detail = (project["phases"].get("preflight") or {}).get("detail") or {}
        if detail.get("planApproval") != "proposed":
            raise ValueError("preflight chose to review the plan before building: stop and ask the person to "
                             "review plan.json, then approve with --by <name>")
        by = f"{detail.get('operator')} (preflight: build the plan as proposed)"
    if not by:
        raise ValueError("approve needs --by <name> or --from-preflight")
    project["phases"]["plan"]["status"] = "approved"
    project["phases"]["plan"]["approvedAt"] = now()
    project["phases"]["plan"]["approvedBy"] = by
    write_json(path, project)
    append_jsonl(path.parent / PHASE_LOG, {"at": project["phases"]["plan"]["approvedAt"], "phase": "plan",
                                           "status": "approved"})
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


def benchmark_completed(workspace: Path) -> bool:
    try:
        lines = (workspace / PHASE_LOG).read_text().splitlines()
    except OSError:
        return False
    for line in lines:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if entry.get("phase") == "benchmark" and entry.get("status") == "complete":
            return True
    return False


def record_command(args):
    path, project = load_project(args.project)
    if args.phase == "benchmark" and args.status == "running" and benchmark_completed(path.parent):
        # The benchmark is the first start-and-completion pair; a re-score never starts another.
        print(json.dumps({"ignored": True, "reason": "the benchmark already has a recorded start and end; "
                          "re-score with score_run.py alone, which keeps them"}, indent=2))
        return
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


ACTIVE_RUN = "active-run.json"
SERVER_FRESH_SECONDS = 30  # three missed heartbeats (figma_runner.HEARTBEAT_SECONDS)


def write_active_run(workspace: Path, server_pid: int | None = None) -> None:
    """Point at the run being built, for anything that shows it without being told which run
    (the design-lab pane). One run at a time, so one pointer; the server's process id lets a
    reader tell a live run from one whose server is gone."""
    import figma_runner
    figma_runner.HOME.mkdir(mode=0o700, parents=True, exist_ok=True)
    write_json(figma_runner.HOME / ACTIVE_RUN,
               {"workspace": str(Path(workspace).resolve()), "serverPid": server_pid, "at": now()})


def read_json_or(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def seconds_since(stamp: str | None) -> float | None:
    import datetime as dt
    try:
        return (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(stamp)).total_seconds()
    except (TypeError, ValueError):
        return None


def watch_summary(workspace: Path) -> dict:
    """Where a run is, from the files the run writes: what the design-lab pane shows, as data.
    Reads leniently, so a run in any state, or half-written, still summarises."""
    workspace = Path(workspace).resolve()
    project = read_json_or(workspace / "project.json")
    if project is None:
        return {"workspace": str(workspace), "found": False}
    phases = project.get("phases") or {}
    entries = []
    try:
        entries = [json.loads(line) for line in (workspace / PHASE_LOG).read_text().splitlines() if line.strip()]
    except (OSError, ValueError):
        pass
    # The open blocker: the newest entry, when it stopped the run for the person.
    blocker = entries[-1].get("message") if entries and entries[-1].get("status") == "stopped" else None
    progress = read_json_or(workspace / "figma" / "progress.json")
    runner = None
    if progress:
        server_age = seconds_since(progress.get("at"))
        server_alive = server_age is not None and server_age <= SERVER_FRESH_SECONDS
        seen_age = seconds_since(progress.get("lastSeen"))
        connected = (seen_age is not None and seen_age <= RUNNER_ABSENT_MINUTES * 60) or \
            (server_alive and bool(progress.get("inflight")))
        runner = {"serverAlive": server_alive, "connected": server_alive and connected,
                  "lastSeenSeconds": seen_age, "state": progress.get("state"),
                  "stepsDone": progress.get("stepsDone"), "stepsTotal": progress.get("stepsTotal"),
                  "stepKind": progress.get("stepKind"), "message": progress.get("message")}
    if runner and runner["connected"]:
        blocker = None   # the runner came back after the stop, and the build has carried on
    completion = workspace / "benchmark" / "completion.md"
    checks = preflight_checks(workspace, phases.get("preflight") or {})
    recap = str(completion) if completion.is_file() and recap_is_current(workspace, project) else None
    return {"workspace": str(workspace), "found": True,
            "siteLabel": (project.get("run") or {}).get("siteLabel"),
            "phases": [{"name": name, "status": (value or {}).get("status")} for name, value in phases.items()],
            "nextPhase": next((name for name, value in phases.items()
                               if (value or {}).get("status") not in ("complete", "approved", "waived")), None),
            "preflightChecks": checks, "runner": runner, "blocker": blocker,
            "recap": recap}


def preflight_checks(workspace: Path, phase: dict) -> list | None:
    """The checklist preflight last wrote, or None when there is none or it is older than the
    recorded preflight phase (a run that passed preflight before the checklist existed)."""
    document = read_json_or(workspace / PREFLIGHT_CHECKS)
    if not isinstance(document, dict) or not isinstance(document.get("checks"), list):
        return None
    written, passed = seconds_since(document.get("at")), seconds_since(phase.get("updatedAt"))
    if phase.get("status") == "complete" and written is not None and passed is not None and written > passed:
        return None
    return [check for check in document["checks"] if isinstance(check, dict)]


CHECK_MARKS = {"done": "✓", "checking": "▸", "needs-you": "!", "failed": "✗", "waiting": "·"}


def recap_is_current(workspace: Path, project: dict) -> bool:
    """The benchmark folder belongs to this build: its scorecard names the build's creation, or,
    from a scorer before that stamp, the build has recorded its benchmark as complete. A folder
    initialised again keeps the old benchmark/ until it is scored, and that must not read as done."""
    card = read_json_or(workspace / "benchmark" / "scorecard.json") or {}
    stamp = (card.get("run") or {}).get("buildCreatedAt") if isinstance(card, dict) else None
    if isinstance(stamp, str):
        return stamp == project.get("createdAt")
    return ((project.get("phases") or {}).get("benchmark") or {}).get("status") == "complete"


def render_watch(summary: dict) -> str:
    if not summary.get("found"):
        return f"No design-lab run in {summary['workspace']}: it has no project.json."
    marks = {"complete": "✓", "approved": "✓", "waived": "✓", "running": "▸", "stopped": "!"}
    lines = [f"design-lab · {summary.get('siteLabel') or Path(summary['workspace']).name}", ""]
    if summary.get("preflightChecks"):
        lines.append("  Preflight")
        for check in summary["preflightChecks"]:
            line = f"    {CHECK_MARKS.get(check.get('status'), '·')} {check.get('label') or check.get('id')}"
            if check.get("message") and check.get("status") in ("checking", "needs-you", "failed"):
                line += f": {check['message']}"
            lines.append(line)
        lines.append("")
    # One current phase: the one running, or else the next one due.
    running = any(phase["status"] == "running" for phase in summary["phases"])
    for phase in summary["phases"]:
        mark = "▸" if not running and phase["name"] == summary["nextPhase"] and phase["status"] not in marks else \
            marks.get(phase["status"], "·")
        lines.append(f"  {mark} {phase['name']}")
    runner = summary.get("runner")
    if runner:
        lines.append("")
        if runner["state"] in ("building", "done") and runner["stepsTotal"]:
            kind = f", {runner['stepKind']}" if runner["state"] == "building" and runner["stepKind"] else ""
            lines.append(f"  steps {runner['stepsDone'] or 0}/{runner['stepsTotal']}{kind}")
        elif runner.get("message"):
            lines.append(f"  {runner['message']}")
        if not runner["serverAlive"]:
            lines.append("  runner server not responding")
        elif runner["connected"]:
            lines.append("  runner connected")
        else:
            minutes = max(1, round((runner["lastSeenSeconds"] or 0) / 60))
            lines.append(f"  runner not seen for {minutes}m")
    if summary.get("blocker"):
        lines += ["", f"  Needs you: {summary['blocker']}"]
    if summary.get("recap"):
        lines += ["", f"  Recap: {summary['recap']}"]
    return "\n".join(lines)


def active_run() -> Path | None:
    """The run the active-run pointer names, if any."""
    import figma_runner
    pointer = read_json_or(figma_runner.HOME / ACTIVE_RUN) or {}
    return Path(pointer["workspace"]) if isinstance(pointer.get("workspace"), str) else None


def watch_command(args):
    workspace = Path(args.project) if args.project else active_run()
    if workspace is None:
        raise ValueError("no design-lab run is active; give the run folder with --project")
    print(render_watch(watch_summary(workspace)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    command = sub.add_parser("init")
    command.add_argument("--repo", required=True)
    command.add_argument("--workspace", default=".design-lab")
    command.add_argument("--force", action="store_true")
    command.add_argument("--site-label", help="neutral name for the site, shown in reports")
    command.add_argument("--site-url", help="local site address the run captures from")
    command.add_argument("--operator", help="person running the build (default: git user.name)")
    command.add_argument("--model", help="Claude model driving the run, if known")
    command.set_defaults(func=init_command)

    command = sub.add_parser("identity", help="fill in or correct the run identity")
    command.add_argument("--project", default=".design-lab")
    command.add_argument("--site-label")
    command.add_argument("--site-url")
    command.add_argument("--operator")
    command.add_argument("--model")
    command.add_argument("--no-schema-change", action="store_true",
                         help="record that the run needed no schema change or workaround")
    command.add_argument("--schema-change", action="append", metavar="WHAT",
                         help="record a schema change or workaround the run needed (repeatable)")
    command.set_defaults(func=identity_command)


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
    command.add_argument("--base-url", help="verify rendered SDC markers on public aliases")
    command.add_argument("--without-twig-debug", action="store_true",
                         help="accept a site whose Twig debug is off")
    command.add_argument("--high", type=int, default=50)
    command.add_argument("--medium", type=int, default=10)
    command.set_defaults(func=usage_command)

    command = sub.add_parser("plan")
    command.add_argument("--project", default=".design-lab")
    command.set_defaults(func=plan_command)

    command = sub.add_parser("variables")
    command.add_argument("--project", default=".design-lab")
    command.set_defaults(func=variables_command)

    command = sub.add_parser("preflight", help="gather every answer up front and give the go-ahead")
    command.add_argument("--project", default=".design-lab")
    command.add_argument("--site-url", help="local site address the run captures from")
    command.add_argument("--public-url", help="the site's public address, for provenance and captions")
    command.add_argument("--figma-url", help="the empty target Figma file")
    command.add_argument("--runner-timeout", type=float, default=300,
                         help="seconds to wait for the runner in Figma desktop to connect (default 300)")
    command.add_argument("--site-label")
    command.add_argument("--operator")
    command.add_argument("--model")
    command.add_argument("--ddev-root", help="DDEV project root for the usage source (default: repository)")
    command.add_argument("--plan-approval", choices=("proposed", "review"), default="proposed",
                         help="build the plan as proposed (default, unattended) or stop for review")
    command.add_argument("--usage-fallback", choices=("stop", "untiered"), default="stop",
                         help="if the detected usage source cannot be used: stop, or build untiered")
    command.set_defaults(func=preflight_command)

    command = sub.add_parser("runner", help="whether the runner server is alive; --ensure restarts it")
    command.add_argument("--project", default=".design-lab")
    command.add_argument("--ensure", action="store_true", help="start it again if it is not alive")
    command.add_argument("--await-runner", action="store_true",
                         help="stop the run when the runner has not asked for a step for --minutes")
    command.add_argument("--minutes", type=float, default=RUNNER_ABSENT_MINUTES)
    command.set_defaults(func=runner_command)

    command = sub.add_parser("approve")
    command.add_argument("--project", default=".design-lab")
    command.add_argument("--by")
    command.add_argument("--from-preflight", action="store_true",
                         help="approve as the person chose at preflight")
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
                         choices=("usage", "capture", "foundation", "components", "index", "verify",
                                  "benchmark"))
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

    command = sub.add_parser("watch", help="where the run is, as text: phases, steps, runner, blocker, recap")
    command.add_argument("--project", help="the run folder (default: the active run)")
    command.set_defaults(func=watch_command)

    args = parser.parse_args()
    try:
        args.func(args)
    except (OSError, ValueError, KeyError, RuntimeError, json.JSONDecodeError) as error:
        parser.exit(2, f"error: {error}\n")


if __name__ == "__main__":
    main()
