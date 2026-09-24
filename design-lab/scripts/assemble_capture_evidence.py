#!/usr/bin/env python3
"""Turn capture.mjs output into the visual-evidence artifact used by planning.

Only components with a successful default-state image become eligible for a visual build.
Failures remain explicit problems instead of being converted into speculative assets.
"""
import argparse
import datetime
import json
from pathlib import Path

from artifact_contracts import sha256, tool_version, validate, write_json


STANDARD_VERSION = "3.0.0"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("capture_index")
    parser.add_argument("--out", required=True)
    parser.add_argument("--canonical-base-url", required=True)
    args = parser.parse_args()

    index_path = Path(args.capture_index).resolve()
    rows = json.loads(index_path.read_text(encoding="utf-8"))
    captures: dict[str, dict] = {}
    problems: list[dict] = []

    for row in rows:
        component_id = row.get("componentId") or row.get("machine") or row.get("config")
        if row.get("error"):
            problems.append({"componentId": component_id, "detail": row["error"]})
            continue
        image_path = index_path.parent / row["file"]
        if not image_path.is_file() or image_path.stat().st_size == 0:
            problems.append({"componentId": component_id,
                             "detail": f"capture file missing or empty: {row['file']}"})
            continue
        entry = captures.setdefault(component_id, {
            "path": row.get("path"),
            "verificationUrl": row.get("verificationUrl"),
            "linkUrl": row.get("linkUrl"),
            "selector": row.get("selector"),
            "states": [],
            "images": [],
        })
        state = row.get("state") or "default"
        if state not in entry["states"]:
            entry["states"].append(state)
        entry["images"].append({
            "file": str(image_path),
            "hash": sha256(image_path),
            "viewport": row.get("viewport"),
            "state": state,
            "width": row.get("width"),
            "height": row.get("height"),
        })

    for component_id, entry in list(captures.items()):
        if "default" not in entry["states"]:
            problems.append({"componentId": component_id,
                             "detail": "no successful default-state capture"})
            del captures[component_id]

    document = {
        "standardVersion": STANDARD_VERSION,
        "toolVersion": tool_version(),
        "generatedAt": datetime.datetime.now(datetime.timezone.utc)
                               .replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "canonicalBaseUrl": args.canonical_base_url.rstrip("/"),
        "captures": captures,
        "problems": problems,
    }
    errors = validate(document, "capture-evidence")
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    write_json(args.out, document)
    print(f"{len(captures)} component(s) have buildable visual evidence; "
          f"{len(problems)} problem(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
