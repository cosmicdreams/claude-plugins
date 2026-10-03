#!/usr/bin/env python3
"""Freeze replay artifacts by copying runs into the configured corpus."""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from artifact_contracts import now, sha256, write_json
from lab_config import load_config, site_path


def identity(project: dict) -> dict:
    plugin = (project.get("run") or {}).get("plugin") or {}
    return {"pluginVersion": plugin.get("version") or project.get("pluginVersion"),
            "pluginCommit": plugin.get("commit") or project.get("pluginCommit")}


def copy_run(source: Path, target: Path, replay: bool = False) -> None:
    source, target = source.resolve(), target.resolve()
    if target == source or (source in target.parents and not (replay and target.parent == source / "replays")):
        raise ValueError("copy destination must be outside the source run")
    # Preserve all run evidence, including layouts that older plugin versions wrote.
    shutil.copytree(source, target, ignore=shutil.ignore_patterns("replays", "corpus.json"))


def freeze(run: Path, label: str) -> dict:
    run = run.resolve()
    project = json.loads((run / "project.json").read_text())
    if not (run / "components.json").is_file() or not (run / "capture/measurements").is_dir():
        raise ValueError(f"{run}: freeze needs components.json and capture/measurements")
    target = site_path(label)
    if target.exists():
        raise ValueError(f"corpus site already exists: {target}; use a new label for a refresh")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        copy_run(run, target)
        files = sorted(p for p in target.rglob("*") if p.is_file())
        manifest = {"label": label, "sourceRun": str(run), **identity(project), "frozenAt": now(),
                    "fileCount": len(files), "totalBytes": sum(p.stat().st_size for p in files),
                    "artifacts": {str(p.relative_to(target)): sha256(p) for p in files if p.suffix == ".json"}}
        write_json(target / "corpus.json", manifest)
        return manifest
    except Exception:
        if target.exists():
            shutil.rmtree(target)
        raise


def sites() -> list[Path]:
    root = Path(load_config()["corpus"])
    return sorted(p.parent for p in root.glob("*/corpus.json"))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    command = sub.add_parser("freeze")
    command.add_argument("--run", required=True, type=Path)
    command.add_argument("--label", required=True)
    sub.add_parser("list")
    args = parser.parse_args(argv)
    try:
        result = freeze(args.run, args.label) if args.command == "freeze" else [
            json.loads((p / "corpus.json").read_text()) for p in sites()]
        print(json.dumps(result, indent=2))
    except (OSError, ValueError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
