#!/usr/bin/env python3
"""Rebuild a frozen site in its scratch Figma file, verify it and write a scorecard."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import corpus
import rebuild
from rebuild import command, evaluate, wait_for_build
from artifact_contracts import write_json
from lab_config import site_path


def prepare(site: Path, key: str) -> Path:
    """Copy and retarget evidence only inside a new replay workspace."""
    manifest = json.loads((site / "corpus.json").read_text())
    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    workspace = site / "replays" / timestamp
    rebuild.prepare(site, workspace, key, f"https://www.figma.com/design/{key}")
    write_json(workspace / "corpus.json", manifest)
    return workspace


def replay(site: Path, key: str, timeout: float) -> dict:
    workspace = prepare(site, key)
    site_url, canonical = rebuild.site_urls(site)
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
