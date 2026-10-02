#!/usr/bin/env python3
"""Replay saved measurements through the current build trees without Figma or network."""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

import corpus
import figma_build
import property_compare
from artifact_contracts import write_json
from lab_config import site_path


def replay(run: Path, label: str | None = None) -> dict:
    run = Path(run).resolve()
    components = figma_build.components(run)
    plan = figma_build.plans(run)
    reports = {}
    with tempfile.TemporaryDirectory(prefix="design-lab-tier1-") as temporary:
        trees = Path(temporary)
        built = figma_build.build_trees(run, trees)
        for component in components:
            if plan.get(component["id"], {}).get("verdict") != "build":
                continue
            path = trees / f"{component['id']}.json"
            spec = figma_build.spec_file_for(run / "capture/measurements", component)
            if not path.is_file() or spec is None:
                reports[component["id"]] = {"status": "unmeasured", "reason": "no usable matching measurement"}
                continue
            reports[component["id"]] = property_compare.compare(json.loads(path.read_text()), json.loads(spec.read_text()))
    totals = {name: {"passed": 0, "total": 0, "unmeasured": 0} for name in
              ("geometry", "fontSize", "textAlignment", "textRunCount", "imagesPresent")}
    widths = 0
    for report in reports.values():
        for width in report.values():
            if not isinstance(width, dict) or width.get("status") != "measured":
                continue
            widths += 1
            for name, values in totals.items():
                for key in values:
                    values[key] += width[name][key]
    label = label or run.name
    summary = (f"{label}: {len(built)}/{len(reports)} components rebuilt; {widths} widths; "
               + "; ".join(f"{name} {v['passed']}/{v['total']} ({v['unmeasured']} unmeasured)" for name, v in totals.items()))
    return {"site": label, "tier": 1, "components": reports, "metrics": totals, "summary": summary}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--site")
    group.add_argument("--all", action="store_true")
    group.add_argument("--run", type=Path, help="read a run directly without freezing it")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    try:
        paths = [args.run] if args.run else corpus.sites() if args.all else [site_path(args.site)]
        if not paths:
            raise ValueError("no frozen corpus sites found")
        result = [replay(p, args.site or p.name) for p in paths]
        if args.out:
            write_json(args.out, result)
        else:
            print(json.dumps(result, indent=2))
        for site in result:
            print(site["summary"], file=sys.stderr)
    except (OSError, ValueError, KeyError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
