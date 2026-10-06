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
# `Text` is Figma's own default layer name, so text elements take a name Figma never assigns.
TAG_NAMES = {
    "h1": "Heading", "h2": "Heading", "h3": "Heading", "h4": "Heading", "h5": "Heading",
    "h6": "Heading", "p": "Paragraph", "a": "Link", "img": "Image", "svg": "Icon", "ul": "List",
    "ol": "List", "li": "Item", "button": "Button", "figure": "Figure",
    "figcaption": "Caption", "blockquote": "Quote", "picture": "Picture", "span": "Inline text",
    "strong": "Strong text", "em": "Emphasis", "time": "Date", "label": "Label", "input": "Input",
    "nav": "Navigation", "header": "Header", "footer": "Footer", "section": "Section",
    "article": "Article",
}


# CSS overflow values that cut off what lies outside the box: hidden and clip, and a scrolling box,
# which shows only its own window. The shorthand gives one value or two (x then y); either counts.
CLIPPING_OVERFLOW = {"hidden", "clip", "auto", "scroll"}


def clips(computed: dict) -> bool:
    return any(value in CLIPPING_OVERFLOW for value in str(computed.get("overflow") or "").split())


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
    """The custom property a declaration binds, e.g. 'var(--brand-red)' -> '--brand-red'."""
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


# Figma's own placeholder names: a layer carrying one reads as never named.
FIGMA_DEFAULT = {"Frame", "Group", "Rectangle", "Ellipse", "Text", "Vector", "Line", "Polygon",
                 "Star", "Component", "Slice"}


def node_name(node: dict, root_block: str | None) -> str:
    for cls in node.get("classes", []):
        m = re.match(r"^[a-z]+-([a-z0-9-]+?)__([a-z0-9-]+)$", cls)
        if m:
            name = m.group(2).replace("-", " ").capitalize()
            # `c-card__text` is "Text", Figma's default; qualify it with its block instead.
            return (m.group(1).replace("-", " ").capitalize() + " " + name.lower()
                    if name in FIGMA_DEFAULT else name)
    for cls in node.get("classes", []):
        if root_block and cls == root_block:
            return None  # root is named by the caller
    for cls in node.get("classes", []):
        m = re.match(r"^[a-z]+-([a-z0-9-]+)$", cls)
        if m and "--" not in cls:
            name = m.group(1).replace("-", " ").capitalize()
            return name + " element" if name in FIGMA_DEFAULT else name
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


def draws_nothing(node: dict) -> bool:
    c = node["computed"]
    return (parse_color(c.get("backgroundColor")) is None
            and c.get("backgroundImage", "none") in ("none", "")
            and not any(px(c.get(f"border{s}Width")) > 0 and c.get(f"border{s}Style") not in (None, "none", "hidden")
                        for s in ("Top", "Right", "Bottom", "Left"))
            and c.get("boxShadow", "none") in ("none", ""))


def passthrough(node: dict, has_children: bool = True) -> bool:
    """A wrapper that draws nothing itself but holds drawn children, so its children belong
    to its parent: `<picture>` around an `<img>`, `display: contents`, a zero-size wrapper, or
    an inline element with no text of its own. An inline element's box is a line fragment (one
    site's `<picture>`: 28px tall at y 78 around a 188px image at y 0), never a container."""
    if not has_children:
        return False
    c, b = node["computed"], node["box"]
    if c.get("display") == "none" or c.get("visibility") == "hidden":
        return False
    if float(c.get("opacity") or 1) == 0:
        return False
    if c.get("display") == "contents" or b["width"] <= 1.5 or b["height"] <= 1.5:
        return True
    return (c.get("display") == "inline" and not node.get("text") and not node.get("inlineText")
            and draws_nothing(node))


def stacking(node: dict) -> tuple[int, int]:
    """CSS painting order among siblings: negative z-index, then in-flow boxes, then
    positioned boxes with z-index auto or 0, then positive z-index; document order within."""
    c = node["computed"]
    positioned = c.get("position") not in (None, "static")
    try:
        z = int(c.get("zIndex"))
    except (TypeError, ValueError):
        z = 0
    if positioned and z < 0:
        return (0, z)
    if not positioned:
        return (1, 0)
    return (3, z) if z > 0 else (2, 0)


def _length(value: str, whole: float) -> float:
    value = value.strip()
    if value.endswith("%"):
        return float(value[:-1]) / 100 * whole
    return px(value)


def clip_shape(clip: str | None, width: float, height: float) -> dict | None:
    """`clip-path: circle()`, `ellipse()` or `polygon()` as geometry in the element's own box,
    or None for anything else (which is then drawn as its box)."""
    if not clip or clip == "none":
        return None
    m = re.match(r"circle\(\s*([\d.]+(?:px|%))?\s*(?:at\s+([\d.]+(?:px|%))\s+([\d.]+(?:px|%)))?\s*\)", clip)
    if m:
        # A percentage radius is of sqrt(w^2 + h^2) / sqrt(2), per CSS Shapes.
        ref = ((width ** 2 + height ** 2) / 2) ** 0.5
        r = _length(m.group(1) or "50%", ref)
        cx = _length(m.group(2) or "50%", width)
        cy = _length(m.group(3) or "50%", height)
        return {"kind": "ellipse", "cx": r2(cx), "cy": r2(cy), "rx": r2(r), "ry": r2(r)}
    m = re.match(r"ellipse\(\s*([\d.]+(?:px|%))\s+([\d.]+(?:px|%))\s*(?:at\s+([\d.]+(?:px|%))\s+([\d.]+(?:px|%)))?\s*\)", clip)
    if m:
        return {"kind": "ellipse", "rx": r2(_length(m.group(1), width)),
                "ry": r2(_length(m.group(2), height)),
                "cx": r2(_length(m.group(3) or "50%", width)),
                "cy": r2(_length(m.group(4) or "50%", height))}
    m = re.match(r"polygon\((.*)\)$", clip.strip())
    if m:
        points = []
        for pair in m.group(1).split(","):
            parts = pair.split()
            if len(parts) != 2:
                return None
            points.append((r2(_length(parts[0], width)), r2(_length(parts[1], height))))
        return {"kind": "polygon", "points": points}
    return None


def shape_svg(shape: dict, width: float, height: float, fill: dict) -> str:
    color = 'fill="%s" fill-opacity="%s"' % (fill["hex"], fill.get("opacity", 1))
    if shape["kind"] == "ellipse":
        body = '<ellipse cx="%s" cy="%s" rx="%s" ry="%s" %s/>' % (
            shape["cx"], shape["cy"], shape["rx"], shape["ry"], color)
    else:
        body = '<polygon points="%s" %s/>' % (
            " ".join("%s,%s" % point for point in shape["points"]), color)
    # The element's box is the canvas; anything the shape draws outside it is clipped away,
    # as the browser clips it.
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" viewBox="0 0 %s %s">'
            '<defs><clipPath id="box"><rect width="%s" height="%s"/></clipPath></defs>'
            '<g clip-path="url(#box)">%s</g></svg>') % (r2(width), r2(height), r2(width), r2(height),
                                                      r2(width), r2(height), body)


def pseudo_image(node: dict, which: str) -> dict | None:
    """An image a `::before`/`::after` draws: `content: url(...)` or an empty content box with a
    background image. Returns {svg|src, width, height, gap} or None."""
    pseudo = node.get(which)
    if not pseudo:
        return None
    m = re.search(r'url\("?([^")]+)"?\)', pseudo.get("content") or "")
    if not m and (pseudo.get("content") or "").strip("'\"") == "":
        m = re.search(r'url\("?([^")]+)"?\)', pseudo.get("backgroundImage") or "")
    if not m:
        return None
    if pseudo.get("display") == "none":
        return None
    size = px(node["computed"].get("fontSize")) or 16
    width = px(pseudo.get("width")) or size
    height = px(pseudo.get("height")) or size
    gap = px(pseudo.get("marginRight" if which == "before" else "marginLeft"))
    url = m.group(1)
    out = {"width": r2(width), "height": r2(height), "gap": r2(gap)}
    if url.startswith("data:image/svg+xml"):
        import urllib.parse, base64
        data = url.split(",", 1)[1]
        out["svg"] = (base64.b64decode(data).decode("utf-8", "replace") if ";base64" in url.split(",", 1)[0]
                      else urllib.parse.unquote(data))
        angle = rotation(pseudo.get("transform"))
        if angle:
            # Turned inside the SVG, about its centre, so the layer keeps its box in auto layout.
            out["svg"] = re.sub(r"(<svg\b[^>]*>)(.*)(</svg>)",
                                lambda m: '%s<g transform="rotate(%s %s %s)">%s</g>%s' % (
                                    m.group(1), angle, width / 2, height / 2, m.group(2), m.group(3)),
                                out["svg"], count=1, flags=re.S)
    else:
        out["src"] = url
    return out


def masked_icon_svg(node: dict) -> str | None:
    """An element drawn as `mask-image: url(icon.svg)` over its background colour: the icon's
    shape in that colour. Without this the background paints a solid box where the icon is.

    Only the `<svg>` element itself is kept (an XML declaration, comments, or an HTML page that
    a login redirect returned are dropped or refused). Every painted fill and stroke, in an
    attribute of either quote style or in CSS, takes the mask colour; `none` stays unpainted.
    The root is sized to the measured box, so the SVG's default preserveAspectRatio (xMidYMid
    meet) reproduces `mask-size: contain` and its centring, and Figma imports it at that size."""
    source = node.get("maskSvg")
    fill = parse_color((node.get("computed") or {}).get("backgroundColor"))
    if not source or not fill:
        return None
    source = re.sub(r"<!--.*?-->", "", source, flags=re.S)
    # An SVG document starts with its root; an HTML page (a login redirect) with a logo inside
    # is not the icon.
    source = re.sub(r"^\s*(<\?xml.*?\?>)?\s*(<!DOCTYPE[^>]*>)?\s*", "", source, flags=re.S | re.I)
    end = source.rfind("</svg>")
    if not source.startswith("<svg") or end < 0:
        return None
    svg = source[:end + len("</svg>")]
    colour, alpha = fill["hex"], fill.get("opacity", 1)
    svg = re.sub(r"""\b(fill|stroke)=(["'])(?!none\2)[^"']*\2""", lambda m: f'{m.group(1)}="{colour}"', svg)
    svg = re.sub(r"""\b(fill|stroke)\s*:\s*(?!none\b)[^;"'}<]+""", lambda m: f"{m.group(1)}:{colour}", svg)
    svg = svg.replace("currentColor", colour)
    root = re.match(r"<svg\b[^>]*>", svg).group(0)
    tag = root
    box = node.get("box") or {}
    width, height = r2(box.get("width") or 0), r2(box.get("height") or 0)
    if width and height:
        # Keep the drawing's own coordinate system before the root takes the box's size.
        if not re.search(r"\bviewBox=", tag):
            w = re.search(r"""\bwidth=["']?([\d.]+)""", tag)
            h = re.search(r"""\bheight=["']?([\d.]+)""", tag)
            if w and h:
                tag = tag.replace("<svg", f'<svg viewBox="0 0 {w.group(1)} {h.group(1)}"', 1)
        tag = re.sub(r"""\s(width|height)=(["'])[^"']*\2""", "", tag)
        tag = tag.replace("<svg", f'<svg width="{width}" height="{height}"', 1)
    # Shapes with no fill of their own inherit the root's, which defaults to black.
    if not re.search(r"\bfill=", tag) and not re.search(r"\bfill\s*:", tag):
        tag = tag.replace("<svg", f'<svg fill="{colour}"', 1)
    if alpha < 1:
        tag = tag.replace("<svg", f'<svg opacity="{alpha}"', 1)
    return svg.replace(root, tag, 1)


def masked_leaf(node: dict, has_children: bool) -> str | None:
    """The masked icon, for an element that is only the icon: one with children or text keeps
    its frame (a section cut to a wave shape must not lose its content)."""
    if has_children or (node.get("text") or "").strip():
        return None
    return masked_icon_svg(node)


def positioned_out(node: dict) -> bool:
    """Taken out of the flow by `position: absolute` or `fixed`."""
    return (node.get("computed") or {}).get("position") in ("absolute", "fixed")


def pseudo_geometry(node: dict, which: str) -> dict | None:
    """A decorative pseudo-element's box inside its element, from its computed offsets: empty
    content, a background colour, absolutely positioned, and the element itself positioned (so
    it is the containing block the offsets are measured from)."""
    p = node.get(which) or {}
    if (p.get("content") or "").strip("'\"") != "" or p.get("display") == "none":
        return None
    fill = parse_color(p.get("backgroundColor"))
    if not fill or p.get("position") not in ("absolute", "fixed"):
        return None
    if (node.get("computed") or {}).get("position") in (None, "static"):
        return None
    width, height = px(p.get("width")), px(p.get("height"))
    if width <= 0 or height <= 0:
        return None
    box = node["box"]
    left, right, top, bottom = (p.get(k) for k in ("left", "right", "top", "bottom"))
    x = px(left) if left not in (None, "auto") else (box["width"] - px(right) - width if right not in (None, "auto") else 0)
    y = px(top) if top not in (None, "auto") else (box["height"] - px(bottom) - height if bottom not in (None, "auto") else 0)
    # A translate moves it after layout (a full-bleed field: left 580px, then -700px).
    m = re.match(r"matrix\(\s*1,\s*0,\s*0,\s*1,\s*([-\d.e]+),\s*([-\d.e]+)\)", p.get("transform") or "")
    if m:
        x, y = x + float(m.group(1)), y + float(m.group(2))
    fake = {"computed": {"position": p.get("position"), "zIndex": p.get("zIndex")}}
    return {"x": r2(x), "y": r2(y), "width": r2(width), "height": r2(height), "fill": fill,
            "stacking": stacking(fake)}


def translated(node: dict) -> bool:
    """Moved by a CSS transform's translation (`matrix(1, 0, 0, 1, -2820, 0)`)."""
    m = re.match(r"matrix\(\s*[-\d.e]+,\s*[-\d.e]+,\s*[-\d.e]+,\s*[-\d.e]+,\s*([-\d.e]+),\s*([-\d.e]+)\)",
                 (node.get("computed") or {}).get("transform") or "")
    return bool(m) and (abs(float(m.group(1))) > 0.5 or abs(float(m.group(2))) > 0.5)


def rotation(transform: str | None) -> float:
    """Clockwise degrees from a computed `transform` (`matrix(a, b, c, d, e, f)`), else 0."""
    import math
    m = re.match(r"matrix\(\s*([-\d.e]+),\s*([-\d.e]+),", transform or "")
    if not m:
        return 0
    angle = round(math.degrees(math.atan2(float(m.group(2)), float(m.group(1)))), 2)
    return 0 if abs(angle) < 0.01 else angle


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
    # The site crops this element's contents to its box; so must the frame.
    if clips(c):
        style["clip"] = True
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
        # The whole stack: when its first family is never served, the visitor sees a later one,
        # and the build's font plan (fonts.json) says which.
        "stack": c.get("fontFamily") or "",
        "familyVar": css_var(d.get("font-family")),
        "weight": int(re.sub(r"\D", "", c.get("fontWeight") or "400") or 400),
        "italic": str(c.get("fontStyle") or "").startswith(("italic", "oblique")),
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


def grid_tracks(node: dict) -> int | None:
    """Column tracks of a grid container, from its computed `grid-template-columns`; 0 when not
    a grid, None when the measurement did not record the tracks (never guess a stack)."""
    c = node.get("computed") or {}
    if c.get("display") not in ("grid", "inline-grid"):
        return 0
    tracks = (c.get("gridTemplateColumns") or "").split()
    return len(tracks) if tracks and tracks != ["none"] else None


def infer_layout(node: dict, kids: list[dict], stacked_grid: bool = False) -> dict:
    """Auto layout settings if they reproduce the measured positions, else absolute.

    `stacked_grid`: the caller found this grid has one column track at every width, so it is a
    vertical stack drawn with grid gaps, not a row that wraps. Laid out as a wrapping row, its
    children sit side by side in Figma and their text wraps a word per line.
    """
    c = node["computed"]
    b = node["box"]
    pad = {k: px(c.get(f"padding{k.capitalize()}")) + px(c.get(f"border{k.capitalize()}Width"))
           for k in ("top", "right", "bottom", "left")}
    if not kids:
        return {"mode": "NONE", "padding": pad}
    rel = [(k["box"]["x"] - b["x"], k["box"]["y"] - b["y"], k["box"]["width"], k["box"]["height"])
           for k in kids]
    display = c.get("display", "block")
    if stacked_grid and display in ("grid", "inline-grid"):
        display = "block"
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
    icon = masked_leaf(node, any(visible(k) for k in index.get(node["path"], [])))
    if icon:
        return {**base, "kind": "svg", "name": "Icon", "svg": icon}
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
