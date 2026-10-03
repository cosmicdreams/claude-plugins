#!/usr/bin/env python3
"""Rebuild a frozen site in its scratch Figma file, verify it and write a scorecard."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import corpus
import figma_runner
import run_metrics
from artifact_contracts import now, write_json
from lab_config import site_path
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


def prepare(site: Path, key: str) -> Path:
    """Copy and retarget evidence only inside a new replay workspace."""
    manifest = json.loads((site / "corpus.json").read_text())
    source_project = json.loads((site / "project.json").read_text())
    if key == (source_project.get("target") or {}).get("figmaFileKey"):
        raise ValueError("scratch file key must differ from the frozen run's original Figma file")
    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    workspace = site / "replays" / timestamp
    workspace.parent.mkdir(exist_ok=True)
    corpus.copy_run(site, workspace, replay=True)
    roots = [str(site.resolve()), manifest["sourceRun"]]
    for path in workspace.rglob("*.json"):
        write_json(path, relocate(json.loads(path.read_text()), roots, workspace))
    # Saved results identify the original Figma file. Only the frozen inputs are replayed.
    for name in ("benchmark", "builds"):
        if (workspace / name).exists():
            shutil.rmtree(workspace / name)
    for path in (workspace / "figma").iterdir():
        if path.name == "images":
            continue
        shutil.rmtree(path) if path.is_dir() else path.unlink()
    for name in ("phase-log.jsonl", "verify-report.json"):
        (workspace / name).unlink(missing_ok=True)
    project = json.loads((workspace / "project.json").read_text())
    version = json.loads((HERE.parent / ".claude-plugin/plugin.json").read_text())["version"]
    commit = subprocess.run(["git", "-C", str(HERE.parent), "rev-parse", "HEAD"], capture_output=True, text=True)
    project["pluginVersion"] = version
    project["createdAt"] = now()
    project["target"] = {"figmaFileKey": key, "figmaUrl": f"https://www.figma.com/design/{key}"}
    project["run"] = {"startedAt": now(), "siteLabel": manifest["label"],
                      "evaluationTier": 2, "plugin": {"version": version, "commit": commit.stdout.strip() or None}}
    project["phases"] = {}
    project["artifacts"] = {k: v for k, v in project.get("artifacts", {}).items()
                            if v.get("kind") not in ("build-record", "foundation", "index", "verify-report")}
    write_json(workspace / "project.json", project)
    write_json(workspace / "corpus.json", manifest)
    # This scratch state names the authorized file before init plans its clearing step.
    write_json(workspace / "figma/state.json", {"fileKey": key})
    return workspace


def wait_for_build(workspace: Path, timeout: float, poll: float = 2) -> None:
    deadline = time.monotonic() + timeout
    build = figma_runner.Build(workspace)
    last = None
    while time.monotonic() < deadline:
        status = json.loads(command("figma_build.py", "status", "--project", workspace).stdout)
        progress = (status["done"], status["total"], status["next"])
        if progress != last:
            print(f"{workspace.name}: {status['done']}/{status['total']}; next {status['next']}", file=sys.stderr, flush=True)
            last = progress
        if status["next"] is None and build.dump_step() is None:
            return
        log = workspace / "figma/runner.log"
        if log.is_file():
            errors = [line for line in log.read_text().splitlines() if " error:" in line]
            if errors:
                raise RuntimeError(f"runner stopped: {errors[-1]}; workspace: {workspace}")
        time.sleep(min(poll, max(0, deadline - time.monotonic())))
    raise RuntimeError(f"replay timed out after {timeout:g}s; see {workspace / 'figma/runner.log'}")


def evaluate(workspace: Path) -> dict:
    command("figma_build.py", "receipts", "--project", workspace)
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
    # The corrected results accompany verification; its original capture gate stays unchanged.
    accuracy = run_metrics.score_accuracy(workspace)
    write_json(workspace / "figma/compare/corrected.json", accuracy)
    result = command("verify.py", *args, allowed=(0, 1))
    if not (workspace / "verify-report.json").is_file():
        raise RuntimeError(f"verify did not write a report: {result.stderr}")
    project.setdefault("artifacts", {})["verifyReport"] = {"kind": "verify-report", "path": "verify-report.json"}
    project.setdefault("phases", {})["verify"] = {"status": "complete", "updatedAt": now()}
    write_json(workspace / "project.json", project)
    command("score_run.py", workspace, "--out", workspace / "benchmark")
    return {"workspace": str(workspace), "scorecard": str(workspace / "benchmark/scorecard.json"),
            "verifyReport": str(workspace / "verify-report.json"), "verifyExit": result.returncode}


def replay(site: Path, key: str, timeout: float) -> dict:
    workspace = prepare(site, key)
    old_state = json.loads((site / "figma/state.json").read_text()) if (site / "figma/state.json").is_file() else {}
    capture = json.loads((workspace / "capture-evidence.json").read_text())
    site_url = old_state.get("siteUrl") or capture.get("canonicalBaseUrl")
    canonical = old_state.get("canonicalBaseUrl") or capture.get("canonicalBaseUrl")
    if not site_url or not canonical:
        raise ValueError(f"{site}: missing saved siteUrl or canonicalBaseUrl")
    print(f"replay workspace: {workspace}", file=sys.stderr, flush=True)
    command("figma_build.py", "init", "--project", workspace, "--file-key", key,
            "--site-url", site_url, "--canonical-base-url", canonical, "--rebuild", "--offline-images", "--iterate")
    command("workflow.py", "runner", "--project", workspace, "--ensure")
    wait_for_build(workspace, timeout)
    return evaluate(workspace)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--site")
    group.add_argument("--all", action="store_true")
    parser.add_argument("--file-key", help="scratch Figma file key for --site")
    parser.add_argument("--timeout", type=float, default=1800, help="build and dump wait in seconds per site")
    args = parser.parse_args(argv)
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    if args.all and args.file_key:
        parser.error("--all reads scratchFileKey from each corpus.json")
    try:
        sites = corpus.sites() if args.all else [site_path(args.site)]
        if not sites:
            raise ValueError("no frozen corpus sites found")
        targets = []
        for site in sites:
            manifest = json.loads((site / "corpus.json").read_text())
            key = args.file_key or manifest.get("scratchFileKey")
            if not key:
                raise ValueError(f"{site / 'corpus.json'}: missing scratchFileKey; for --site pass --file-key")
            targets.append((site, key))
        for site, key in targets:
            print(json.dumps(replay(site, key, args.timeout), indent=2), flush=True)
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
