#!/usr/bin/env python3
"""Compare build-tree properties with saved measurements, without rendering a file.

Geometry describes the tree's fixed sizes and layout arithmetic. Text whose size depends
on font shaping is reported as unmeasured; a Figma dump can supply that geometry later.
"""
from __future__ import annotations

import re

import spec_to_tree

GEOMETRY_TOLERANCE = 2
FONT_TOLERANCE = 0.5


def resolve(value, variables: dict, breakpoint: str):
    if isinstance(value, dict):
        if value.get("var") in variables:
            return variables[value["var"]]["values"][breakpoint.capitalize()]
        return {k: resolve(v, variables, breakpoint) for k, v in value.items()}
    if isinstance(value, list):
        return [resolve(v, variables, breakpoint) for v in value]
    return value


def layout_nodes(tree: dict) -> list[dict]:
    """Evaluate fixed-size flow, wrapping, padding and alignment from the build contract."""
    rows = []

    def walk(node, x, y, width=None, height=None):
        if node.get("visible") is False:
            return
        width = node.get("width") if width is None else width
        height = node.get("height") if height is None else height
        rows.append({"node": node, "box": {"x": x, "y": y, "width": width, "height": height}})
        layout = node.get("layout") or {}
        mode = layout.get("mode", "NONE")
        kids = [c for c in node.get("children", []) if c.get("visible") is not False]
        if mode == "NONE":
            for child in kids:
                walk(child, None if x is None else x + child.get("x", 0),
                     None if y is None else y + child.get("y", 0))
            return
        pad = layout.get("padding") or {}
        left, top = pad.get("left", 0), pad.get("top", 0)
        inner_w = max(0, width - left - pad.get("right", 0)) if width is not None else None
        inner_h = max(0, height - top - pad.get("bottom", 0)) if height is not None else None
        horizontal = mode == "HORIZONTAL"
        primary = inner_w if horizontal else inner_h
        cross = inner_h if horizontal else inner_w
        gap = layout.get("gap", 0)
        flow = [c for c in kids if not c.get("absolute")]
        sizes = []
        for child in flow:
            w, h = child.get("width"), child.get("height")
            if child.get("sizing") == "FILL" and not horizontal:
                w = inner_w
            # Text auto sizing needs a font engine; never substitute the source measurement.
            sizes.append([w, h])
        fills = [i for i, c in enumerate(flow) if horizontal and c.get("sizing") == "FILL"]
        if fills and primary is not None and all(sizes[i][0] is not None for i in range(len(flow)) if i not in fills):
            remaining = primary - gap * max(0, len(flow) - 1) - sum(sizes[i][0] for i in range(len(flow)) if i not in fills)
            for i in fills:
                sizes[i][0] = max(0, remaining / len(fills))
        lines, line = [], []
        used = 0
        for child, size in zip(flow, sizes):
            extent = size[0 if horizontal else 1]
            if layout.get("wrap") and line and primary is not None and extent is not None and used + gap + extent > primary + 0.01:
                lines.append(line)
                line, used = [], 0
            line.append((child, size))
            used += (gap if len(line) > 1 else 0) + (extent or 0)
        if line:
            lines.append(line)
        cross_cursor = 0
        for line in lines:
            extents = [size[0 if horizontal else 1] for _, size in line]
            crosses = [size[1 if horizontal else 0] for _, size in line]
            known = all(v is not None for v in extents)
            occupied = sum(extents) + gap * max(0, len(line) - 1) if known else None
            spare = max(0, primary - occupied) if primary is not None and occupied is not None else None
            align = layout.get("primaryAlign", "MIN")
            cursor = 0 if align == "MIN" else (spare / 2 if align == "CENTER" and spare is not None else spare)
            spacing = spare / (len(line) - 1) if align == "SPACE_BETWEEN" and spare is not None and len(line) > 1 else 0
            line_cross = max(crosses) if all(v is not None for v in crosses) else None
            available_cross = line_cross if layout.get("wrap") else cross
            for child, (w, h) in line:
                extent, across = (w, h) if horizontal else (h, w)
                counter = layout.get("counterAlign", "MIN")
                offset = 0
                if counter != "MIN":
                    free = available_cross - across if available_cross is not None and across is not None else None
                    offset = free / 2 if counter == "CENTER" and free is not None else free
                px, py = (cursor, cross_cursor + offset if offset is not None and cross_cursor is not None else None) if horizontal else (offset, cursor)
                walk(child, x + left + px if x is not None and px is not None else None,
                     y + top + py if y is not None and py is not None else None, w, h)
                cursor = cursor + extent + gap + spacing if cursor is not None and extent is not None else None
            cross_cursor = cross_cursor + line_cross + layout.get("counterGap", 0) if cross_cursor is not None and line_cross is not None else None
        for child in kids:
            if child.get("absolute"):
                walk(child, x + child.get("x", 0) if x is not None else None,
                     y + child.get("y", 0) if y is not None else None)

    walk(tree, 0, 0)
    return rows


def metric(checks: list[dict]) -> dict:
    return {"passed": sum(c["pass"] is True for c in checks), "total": len(checks),
            "unmeasured": sum(c["pass"] is None for c in checks), "checks": checks}


def numeric_check(path, prop, expected, actual, tolerance):
    measured = isinstance(expected, (float, int)) and isinstance(actual, (float, int))
    return {"source": path, "property": prop, "expected": expected, "actual": actual,
            "pass": abs(expected - actual) <= tolerance if measured else None}


def alignment(value):
    return {"start": "LEFT", "end": "RIGHT", "left": "LEFT", "right": "RIGHT",
            "center": "CENTER", "justify": "JUSTIFIED"}.get(value, value)


def compare(tree: dict, spec: dict) -> dict:
    reports = {}
    for key, measurement in spec.get("measurements", {}).items():
        breakpoint, _, state = key.partition(":")
        if measurement.get("error") or not measurement.get("nodes"):
            reports[key] = {"status": "unmeasured", "reason": measurement.get("error") or "no nodes"}
            continue
        if state != "default" or breakpoint not in tree.get("measured", []):
            reports[key] = {"status": "unmeasured", "reason": "build tree has no measured mode for this state"}
            continue
        nodes = [n for n in measurement["nodes"] if spec_to_tree.visible(n)]
        root_box = measurement["nodes"][0]["box"]
        resolved = resolve(tree["tree"], tree.get("variables", {}), breakpoint)
        rendered = layout_nodes(resolved)
        by_source = {}
        for row in rendered:
            by_source.setdefault(row["node"].get("source"), []).append(row)
        geometry, fonts, aligns, runs, images = [], [], [], [], []
        inline = [n for n in nodes if n.get("inlineText")]
        for node in nodes:
            path = node["path"]
            candidates = by_source.get(path, [])
            row = candidates[0] if candidates else None
            consumed = any(path.startswith(n["path"] + "/") for n in inline)
            if not consumed:
                for prop in ("x", "y", "width", "height"):
                    expected = node["box"][prop] - (root_box[prop] if prop in ("x", "y") else 0)
                    check = numeric_check(path, prop, expected, row["box"].get(prop) if row else None, GEOMETRY_TOLERANCE)
                    if row is None:
                        check["pass"] = False
                    geometry.append(check)
            texts = [r["node"]["text"] for r in rendered if r["node"].get("source") in (path, path + "#label") and r["node"].get("kind") == "text"]
            leaf_text = node.get("inlineText") or (node.get("text") if not any(n["path"].startswith(path + "/") for n in nodes) else None)
            if leaf_text and not consumed and not spec_to_tree.icon_glyph(leaf_text):
                text = texts[0] if texts else {}
                font = numeric_check(path, "fontSize", spec_to_tree.px(node["computed"].get("fontSize")), text.get("size"), FONT_TOLERANCE)
                if not texts:
                    font["pass"] = False
                fonts.append(font)
                expected_align = alignment(node["computed"].get("textAlign", "start"))
                aligns.append({"source": path, "expected": expected_align, "actual": text.get("align"), "pass": expected_align == text.get("align")})
                # Older captures retain styled inline descendants, but not their character offsets.
                styles = {tuple(n["computed"].get(p) for p in ("fontWeight", "fontStyle", "color", "textDecorationLine"))
                          for n in nodes if n["path"] == path or (node.get("inlineText") and n["path"].startswith(path + "/") and n.get("text"))}
                expected_runs = len(node.get("textRuns") or node.get("runs") or []) or max(1, len(styles))
                actual_runs = len(text.get("runs") or []) or (1 if text else 0)
                runs.append({"source": path, "expected": expected_runs, "actual": actual_runs,
                             "basis": "recorded runs" if node.get("textRuns") or node.get("runs") else "distinct measured inline styles",
                             "pass": expected_runs == actual_runs, "flattened": expected_runs > actual_runs})
            src = (node.get("image") or {}).get("src")
            background = node["computed"].get("backgroundImage", "none")
            background_src = re.search(r'url\([\'\"]?(.*?)[\'\"]?\)', background)
            for expected in [v for v in (src, background_src.group(1) if background_src else None) if v]:
                actual = [r["node"].get("src") or (r["node"].get("backgroundImage") or {}).get("src") for r in candidates]
                present = expected in actual or (str(expected).startswith("data:image/svg+xml") and any(r["node"].get("kind") == "svg" for r in candidates))
                images.append({"source": path, "expected": expected, "pass": present})
        reports[key] = {"status": "measured", "geometry": metric(geometry), "fontSize": metric(fonts),
                        "textAlignment": metric(aligns), "textRunCount": metric(runs), "imagesPresent": metric(images),
                        "nodeCount": {"measured": len(nodes), "built": len(rendered), "delta": len(rendered) - len(nodes)}}
    return reports
