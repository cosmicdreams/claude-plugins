#!/usr/bin/env python3
"""Prepare captured inputs for another Figma file, wait for the build and score it."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import figma_runner
import run_metrics
from artifact_contracts import now, write_json, register_artifact, sha256, validate
from verify_inputs import build_measurements

HERE = Path(__file__).resolve().parent


def command(script: str, *args, allowed=(0,)) -> subprocess.CompletedProcess:
    result = subprocess.run([sys.executable, str(HERE / script), *map(str, args)],
                            capture_output=True, text=True)
    if result.returncode not in allowed:
        raise RuntimeError(f"{script} exited {result.returncode}: {(result.stderr or result.stdout).strip()}")
    return result


def relocate(value, roots: list[str], target: Path):
    if isinstance(value, str):
        if Path(value).is_absolute():
            for root in roots:
                try:
                    relative = Path(value).resolve().relative_to(Path(root).resolve())
                except ValueError:
                    continue
                return str(target / relative)
        for root in roots:
            if value == root or value.startswith(root.rstrip("/") + "/"):
                return str(target) + value[len(root.rstrip("/")):]
        return value
    if isinstance(value, list):
        return [relocate(item, roots, target) for item in value]
    if isinstance(value, dict):
        return {key: relocate(item, roots, target) for key, item in value.items()}
    return value


def site_urls(source: Path) -> tuple[str, str]:
    """The saved site addresses, usable even when the local site is stopped."""
    state_path = source / "figma/state.json"
    state = json.loads(state_path.read_text()) if state_path.is_file() else {}
    capture = json.loads((source / "capture-evidence.json").read_text())
    site_url = state.get("siteUrl") or capture.get("canonicalBaseUrl")
    canonical = state.get("canonicalBaseUrl") or capture.get("canonicalBaseUrl")
    if not site_url or not canonical:
        raise ValueError(f"{source}: missing saved siteUrl or canonicalBaseUrl")
    return site_url, canonical


def plan_approved(source: Path, project: dict) -> bool:
    """The plan was approved: as the phase says, or as the phase log recorded before a later step
    (a recapture) set the phase back, or because this plan has already been built and scored."""
    phases = project.get("phases") or {}
    if (phases.get("plan") or {}).get("status") in ("approved", "complete"):
        return True
    if (phases.get("benchmark") or {}).get("status") == "complete":
        return True
    log = source / "phase-log.jsonl"
    for line in log.read_text().splitlines() if log.is_file() else ():
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if entry.get("phase") == "plan" and entry.get("status") in ("approved", "complete"):
            return True
    return False


def prepare(source: Path, workspace: Path, key: str, figma_url: str, *,
            identity: dict | None = None, evaluation_tier: int = 2) -> dict:
    """Copy captured inputs to a new workspace and retarget only that copy."""
    source, workspace = source.resolve(), workspace.resolve()
    manifest_path = source / "corpus.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {}
    source_project = json.loads((source / "project.json").read_text())
    if key == (source_project.get("target") or {}).get("figmaFileKey"):
        raise ValueError("scratch file key must differ from the frozen run's original Figma file")
    if identity is not None:
        required = ("components.json", "plan.json", "tokens.json", "capture-evidence.json")
        missing = [name for name in required if not (source / name).is_file()]
        if not (source / "capture/measurements").is_dir():
            missing.append("capture/measurements/")
        if missing:
            raise ValueError(f"{source}: figma-build needs " + ", ".join(missing))
        if not plan_approved(source, source_project):
            raise ValueError(f"{source}: approve the plan before figma-build; the plan phase is not approved or complete")
    site_url, canonical = site_urls(source)
    replay = identity is None and workspace.parent == source / "replays"
    if workspace == source or (source in workspace.parents and not replay):
        raise ValueError("copy destination must be outside the source run")
    if workspace.exists() and (not workspace.is_dir() or any(workspace.iterdir())):
        raise ValueError(f"{workspace}: rebuild workspace must be new or empty")

    def ignore(folder, names):
        relative = Path(folder).relative_to(source)
        skipped = {"replays", "corpus.json"}
        if relative == Path("."):
            # preflight-checks.json proved the earlier file's connection, not this one's.
            skipped.update(("project.json", "benchmark", "builds", "phase-log.jsonl", "verify-report.json",
                            "preflight-checks.json"))
        if relative == Path("figma"):
            skipped.update(name for name in names if name != "images")
        return skipped.intersection(names)

    shutil.copytree(source, workspace, ignore=ignore, dirs_exist_ok=True)
    roots = [str(source)]
    if manifest.get("sourceRun"):
        roots.append(manifest["sourceRun"])
    for path in workspace.rglob("*.json"):
        write_json(path, relocate(json.loads(path.read_text()), roots, workspace))
    project = relocate(source_project, roots, workspace)
    version = json.loads((HERE.parent / ".claude-plugin/plugin.json").read_text())["version"]
    commit = subprocess.run(["git", "-C", str(HERE.parent), "rev-parse", "HEAD"], capture_output=True, text=True)
    project["pluginVersion"] = version
    project["createdAt"] = now()
    project["target"] = {"figmaFileKey": key, "figmaUrl": figma_url}
    rebuilt_from = {"run": str(source), "createdAt": source_project.get("createdAt"),
                    "pluginVersion": source_project.get("pluginVersion"), "corpusLabel": manifest.get("label")}
    label = (manifest.get("label") if identity is None else
             identity.get("siteLabel") or (source_project.get("run") or {}).get("siteLabel") or manifest.get("label"))
    project["run"] = {**(identity if identity is not None else
                       {"startedAt": now(), "plugin": {"version": version, "commit": commit.stdout.strip() or None}}),
                      "siteLabel": label,
                      "evaluationTier": evaluation_tier, "rebuiltFrom": rebuilt_from}
    source_phases = project.get("phases") or {}
    project["phases"] = {}
    if identity is not None:
        project["phases"] = {name: {**phase, "from": str(source)}
                             for name in ("discovery", "inventory", "usage", "capture", "tokens", "plan", "preflight")
                             if (phase := source_phases.get(name))}
        for phase in project["phases"].values():
            if "updatedAt" in phase:
                phase["sourceUpdatedAt"] = phase.pop("updatedAt")
        # The approval this build rests on, even where the earlier run's phase was set back.
        project["phases"]["plan"] = {**project["phases"].get("plan", {}), "status": "approved", "from": str(source)}
        project["phases"].update({name: {"status": "pending"}
                                  for name in ("foundation", "components", "index", "verify")})
    project["artifacts"] = {k: v for k, v in project.get("artifacts", {}).items()
                            if v.get("kind") not in ("build-record", "foundation", "index", "verify-report")}
    # Relocation changes bytes in copied artifacts. Register the copy's bytes, retaining
    # source provenance, so the same completion gate can validate fresh and replayed runs.
    for artifact in project["artifacts"].values():
        target = workspace / artifact.get("path", "")
        if target.is_file():
            errors = validate(json.loads(target.read_text()), artifact.get("kind"), str(target))
            artifact.update(sha256=sha256(target), valid=not errors, errors=errors)
    write_json(workspace / "figma/state.json", {"fileKey": key})
    # Publishing the manifest makes this run discoverable. All inputs must be ready first.
    write_json(workspace / "project.json", project)
    return {"workspace": str(workspace), "fileKey": key, "figmaUrl": figma_url,
            "siteUrl": site_url, "canonicalBaseUrl": canonical, "rebuiltFrom": rebuilt_from}


def wait_for_build(workspace: Path, timeout: float, poll: float = 2) -> None:
    deadline = time.monotonic() + timeout
    build = figma_runner.Build(workspace)
    log = workspace / "figma/runner.log"
    # A restart retains the log. Only new reports can fail this wait; a recorded step
    # after a report also clears it. The server's progress catches an already latched failure.
    position = log.stat().st_size if log.is_file() else 0
    last = None
    while time.monotonic() < deadline:
        status = json.loads(command("figma_build.py", "status", "--project", workspace).stdout)
        progress = (status["done"], status["total"], status["next"])
        if progress != last:
            print(f"{workspace.name}: {status['done']}/{status['total']}; next {status['next']}", file=sys.stderr, flush=True)
            last = progress
        if status["next"] is None and build.dump_step() is None:
            return
        failure = None
        if log.is_file():
            if log.stat().st_size < position:
                position = 0
            with log.open() as stream:
                stream.seek(position)
                for line in stream:
                    event = line.partition(" ")[2].strip()
                    if event.startswith(("FAILED ", "error:")):
                        failure = line.strip()
                    elif event.startswith(("recorded ", "skipped ")):
                        failure = None
                position = stream.tell()
        try:
            heartbeat = json.loads((workspace / "figma/progress.json").read_text())
        except (OSError, ValueError):
            heartbeat = {}
        # Ignore a heartbeat left by a stopped server when the new PID is already known.
        pid_path = workspace / "figma" / figma_runner.PID_FILE
        pid = pid_path.read_text().strip() if pid_path.is_file() else None
        current = pid is None or str(heartbeat.get("serverPid")) == pid
        if current and (heartbeat.get("state") == "failed" or
                        (heartbeat.get("state") == "waiting" and
                         (heartbeat.get("message") or "").startswith("Stopped at "))):
            failure = heartbeat.get("message") or "the runner reported a failed step"
        if failure:
            raise RuntimeError(f"runner stopped: {failure}; workspace: {workspace}")
        time.sleep(min(poll, max(0, deadline - time.monotonic())))
    raise RuntimeError(f"replay timed out after {timeout:g}s; see {workspace / 'figma/runner.log'}")


def evaluate(workspace: Path, session=None) -> dict:
    receipts = command("figma_build.py", "receipts", "--project", workspace, allowed=(0, 1))
    import workflow
    project_path = workspace / "project.json"
    project = json.loads(project_path.read_text())
    coverage = workflow.component_coverage(project_path, project)
    if coverage["planAvailable"] and not any(coverage[k] for k in ("missing", "unexpected", "invalid")):
        if (project.get("phases", {}).get("components") or {}).get("status") != "complete":
            workflow.set_phase(project_path, project, "components", "complete", coverage)
    command("verify_state.py", "--project", workspace)
    measurements = workspace / "figma/verify/measurements.json"
    write_json(measurements, build_measurements(workspace))
    args = ["--state", workspace / "figma/verify/state.json", "--measurements", measurements,
            "--out", workspace / "verify-report.json", "--json"]
    for flag, name in (("components", "components.json"), ("tokens", "tokens.json"),
                       ("plan", "plan.json"), ("index", "index.json"), ("waivers", "waivers.json"),
                       ("render-evidence", "render-evidence.json"), ("capture-evidence", "capture-evidence.json"),
                       ("shots-dir", "capture/shots"), ("builds", "builds")):
        if (workspace / name).exists():
            args.extend([f"--{flag}", workspace / name])
    project = json.loads((workspace / "project.json").read_text())
    theme = (project.get("repository") or {}).get("root")
    if theme and Path(theme).is_dir():
        args.extend(["--theme-root", theme])
    state = json.loads((workspace / "figma/verify/state.json").read_text())
    if state.get("brand"):
        args.extend(["--brand", state["brand"]])
    # Keep corrected scoring alongside the same metric used by new build receipts.
    accuracy = run_metrics.score_accuracy(workspace)
    write_json(workspace / "figma/compare/corrected.json", accuracy)
    result = command("verify.py", *args, allowed=(0, 1))
    if not (workspace / "verify-report.json").is_file():
        raise RuntimeError(f"verify did not write a report: {result.stderr}")
    project = register_artifact(project_path, "verifyReport", workspace / "verify-report.json", "verify-report")
    # Execution can finish with findings; quality is accepted only by the shared gate.
    project.setdefault("phases", {})["verify"] = {"status": "complete", "updatedAt": now()}
    write_json(project_path, project)
    gate = command("workflow.py", "validate", "--project", workspace, allowed=(0, 1))
    accepted = result.returncode == 0 and receipts.returncode == 0 and gate.returncode == 0
    project = json.loads(project_path.read_text())
    workflow.set_phase(project_path, project, "verify", "complete" if accepted else "failed",
                       {"execution": "finished", "quality": "passed" if accepted else "failed",
                        "verifyExit": result.returncode, "receiptsExit": receipts.returncode,
                        "gateExit": gate.returncode, "gate": gate.stdout.strip()})
    score_args = [workspace, "--out", workspace / "benchmark"]
    if session is not None or (project.get("run") or {}).get("claude") is not None:
        command("workflow.py", "record", "--project", workspace, "--phase", "benchmark", "--status", "running")
    if session is not None:
        score_args.extend(["--session", *([session] if isinstance(session, str) else session)])
    command("score_run.py", *score_args)
    return {"workspace": str(workspace), "scorecard": str(workspace / "benchmark/scorecard.json"),
            "verifyReport": str(workspace / "verify-report.json"), "verifyExit": result.returncode,
            "quality": "passed" if accepted else "failed", "gateExit": gate.returncode}
