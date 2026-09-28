#!/usr/bin/env python3
"""Compare two or more builds of the same Figma library.

Repeatability score = 100 * (artifact-normalized-exact ratio + page-order exactness
+ node-presence ratio + the eight category-exact ratios) / 11. Each category ratio uses the union of
node paths as denominator, so missing nodes count as differences in every
category. Empty matching page trees score 100; an unmatched page scores zero
for its node terms. Scores are rounded to two decimal places.
"""

import argparse
import hashlib
import itertools
import json
from pathlib import Path

from determinism import normalize


ARTIFACTS = ("components.json", "tokens.json", "plan.json", "variable-plan.json",
             "capture-evidence.json", "figma/results/variables.json")
CATEGORIES = {
    "geometry": ("x", "y", "width", "height"),
    "layout": ("layoutMode", "paddingTop", "paddingRight", "paddingBottom",
               "paddingLeft", "itemSpacing", "layoutSizingHorizontal", "layoutSizingVertical"),
    "style": ("fills", "strokes", "cornerRadius"),
    "text": ("characters",),
    "typography": ("fontName", "fontSize", "lineHeight", "textStyle"),
    "bindings": ("boundVariables", "fills.boundVariables", "strokes.boundVariables"),
    "properties/variants": ("componentPropertyDefinitions", "variantProperties"),
    "docs": ("description", "documentationLinks"),
}


def read_json(path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def differences(left, right, prefix=""):
    """Return all normalized JSON leaf changes with JSON-pointer-like paths."""
    if isinstance(left, dict) and isinstance(right, dict):
        result = []
        for key in sorted(left.keys() | right.keys()):
            path = prefix + "/" + str(key).replace("~", "~0").replace("/", "~1")
            if key not in left or key not in right:
                result.append({"path": path, "a": left.get(key), "b": right.get(key)})
            else:
                result.extend(differences(left[key], right[key], path))
        return result
    if isinstance(left, list) and isinstance(right, list):
        result = []
        for index in range(max(len(left), len(right))):
            path = prefix + "/" + str(index)
            if index >= len(left) or index >= len(right):
                result.append({"path": path, "a": left[index] if index < len(left) else None,
                               "b": right[index] if index < len(right) else None})
            else:
                result.extend(differences(left[index], right[index], path))
        return result
    return [] if left == right and type(left) is type(right) else [
        {"path": prefix or "/", "a": left, "b": right}]


def artifact_diff(a, b, name):
    paths = [root / name for root in (a, b)]
    exists = [path.is_file() for path in paths]
    result = {"present": exists, "equal_bytes": False, "sha256": [None, None],
              "normalized_equal": False, "differences": []}
    for index, path in enumerate(paths):
        if exists[index]:
            result["sha256"][index] = hashlib.sha256(path.read_bytes()).hexdigest()
    if all(exists):
        result["equal_bytes"] = result["sha256"][0] == result["sha256"][1]
        if result["equal_bytes"]:
            result["normalized_equal"] = True
        else:
            left, right = [normalize(read_json(path)) for path in paths]
            result["differences"] = differences(left, right)
            result["normalized_equal"] = not result["differences"]
    elif any(exists):
        result["differences"] = [{"path": "/", "a": "present" if exists[0] else "missing",
                                  "b": "present" if exists[1] else "missing"}]
    else:
        result["normalized_equal"] = True
    return result


def pages(root):
    """Page dumps written by figma_runner.py after a build, one file per page."""
    folder = root / "figma" / "dump"
    result = {}
    for path in sorted(folder.glob("*.json")):
        dump = read_json(path)
        name = dump.get("page", path.stem)
        if name in result:
            raise ValueError(f"duplicate page name {name!r} in {folder}")
        nodes = dump.get("nodes", [])
        keys = [node["path"] for node in nodes]
        if len(keys) != len(set(keys)):
            raise ValueError(f"duplicate node paths in {path}")
        result[name] = {"index": dump.get("pageIndex"), "nodes": {n["path"]: n for n in nodes}}
    return result


def category_values(node, category):
    fields = CATEGORIES[category]
    if category == "style":
        return {key: [{k: v for k, v in paint.items() if k != "boundVariables"}
                      for paint in node.get(key, [])] if key in ("fills", "strokes")
                else node.get(key) for key in fields}
    if category == "bindings":
        return {"boundVariables": node.get("boundVariables"),
                "fills": [paint.get("boundVariables") for paint in node.get("fills", [])],
                "strokes": [paint.get("boundVariables") for paint in node.get("strokes", [])]}
    return {key: node.get(key) for key in fields}


def compare(a, b):
    a, b = Path(a), Path(b)
    for root in (a, b):
        if not root.is_dir() or not (root / "figma").is_dir():
            raise ValueError(f"run directory and figma/ folder required: {root}")
    artifacts = {name: artifact_diff(a, b, name) for name in ARTIFACTS}
    artifact_ratio = sum(item["normalized_equal"] for item in artifacts.values()) / len(artifacts)
    pa, pb = pages(a), pages(b)
    def ordered(page_map):
        return sorted(page_map, key=lambda name: (page_map[name]["index"] is None,
                                                   page_map[name]["index"] if page_map[name]["index"] is not None else 0,
                                                   name))
    order_a, order_b = ordered(pa), ordered(pb)
    page_reports = {}
    counts = {category: 0 for category in CATEGORIES}
    matched_count = identical_count = 0
    exact = {category: 0 for category in CATEGORIES}
    total = 0
    for name in sorted(pa.keys() | pb.keys()):
        na = pa.get(name, {}).get("nodes", {})
        nb = pb.get(name, {}).get("nodes", {})
        added, removed = sorted(nb.keys() - na.keys()), sorted(na.keys() - nb.keys())
        matched = sorted(na.keys() & nb.keys())
        total += len(na.keys() | nb.keys())
        matched_count += len(matched)
        changes = {}
        for path in matched:
            node_changes = {}
            for category in CATEGORIES:
                delta = differences(category_values(na[path], category),
                                    category_values(nb[path], category))
                if delta:
                    node_changes[category] = delta
                    counts[category] += 1
                else:
                    exact[category] += 1
            covered = set().union(*(set(keys) for keys in CATEGORIES.values()))
            other = differences({k: v for k, v in na[path].items() if k not in covered and k != "path"},
                                {k: v for k, v in nb[path].items() if k not in covered and k != "path"})
            if other:
                node_changes["other"] = other
                counts["other"] = counts.get("other", 0) + 1
            if node_changes:
                changes[path] = node_changes
            else:
                identical_count += 1
        page_reports[name] = {"added": added, "removed": removed, "changes": changes}
    denominator = total or 1
    page_exact = order_a == order_b
    ratios = {"identical_node": identical_count / denominator,
              "geometry_exact": exact["geometry"] / denominator,
              "text_exact": exact["text"] / denominator,
              "binding_exact": exact["bindings"] / denominator}
    score = 100 * (artifact_ratio + int(page_exact) + matched_count / denominator +
                   sum(exact.values()) / denominator) / 11
    if total == 0 and page_exact:
        score = 100 * (artifact_ratio + 10) / 11
        ratios = dict.fromkeys(ratios, 1.0)
    return {"runs": [str(a), str(b)], "artifacts": artifacts,
            "pages": {"a": order_a, "b": order_b, "order_equal": page_exact,
                      "added": sorted(pb.keys() - pa.keys()), "removed": sorted(pa.keys() - pb.keys())},
            "page_differences": page_reports,
            "summary": {"score": round(score, 2), "artifact_exact_ratio": round(artifact_ratio, 4), "total_nodes": total,
                        "matched_nodes": matched_count, "identical_nodes": identical_count,
                        "ratios": {key: round(value, 4) for key, value in ratios.items()},
                        "category_counts": counts}}


def render_pair(report):
    a, b = report["runs"]
    summary = report["summary"]
    lines = [f"## {a} ↔ {b}", "", f"Repeatability: **{summary['score']}/100**",
             f"Nodes: {summary['identical_nodes']} identical / {summary['total_nodes']} total; "
             f"{summary['matched_nodes']} matched", "", "### Artifacts", ""]
    for name, item in report["artifacts"].items():
        status = "absent in both" if item["present"] == [False, False] else (
            "byte equal" if item["equal_bytes"] else
            "normalized equal" if item["normalized_equal"] else
            f"{len(item['differences'])} difference(s)")
        lines.append(f"- `{name}`: {status} (SHA-256: {item['sha256'][0]}, {item['sha256'][1]})")
        for change in item["differences"]:
            lines.append(f"  - `{change['path']}`: {json.dumps(change['a'], ensure_ascii=False)} → "
                         f"{json.dumps(change['b'], ensure_ascii=False)}")
    p = report["pages"]
    lines += ["", "### Pages", "", f"A: {', '.join(p['a']) or '(none)'}",
              f"B: {', '.join(p['b']) or '(none)'}", ""]
    for name, item in report["page_differences"].items():
        lines.append(f"#### {name}")
        lines.append("")
        lines.append(f"Added: {', '.join(item['added']) or 'none'}; removed: {', '.join(item['removed']) or 'none'}")
        for path, categories in item["changes"].items():
            lines.append(f"- `{path}`")
            for category, changes in categories.items():
                for change in changes:
                    lines.append(f"  - {category} `{change['path']}`: "
                                 f"{json.dumps(change['a'], ensure_ascii=False)} → "
                                 f"{json.dumps(change['b'], ensure_ascii=False)}")
        lines.append("")
    lines += ["Category counts: " + ", ".join(f"{key} {value}" for key, value in summary["category_counts"].items()),
              "Ratios: " + ", ".join(f"{key} {value:.4f}" for key, value in summary["ratios"].items()), ""]
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runs", nargs="+", help="at least two run directories")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--md", type=Path)
    args = parser.parse_args(argv)
    if len(args.runs) < 2:
        parser.error("at least two run directories are required")
    try:
        pairs = [compare(a, b) for a, b in itertools.combinations(args.runs, 2)]
    except (OSError, ValueError, KeyError) as error:
        parser.error(str(error))
    matrix = {a: {b: 100.0 if a == b else next(pair["summary"]["score"]
               for pair in pairs if set(pair["runs"]) == {a, b}) for b in args.runs}
              for a in args.runs}
    report = {"comparisons": pairs, "summary_matrix": matrix}
    markdown = "# Repeatability across runs\n\n" + "\n".join(render_pair(pair) for pair in pairs)
    markdown += "\n## Summary matrix\n\n| Run | " + " | ".join(args.runs) + " |\n"
    markdown += "|---|" + "---:|" * len(args.runs) + "\n"
    for a in args.runs:
        markdown += "| " + a + " | " + " | ".join(f"{matrix[a][b]:.2f}" for b in args.runs) + " |\n"
    if args.out:
        args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if args.md:
        args.md.write_text(markdown, encoding="utf-8")
    if not args.out and not args.md:
        print(markdown, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
