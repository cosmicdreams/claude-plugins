#!/usr/bin/env python3
"""Merge the runner's read-only verification dumps (W/figma/verify/) into state.json for verify.py."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

LISTS = ("components", "cards", "breakpointFrames", "exampleInvalidNodes")


def merge(folder: Path) -> dict:
    state = json.loads((folder / "root.json").read_text())
    plan = folder.parent.parent / "variable-plan.json"
    reason = ((json.loads(plan.read_text()).get("collectionStrategy") or {}).get("reason")
              if plan.is_file() else None)
    if reason and len(state.get("collections") or []) > 1:
        # The responsive masters' collection is the one boundary the plan does not create.
        state["collectionStrategyReason"] = (
            reason + "; the breakpoint collection holds the Desktop, Tablet and Mobile modes "
            "the responsive masters switch between, a mode boundary the single-mode "
            "foundation collection does not have")
    project = folder.parent.parent / "project.json"
    if project.is_file() and not state.get("brand"):
        # library-standard 6.1: collections carry the brand; the run's site label is it.
        state["brand"] = ((json.loads(project.read_text()).get("run") or {}).get("siteLabel") or "").strip() or None
    for key in LISTS:
        state.setdefault(key, [])
    children = {}
    for path in sorted(folder.glob("page-*.json")):
        dump = json.loads(path.read_text())
        for key in LISTS:
            state[key].extend(dump.get(key) or [])
        if dump.get("breakpointCollection") and not state.get("breakpointCollection"):
            state["breakpointCollection"] = dump["breakpointCollection"]
        page = dump.get("page") or {}
        children[page.get("id")] = page.get("children")
    for page in state.get("pages") or []:
        if page.get("id") in children:
            page["children"] = children[page["id"]]
    started = folder / "getting-started.json"
    if started.is_file():
        state.update(json.loads(started.read_text()))
    return state


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    args = parser.parse_args()
    folder = Path(args.project).resolve() / "figma" / "verify"
    out = folder / "state.json"
    out.write_text(json.dumps(merge(folder), indent=1) + "\n")
    print(json.dumps({"state": str(out)}))


if __name__ == "__main__":
    main()
