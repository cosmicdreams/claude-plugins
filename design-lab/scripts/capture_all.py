#!/usr/bin/env python3
"""Scaffold, measure, capture, assemble, and register visual evidence in one run."""

import argparse
import json
import subprocess
import sys
from pathlib import Path

from artifact_contracts import write_json


SCRIPTS = Path(__file__).resolve().parent
NO_EVIDENCE = "Not built — no visual evidence"


def run(command, cwd=None):
    return subprocess.run(command, cwd=cwd, text=True, capture_output=True)


def check(result, label):
    if result.returncode:
        raise RuntimeError(f"{label} failed: {(result.stderr or result.stdout).strip()}")


def globally_excluded(component):
    usage = component.get("usage") or {}
    return bool(component.get("globallyExcluded") or usage.get("globallyExcluded")
                or component.get("excluded") or usage.get("excluded"))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--site-url", required=True)
    parser.add_argument("--canonical-base-url", required=True)
    parser.add_argument("--theme-root", required=True, type=Path)
    parser.add_argument("--node-cwd", required=True, type=Path)
    parser.add_argument("--scale", type=float, default=1)
    args = parser.parse_args(argv)
    workspace = args.project.resolve()
    components_path = workspace / "components.json"
    components = json.loads(components_path.read_text(encoding="utf-8"))["components"]
    capture_dir = workspace / "capture"
    configs = capture_dir / "configs"
    measurements = capture_dir / "measurements"
    shots = capture_dir / "shots"
    for directory in (configs, measurements, shots):
        directory.mkdir(parents=True, exist_ok=True)
    # Generated outputs from a previous run must never appear in this run's evidence.
    for directory, pattern in ((configs, "*.json"), (measurements, "*.spec.json"),
                               (shots, "*.png"), (shots, "index.json")):
        for stale in directory.glob(pattern):
            stale.unlink()

    scaffold = run([sys.executable, str(SCRIPTS / "scaffold_configs.py"),
                    str(components_path), "--out", str(configs), "--force",
                    "--site-url", args.site_url, "--canonical-base-url",
                    args.canonical_base_url, "--theme-root", str(args.theme_root)])
    check(scaffold, "scaffold")

    by_id = {c["id"]: c for c in components}
    eligible = {cid for cid, c in by_id.items() if not globally_excluded(c)}
    problems = []
    config_paths = []
    for path in sorted(configs.glob("*.json")):
        cfg = json.loads(path.read_text(encoding="utf-8"))
        cid = cfg["componentId"]
        if cid not in eligible:
            path.unlink()
        elif not cfg.get("path") or not cfg.get("verificationUrl"):
            problems.append({"componentId": cid, "detail": NO_EVIDENCE})
            path.unlink()
        elif not cfg.get("rootSelector"):
            problems.append({"componentId": cid, "detail": "no root selector"})
            path.unlink()
        else:
            config_paths.append(path)

    measured = 0
    for path in config_paths:
        cfg = json.loads(path.read_text(encoding="utf-8"))
        spec_path = measurements / f"{cfg['machineName']}.spec.json"
        # One retry: a local development server under load occasionally times out a page.
        for _attempt in range(2):
            result = run(["node", str(SCRIPTS / "measure.mjs"), "--config", str(path),
                          "--out", str(measurements)], cwd=args.node_cwd)
            if not result.returncode and spec_path.is_file():
                break
        if result.returncode or not spec_path.is_file():
            problems.append({"componentId": cfg["componentId"],
                             "detail": "measurement failed: " +
                             (result.stderr or result.stdout or "spec file missing").strip()[:240]})
            continue
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
        results = spec.get("measurements") or {}
        expected = {f"{viewport}:default" for viewport in ("desktop", "tablet", "mobile")}
        failures = sorted(expected - results.keys())
        failures.extend(key for key, value in results.items()
                        if not isinstance(value, dict) or value.get("error"))
        if failures:
            problems.append({"componentId": cfg["componentId"],
                             "detail": "measurement failed: " + ", ".join(sorted(failures))})
        else:
            measured += 1

    index_path = shots / "index.json"
    if config_paths:
        capture = run(["node", str(SCRIPTS / "capture.mjs"), "--configs", str(configs),
                       "--out", str(shots), "--scale", str(args.scale)], cwd=args.node_cwd)
        if not index_path.is_file():
            detail = (capture.stderr or capture.stdout or "index.json missing").strip()[:240]
            problems.extend({"componentId": json.loads(p.read_text())["componentId"],
                             "detail": "capture failed: " + detail} for p in config_paths)
            write_json(index_path, [])
    else:
        write_json(index_path, [])

    # capture.mjs error rows carry machine but not componentId; fill it for the artifact.
    rows = json.loads(index_path.read_text(encoding="utf-8"))
    machine_ids = {json.loads(p.read_text())["machineName"]:
                   json.loads(p.read_text())["componentId"] for p in config_paths}
    for row in rows:
        if "componentId" not in row and row.get("machine") in machine_ids:
            row["componentId"] = machine_ids[row["machine"]]
    reported = {row.get("componentId") for row in rows}
    for path in config_paths:
        cid = json.loads(path.read_text(encoding="utf-8"))["componentId"]
        if cid not in reported and not any(p["componentId"] == cid for p in problems):
            problems.append({"componentId": cid,
                             "detail": "capture failed: no screenshot or error was reported"})
    write_json(index_path, rows)

    evidence_path = workspace / "capture-evidence.json"
    assembled = run([sys.executable, str(SCRIPTS / "assemble_capture_evidence.py"),
                     str(index_path), "--out", str(evidence_path),
                     "--canonical-base-url", args.canonical_base_url])
    check(assembled, "assemble capture evidence")
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    for cid, entry in evidence["captures"].items():
        observed = {image["viewport"].lower() for image in entry["images"]
                    if image.get("state") == "default" and image.get("viewport")}
        missing = sorted({"desktop", "tablet", "mobile"} - observed)
        if missing:
            problems.append({"componentId": cid,
                             "detail": "default capture missing: " + ", ".join(missing)})
    evidence["problems"].extend(sorted(problems, key=lambda item: item["componentId"]))
    write_json(evidence_path, evidence)
    registered = run([sys.executable, str(SCRIPTS / "workflow.py"), "register",
                      "--project", str(workspace), "--name", "captureEvidence",
                      "--path", str(evidence_path), "--kind", "capture-evidence",
                      "--phase", "capture"])
    check(registered, "register capture evidence")

    print(f"captured: {len(evidence['captures'])}; measured: {measured}; "
          f"failed: {len(evidence['problems'])}")
    for problem in evidence["problems"]:
        print(f"  {problem['componentId']}: {problem['detail']}")
    return 1 if evidence["problems"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
