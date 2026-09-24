#!/usr/bin/env python3
"""Turn a measure.mjs specification into a deterministic Figma build tree.

measure.mjs records every element of a rendered component as a flat list: box, computed
style, and what the code declares. This script decides, once and by rule, how each element
becomes a Figma node, so the model that later sends the tree to Figma has nothing left to
choose. The same measurements always produce byte-identical output.

Layout rule: a container becomes auto layout only when auto layout reproduces the measured
child positions to within TOLERANCE pixels. Otherwise it keeps absolute positions. Fidelity
wins over structure, and the choice is recorded on the node so a reviewer can see which
containers fell back.

Usage:
  spec_to_tree.py <component.spec.json> [--label "Human Label"] [--out tree.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

TOLERANCE = 2.0
BREAKPOINT_ORDER = ("mobile", "tablet", "desktop")
TAG_NAMES = {
    "h1": "Heading", "h2": "Heading", "h3": "Heading", "h4": "Heading", "h5": "Heading",
    "h6": "Heading", "p": "Text", "a": "Link", "img": "Image", "svg": "Icon", "ul": "List",
    "ol": "List", "li": "Item", "button": "Button", "figure": "Figure",
    "figcaption": "Caption", "blockquote": "Quote", "picture": "Picture", "span": "Text",
    "strong": "Text", "em": "Text", "time": "Date", "label": "Label", "input": "Input",
    "nav": "Navigation", "header": "Header", "footer": "Footer", "section": "Section",
    "article": "Article",
}


def px(value: str | None) -> float:
    if not value:
        return 0.0
    m = re.match(r"^(-?[\d.]+)px$", value.strip())
    return float(m.group(1)) if m else 0.0


def r2(value: float) -> float:
    return round(value * 2) / 2


def parse_color(value: str | None) -> dict | None:
    """rgb()/rgba() to {hex, opacity}; None for transparent or unparseable."""
    if not value:
        return None
    m = re.match(r"rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\s*\)", value)
    if not m:
        return None
    r, g, b = (int(round(float(m.group(i)))) for i in (1, 2, 3))
    a = float(m.group(4)) if m.group(4) is not None else 1.0
    if a == 0:
        return None
    return {"hex": f"#{r:02x}{g:02x}{b:02x}", "opacity": round(a, 3)}


def css_var(declared: str | None) -> str | None:
    """The custom property a declaration binds, e.g. 'var(--kt-red)' -> '--kt-red'."""
    if not declared:
        return None
    m = re.search(r"var\(\s*(--[\w-]+)", declared)
    return m.group(1) if m else None


def parse_shadow(value: str | None) -> list[dict]:
    if not value or value == "none":
        return []
    effects = []
    for part in re.split(r",(?![^(]*\))", value):
        color = parse_color(re.search(r"rgba?\([^)]*\)", part).group(0)) if "rgb" in part else None
        nums = [float(n) for n in re.findall(r"(-?[\d.]+)px", part)]
        if color and len(nums) >= 2:
            x, y = nums[0], nums[1]
            blur = nums[2] if len(nums) > 2 else 0
            spread = nums[3] if len(nums) > 3 else 0
            effects.append({"type": "INNER_SHADOW" if "inset" in part else "DROP_SHADOW",
                            "color": color, "x": x, "y": y, "blur": blur, "spread": spread})
    return effects


def node_name(node: dict, root_block: str | None) -> str:
    for cls in node.get("classes", []):
        m = re.match(r"^[a-z]+-([a-z0-9-]+?)__([a-z0-9-]+)$", cls)
        if m:
            return m.group(2).replace("-", " ").capitalize()
    for cls in node.get("classes", []):
        if root_block and cls == root_block:
            return None  # root is named by the caller
    for cls in node.get("classes", []):
        m = re.match(r"^[a-z]+-([a-z0-9-]+)$", cls)
        if m and "--" not in cls:
            return m.group(1).replace("-", " ").capitalize()
    return TAG_NAMES.get(node["tag"], "Container")


def visible(node: dict) -> bool:
    """Drawn by the browser for a sighted reader. Screen-reader-only text (the 1-pixel clipped
    pattern), zero opacity and clipped-away elements are in the DOM but not on the screen."""
    c = node["computed"]
    b = node["box"]
    if node.get("rendered") is False:
        return False
    if c.get("display") == "none" or c.get("visibility") == "hidden":
        return False
    if float(c.get("opacity") or 1) == 0:
        return False
    clip = (c.get("clip") or "") + " " + (c.get("clipPath") or "")
    if re.search(r"rect\(\s*0(px)?[ ,]+0(px)?[ ,]+0(px)?[ ,]+0(px)?\s*\)|inset\(\s*50%", clip):
        return False
    if b["width"] > 1.5 and b["height"] > 1.5:
        return True
    # A rule (<hr>, a divider) is thin but visible: it draws a border or a background.
    # Screen-reader-only text is also tiny, but draws neither.
    if b["width"] > 1.5 or b["height"] > 1.5:
        borders = any(px(c.get(f"border{s}Width")) > 0 and c.get(f"border{s}Style") not in (None, "none", "hidden")
                      for s in ("Top", "Right", "Bottom", "Left"))
        return borders or parse_color(c.get("backgroundColor")) is not None
    return False


def build_index(nodes: list[dict]) -> dict[str, list[dict]]:
    children: dict[str, list[dict]] = {}
    for n in nodes:
        parent = n["path"].rsplit("/", 1)[0]
        children.setdefault(parent, []).append(n)
    return children


def style_of(node: dict) -> dict:
    c, d = node["computed"], node.get("declared", {})
    style: dict = {}
    fill = parse_color(c.get("backgroundColor"))
    if fill:
        fill["var"] = css_var(d.get("background-color"))
        style["fill"] = fill
    widths = [px(c.get(f"border{s}Width")) for s in ("Top", "Right", "Bottom", "Left")]
    styles = [c.get(f"border{s}Style") for s in ("Top", "Right", "Bottom", "Left")]
    if any(w > 0 and s not in ("none", "hidden") for w, s in zip(widths, styles)):
        color = parse_color(c.get("borderTopColor")) or parse_color(c.get("borderBottomColor"))
        if color:
            color["var"] = css_var(d.get("border-top-color") or d.get("border-bottom-color"))
            style["stroke"] = {"color": color, "top": widths[0], "right": widths[1],
                               "bottom": widths[2], "left": widths[3]}
    radii = [px(c.get(k)) for k in ("borderTopLeftRadius", "borderTopRightRadius",
                                     "borderBottomRightRadius", "borderBottomLeftRadius")]
    if any(radii):
        style["radius"] = radii
    effects = parse_shadow(c.get("boxShadow"))
    if effects:
        style["effects"] = effects
    opacity = float(c.get("opacity") or 1)
    if opacity < 1:
        style["opacity"] = opacity
    if c.get("backgroundImage", "none") not in ("none", ""):
        m = re.search(r'url\("?([^")]+)"?\)', c["backgroundImage"])
        if m:
            style["backgroundImage"] = {"src": m.group(1), "fit": c.get("backgroundSize", "cover")}
    return style


def text_of(node: dict, chars: str) -> dict:
    c, d = node["computed"], node.get("declared", {})
    family = (c.get("fontFamily") or "Inter").split(",")[0].strip().strip("'\"")
    lh = c.get("lineHeight", "normal")
    color = parse_color(c.get("color")) or {"hex": "#000000", "opacity": 1}
    color["var"] = css_var(d.get("color"))
    transform = c.get("textTransform", "none")
    return {
        "characters": chars,
        "family": family,
        "familyVar": css_var(d.get("font-family")),
        "weight": int(re.sub(r"\D", "", c.get("fontWeight") or "400") or 400),
        "italic": c.get("fontStyle") == "italic",
        "size": px(c.get("fontSize")) or 16,
        "lineHeight": None if lh == "normal" else px(lh),
        "letterSpacing": px(c.get("letterSpacing")),
        "align": {"center": "CENTER", "right": "RIGHT", "end": "RIGHT", "justify": "JUSTIFIED"}
            .get(c.get("textAlign", "left"), "LEFT"),
        "case": {"uppercase": "UPPER", "lowercase": "LOWER", "capitalize": "TITLE"}
            .get(transform, "ORIGINAL"),
        "underline": "underline" in (c.get("textDecorationLine") or ""),
        "color": color,
        # One measured line never wraps: Figma sets some faces a hair wider than the browser,
        # and a fixed width would push the last word onto a second line.
        "singleLine": singles(node, c),
    }


def singles(node: dict, c: dict) -> bool:
    size = px(c.get("fontSize")) or 16
    lh = px(c.get("lineHeight")) if c.get("lineHeight") not in (None, "normal") else size * 1.25
    inner = node["box"]["height"] - px(c.get("paddingTop")) - px(c.get("paddingBottom")) \
        - px(c.get("borderTopWidth")) - px(c.get("borderBottomWidth"))
    return inner < lh * 1.5


def icon_glyph(chars: str) -> bool:
    """Text drawn by an icon font: every visible character is in the Private Use Area. Figma
    has no icon fonts, so such text would render as empty boxes; it is drawn from the capture
    instead."""
    visible_chars = [ch for ch in chars if not ch.isspace()]
    return bool(visible_chars) and all(0xE000 <= ord(ch) <= 0xF8FF for ch in visible_chars)


def infer_layout(node: dict, kids: list[dict]) -> dict:
    """Auto layout settings if they reproduce the measured positions, else absolute."""
    c = node["computed"]
    b = node["box"]
    pad = {k: px(c.get(f"padding{k.capitalize()}")) + px(c.get(f"border{k.capitalize()}Width"))
           for k in ("top", "right", "bottom", "left")}
    if not kids:
        return {"mode": "NONE", "padding": pad}
    rel = [(k["box"]["x"] - b["x"], k["box"]["y"] - b["y"], k["box"]["width"], k["box"]["height"])
           for k in kids]
    display = c.get("display", "block")
    horizontal = (display in ("flex", "inline-flex") and c.get("flexDirection", "row").startswith("row")) \
        or display in ("grid", "inline-grid")
    wrap = display in ("grid", "inline-grid") or c.get("flexWrap") == "wrap"

    if horizontal and not wrap:
        primary = primary_align([r[0] for r in rel], [r[2] for r in rel], pad["left"],
                                b["width"] - pad["left"] - pad["right"], c.get("justifyContent"))
        align = cross_align([r[1] for r in rel], [r[3] for r in rel], pad["top"],
                            b["height"] - pad["top"] - pad["bottom"])
        if primary and align:
            return {"mode": "HORIZONTAL", "gap": primary[1], "primaryAlign": primary[0],
                    "padding": pad, "counterAlign": align}
    elif horizontal and wrap:
        fit = wrapped_rows(rel, pad, b, c.get("justifyContent"))
        if fit:
            return {"mode": "HORIZONTAL", "wrap": True, "gap": fit["gap"], "counterGap": fit["rowGap"],
                    "primaryAlign": fit["primary"], "padding": pad, "counterAlign": fit["cross"]}
    else:
        column = display in ("flex", "inline-flex")
        align = cross_align([r[0] for r in rel], [r[2] for r in rel], pad["left"],
                            b["width"] - pad["left"] - pad["right"])
        primary = primary_align([r[1] for r in rel], [r[3] for r in rel], pad["top"],
                                b["height"] - pad["top"] - pad["bottom"],
                                c.get("justifyContent") if column else None)
        if primary and align and (column or primary[0] == "MIN"):
            return {"mode": "VERTICAL", "gap": primary[1], "primaryAlign": primary[0],
                    "padding": pad, "counterAlign": align}
        if align and not column:
            # Normal block flow: children stack from the top, separated by their margins.
            # The first margin becomes extra top padding; unequal margins become spacers of
            # the measured size, so the frame is still auto layout and still exact.
            lead = rel[0][1] - pad["top"]
            gaps = [rel[i + 1][1] - (rel[i][1] + rel[i][3]) for i in range(len(rel) - 1)]
            if lead >= -TOLERANCE and all(g >= -TOLERANCE for g in gaps):
                padded = {**pad, "top": r2(pad["top"] + max(lead, 0))}
                if all(abs(g - gaps[0]) <= TOLERANCE for g in gaps):
                    return {"mode": "VERTICAL", "gap": r2(gaps[0]) if gaps else 0.0, "primaryAlign": "MIN",
                            "padding": padded, "counterAlign": align}
                return {"mode": "VERTICAL", "gap": 0.0, "primaryAlign": "MIN", "padding": padded,
                        "counterAlign": align, "spacers": [r2(max(g, 0)) for g in gaps]}
    return {"mode": "NONE", "padding": pad, "fellBack": True}


def primary_align(offsets, sizes, start, avail, justify) -> tuple[str, float] | None:
    """(primaryAxisAlignItems, itemSpacing) that reproduces the measured positions, or None.

    Gaps must be uniform. Where the leftover space sits decides the alignment; CSS
    space-between maps to Figma's own, and space-around/evenly become CENTER with the
    measured gap, which is exact at the measured size.
    """
    gaps = [offsets[i + 1] - (offsets[i] + sizes[i]) for i in range(len(offsets) - 1)]
    gap = gaps[0] if gaps else 0.0
    if any(abs(g - gap) > TOLERANCE for g in gaps):
        return None
    lead = offsets[0] - start
    trail = avail - (offsets[-1] + sizes[-1] - start)
    if justify == "space-between" and len(offsets) > 1 and abs(lead) <= TOLERANCE and abs(trail) <= TOLERANCE:
        return "SPACE_BETWEEN", r2(gap)
    if abs(lead) <= TOLERANCE:
        return "MIN", r2(gap)
    if abs(lead - trail) <= TOLERANCE:
        return "CENTER", r2(gap)
    if abs(trail) <= TOLERANCE:
        return "MAX", r2(gap)
    return None


def cross_align(offsets, sizes, start, avail) -> str | None:
    if all(abs(o - start) <= TOLERANCE for o in offsets):
        return "MIN"
    if all(abs((o - start) + s / 2 - avail / 2) <= TOLERANCE for o, s in zip(offsets, sizes)):
        return "CENTER"
    if all(abs((o - start) + s - avail) <= TOLERANCE for o, s in zip(offsets, sizes)):
        return "MAX"
    return None


def wrapped_rows(rel, pad, box, justify) -> dict | None:
    """Wrap settings reproducing the measured rows, or None.

    Items start a new row when they no longer sit to the right of the previous item. Every
    row must share one primary alignment and one gap, rows must be evenly spaced from the top
    padding, and items must share one cross alignment within their row.
    """
    rows: list[list[tuple]] = []
    for item in rel:
        if rows and item[0] > rows[-1][-1][0] + rows[-1][-1][2] - TOLERANCE:
            rows[-1].append(item)
        else:
            rows.append([item])
    avail_w = box["width"] - pad["left"] - pad["right"]
    primary = cross = None
    gaps = []
    for row in rows:
        fit = primary_align([r[0] for r in row], [r[2] for r in row], pad["left"], avail_w, justify)
        if not fit or (primary and fit[0] != primary):
            return None
        primary = fit[0]
        if len(row) > 1:
            gaps.append(fit[1])
        top = min(r[1] for r in row)
        height = max(r[1] + r[3] for r in row) - top
        align = cross_align([r[1] for r in row], [r[3] for r in row], top, height)
        if not align or (cross and align != cross):
            return None
        cross = align
    if any(abs(g - gaps[0]) > TOLERANCE for g in gaps):
        return None
    tops = [min(r[1] for r in row) for row in rows]
    bottoms = [max(r[1] + r[3] for r in row) for row in rows]
    if abs(tops[0] - pad["top"]) > TOLERANCE:
        return None
    row_gaps = [tops[i + 1] - bottoms[i] for i in range(len(rows) - 1)]
    if any(abs(g - row_gaps[0]) > TOLERANCE for g in row_gaps):
        return None
    return {"gap": gaps[0] if gaps else 0.0, "rowGap": r2(row_gaps[0]) if row_gaps else 0.0,
            "primary": primary, "cross": cross}


def convert(node: dict, index: dict, root_block: str | None, label: str | None, bp: str = "") -> dict | None:
    if not visible(node):
        return None
    b = node["box"]
    name = label if node["path"].count("/") == 1 else node_name(node, root_block)
    base = {"name": name or "Container", "tag": node["tag"], "x": r2(b["x"]), "y": r2(b["y"]),
            "width": r2(b["width"]), "height": r2(b["height"]), "source": node["path"]}

    if node["tag"] in ("iframe", "video", "canvas", "object", "embed"):
        # Embedded players and drawings cannot be measured inside; their pixels come from
        # the capture, which is exactly what a visitor sees before interacting.
        crop = f"capture:{bp}:{base['x']},{base['y']},{base['width']},{base['height']}"
        return {**base, "kind": "image", "name": "Embed", "src": crop, "fit": "FILL"}
    if node.get("svg"):
        return {**base, "kind": "svg", "svg": node["svg"],
                "color": parse_color(node["computed"].get("color"))}
    if node.get("image"):
        fit = node["computed"].get("objectFit", "fill")
        return {**base, "kind": "image", "src": node["image"]["src"],
                "fit": "FIT" if fit == "contain" else "FILL", **style_of(node)}

    kids_raw = [k for k in index.get(node["path"], []) if visible(k)]
    style = style_of(node)
    chars = node.get("inlineText") or (node.get("text") if not kids_raw else None)

    if chars and not kids_raw and icon_glyph(chars):
        crop = f"capture:{bp}:{base['x']},{base['y']},{base['width']},{base['height']}"
        return {**base, "kind": "image", "name": "Icon", "src": crop, "fit": "FIT"}
    if chars and (node.get("inlineText") or not kids_raw):
        text = {**base, "kind": "text", "text": text_of(node, chars)}
        boxed = bool(style) or any(px(node["computed"].get(f"padding{s}")) for s in
                                   ("Top", "Right", "Bottom", "Left"))
        if not boxed:
            return text
        layout = infer_layout(node, [])
        inner = {**text, "name": "Label", "x": r2(b["x"] + layout["padding"]["left"]),
                 "y": r2(b["y"] + layout["padding"]["top"]),
                 "width": r2(b["width"] - layout["padding"]["left"] - layout["padding"]["right"]),
                 "height": r2(b["height"] - layout["padding"]["top"] - layout["padding"]["bottom"])}
        return {**base, "kind": "frame", **style,
                "layout": {"mode": "VERTICAL", "gap": 0, "padding": layout["padding"],
                           "counterAlign": {"CENTER": "CENTER", "RIGHT": "MAX"}
                           .get(text["text"]["align"], "MIN")},
                "children": [inner]}

    children = [c for c in (convert(k, index, root_block, None, bp) for k in kids_raw) if c]
    # A wrapper with no visual style and one child of the same box adds depth, not meaning.
    if not style and len(children) == 1 and node["path"].count("/") > 1:
        only = children[0]
        if abs(only["width"] - base["width"]) <= TOLERANCE and abs(only["height"] - base["height"]) <= TOLERANCE:
            return only
    kept = [k for k in kids_raw if visible(k)]
    layout = infer_layout(node, [k for k, c in zip(kept, (convert(k, index, root_block, None, bp) for k in kept)) if c])
    spacers = layout.pop("spacers", None)
    if spacers:
        inner_w = r2(b["width"] - layout["padding"]["left"] - layout["padding"]["right"])
        spaced = []
        for i, child in enumerate(children):
            spaced.append(child)
            if i < len(spacers) and spacers[i] > 0:
                spaced.append({"kind": "frame", "name": "Spacer", "width": inner_w, "height": spacers[i],
                               "x": child["x"], "y": r2(child["y"] + child["height"]),
                               "layout": {"mode": "NONE", "padding": {"top": 0, "right": 0, "bottom": 0, "left": 0}},
                               "children": []})
        children = spaced
    return {**base, "kind": "frame", **style, "layout": layout, "children": children}


def build(spec: dict, label: str | None) -> dict:
    breakpoints = []
    for key in sorted(spec["measurements"], key=lambda k: BREAKPOINT_ORDER.index(k.split(":")[0])
                      if k.split(":")[0] in BREAKPOINT_ORDER else 99):
        bp, state = key.split(":")
        m = spec["measurements"][key]
        if m.get("error"):
            breakpoints.append({"breakpoint": bp, "state": state, "error": m["error"]})
            continue
        nodes = m["nodes"]
        root = nodes[0]
        root_block = next((c for c in root["classes"] if "__" not in c and "--" not in c), None)
        tree = convert(root, build_index(nodes), root_block, label or spec.get("component"), bp)
        breakpoints.append({"breakpoint": bp, "state": state, "tree": tree})
    return {"component": spec.get("component"), "machineName": spec.get("machineName"),
            "label": label or spec.get("component"), "breakpoints": breakpoints}


def compact(tree: dict) -> dict:
    """Payload form of one breakpoint tree: text styles move to a shared table referenced by
    index, and all-zero padding disappears. build_responsive.js expands both. Lossless."""
    styles: list[dict] = []
    keys: dict[str, int] = {}

    def walk(node: dict) -> dict:
        out = {k: v for k, v in node.items() if k not in ("children", "text", "layout")}
        if "text" in node:
            style = {k: v for k, v in node["text"].items() if k != "characters"}
            key = json.dumps(style, sort_keys=True)
            if key not in keys:
                keys[key] = len(styles)
                styles.append(style)
            out["chars"] = node["text"]["characters"]
            out["ts"] = keys[key]
        if "layout" in node:
            layout = dict(node["layout"])
            pad = layout.pop("padding", None) or {}
            values = [pad.get("top", 0), pad.get("right", 0), pad.get("bottom", 0), pad.get("left", 0)]
            if any(values):
                layout["pad"] = values
            out["layout"] = layout
        if "children" in node:
            out["children"] = [walk(c) for c in node["children"]]
        return out

    return {"styles": styles, "tree": walk(tree)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("spec")
    ap.add_argument("--label")
    ap.add_argument("--out")
    args = ap.parse_args()
    tree = build(json.loads(Path(args.spec).read_text()), args.label)
    text = json.dumps(tree, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
    if args.out:
        Path(args.out).write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
