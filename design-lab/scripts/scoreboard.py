#!/usr/bin/env python3
"""Record evaluation metrics in the person's configured ledger."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path

from artifact_contracts import now
from corpus import identity
from lab_config import load_config, site_path
import run_metrics
import scoreboard_render


def record(run: Path, tier: int, site: str | None = None) -> dict:
    if tier not in (2, 3):
        raise ValueError("scoreboard tier must be 2 or 3")
    run = run.resolve()
    project = json.loads((run / "project.json").read_text())
    manifest = run_metrics.read_json(run / "corpus.json") or {}
    label = site or manifest.get("label") or (project.get("run") or {}).get("siteLabel")
    if not label:
        raise ValueError("missing site label; pass --site <neutral-label>")
    site_path(label)
    row = {"timestamp": now(), **identity(project), "site": label, "tier": tier,
           **run_metrics.metrics(run)}
    ledger = Path(load_config()["scoreboard"]["ledger"])
    ledger.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(row, ensure_ascii=False) + "\n").encode()
    fd = os.open(ledger, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "ab") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    render()
    return row


def render() -> Path:
    """Redraw the dashboard from the whole ledger; every record leaves it current."""
    config = load_config()["scoreboard"]
    ledger, dashboard = Path(config["ledger"]), Path(config["dashboard"])
    rows = scoreboard_render.load_rows(ledger) if ledger.exists() else []
    dashboard.parent.mkdir(parents=True, exist_ok=True)
    dashboard.write_text(scoreboard_render.render(rows), encoding="utf-8")
    return dashboard


def show(path: Path) -> None:
    """Put a page on the person's screen; a machine without a desktop opener just skips it."""
    for opener in (["open"], ["xdg-open"]):
        try:
            subprocess.run([*opener, str(path)], check=False, capture_output=True)
            return
        except FileNotFoundError:
            continue


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    command = sub.add_parser("record")
    command.add_argument("--run", required=True, type=Path)
    command.add_argument("--tier", required=True, type=int, choices=(2, 3))
    command.add_argument("--site")
    command.add_argument("--open", action="store_true", help="show the dashboard when recorded")
    sub.add_parser("rows")
    command = sub.add_parser("render")
    command.add_argument("--open", action="store_true", help="show the dashboard when drawn")
    args = parser.parse_args(argv)
    try:
        if args.command == "record":
            print(json.dumps(record(args.run, args.tier, args.site)))
            if args.open:
                show(Path(load_config()["scoreboard"]["dashboard"]))
        elif args.command == "render":
            dashboard = render()
            print(dashboard)
            if args.open:
                show(dashboard)
        else:
            ledger = Path(load_config()["scoreboard"]["ledger"])
            if ledger.exists():
                print(ledger.read_text(), end="")
    except (OSError, ValueError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
