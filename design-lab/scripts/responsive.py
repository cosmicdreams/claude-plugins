#!/usr/bin/env python3
"""Merge a component's three breakpoint measurements into ONE responsive Figma master.

The library holds one component per source component. Mobile and tablet are not separate
drawings or variants: they are instances of the same master, resized, with the Breakpoint
variable collection switched to that mode. Everything that differs between widths is
therefore a variable with one value per mode:

- numbers (font size, line height, padding, gaps, fixed widths and heights) become FLOAT
  variables;
- an element shown at some widths and hidden at others gets a BOOLEAN `visible` variable;
- a container whose layout changes shape (three columns become one) becomes a wrapping row
  whose children take their measured width per mode, so the content restacks when resized.

A container that no single auto layout can reproduce at every width keeps absolute
positions from the desktop measurement and is recorded as a fallback, never guessed.

Values identical at every width stay plain values, so a component that does not change
across breakpoints produces no variables at all.

  responsive.py <component.spec.json> --label "Human Label" [--out tree.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import spec_to_tree as st

MODES = ("desktop", "tablet", "mobile")          # desktop is the collection's default mode
MODE_NAMES = {"desktop": "Desktop", "tablet": "Tablet", "mobile": "Mobile"}
TOL = st.TOLERANCE


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-") or "node"


class Merge:
    def __init__(self, spec: dict, label: str, component_key: str):
        self.label = label
        self.key = component_key
        self.bps = [m for m in MODES if f"{m}:default" in spec["measurements"]
                    and not spec["measurements"][f"{m}:default"].get("error")]
        self.nodes = {bp: {n["path"]: n for n in spec["measurements"][f"{bp}:default"]["nodes"]} for bp in self.bps}
        self.index = {bp: st.build_index(spec["measurements"][f"{bp}:default"]["nodes"]) for bp in self.bps}
        self.widths = {bp: (spec["measurements"][f"{bp}:default"].get("rootBox")
                            or spec["measurements"][f"{bp}:default"]["nodes"][0]["box"])["width"] for bp in self.bps}
        self.variables: dict[str, dict] = {}
        self.slotted: dict[str, dict] = {}
        self.fallbacks: list[str] = []
        self.notes: list[str] = []
        root = spec["measurements"][f"{self.bps[0]}:default"]["nodes"][0]
        self.root_path = root["path"]
        self.root_block = next((c for c in root["classes"] if "__" not in c and "--" not in c), None)

    # ---------------------------------------------------------------- values

    def value(self, per_bp: dict, name: str, kind: str = "FLOAT"):
        """A plain value when every breakpoint agrees, else a variable reference."""
        vals = {bp: per_bp[bp] for bp in self.bps if bp in per_bp and per_bp[bp] is not None}
        if not vals:
            return None
        distinct = set(json.dumps(v) for v in vals.values())
        if len(distinct) == 1:
            return next(iter(vals.values()))
        full = {}
        for bp in MODES:
            full[bp] = vals.get(bp, vals.get("desktop", next(iter(vals.values()))))
        var = f"{self.key}/{name}"
        self.variables[var] = {"type": kind, "values": {MODE_NAMES[bp]: full[bp] for bp in MODES}}
        return {"var": var}

    def visible_in(self, path: str) -> dict:
        return {bp: (path in self.nodes[bp] and st.visible(self.nodes[bp][path])) for bp in self.bps}

    def box(self, bp: str, path: str) -> dict:
        return self.nodes[bp][path]["box"]

    # ---------------------------------------------------------------- tree

    def children_of(self, bp: str, path: str) -> list[dict]:
        """Direct children, with a pass-through wrapper (`<picture>`) replaced by its own
        children: the wrapper draws nothing, but what it holds does."""
        out = []
        for k in self.index[bp].get(path, []):
            if st.passthrough(k, bool(self.index[bp].get(k["path"]))):
                out.extend(self.children_of(bp, k["path"]))
            else:
                out.append(k)
        return out

    def kids(self, bp: str, path: str) -> list[dict]:
        """Visible children that shape the layout: an absolutely positioned child takes no room
        in the flow, so it is left out whenever any child is in flow."""
        visible = [k for k in self.children_of(bp, path) if st.visible(k)]
        flow = [k for k in visible if not st.positioned_out(k)]
        return flow if flow else visible

    def visual_order(self, path: str, kid_paths: list[str]) -> list[str]:
        """Children in the order they are drawn, when that order is the same at every width and
        differs from the DOM (`flex-direction: row-reverse`, or `order`: a teaser's photo drawn
        left of the text that precedes it). Rows top to bottom, left to right within a row."""
        orders = []
        for bp in self.bps:
            if path not in self.nodes[bp] or not st.visible(self.nodes[bp][path]):
                continue
            if not all(self.visible_in(k)[bp] for k in kid_paths):
                return kid_paths
            boxes = {k: self.box(bp, k) for k in kid_paths}
            rows: list[list[str]] = []
            for k in sorted(kid_paths, key=lambda k: boxes[k]["y"]):
                b = boxes[k]
                row = rows[-1] if rows else None
                if row and b["y"] < max(boxes[r]["y"] + boxes[r]["height"] for r in row) - TOL:
                    row.append(k)
                else:
                    rows.append([k])
            orders.append([k for row in rows for k in sorted(row, key=lambda k: boxes[k]["x"])])
        if orders and all(o == orders[0] for o in orders) and orders[0] != kid_paths:
            return orders[0]
        return kid_paths

    def positioned_kids(self, path: str, kid_paths: list[str]) -> list[str]:
        """Children placed by `position: absolute` or `fixed`, when others are in flow."""
        out = [k for k in kid_paths if st.positioned_out(self.nodes[self.ref_bp(k)][k])]
        return out if len(out) < len(kid_paths) else []

    def pseudo_box(self, path: str, which: str, vchain: str) -> dict | None:
        """A decorative `::before`/`::after`: empty content, a background colour, absolutely
        positioned inside its element (one site's 1400x902 purple field behind a carousel)."""
        per = {}
        for bp in self.bps:
            node = self.nodes[bp].get(path)
            box = st.pseudo_geometry(node, which) if node and st.visible(node) else None
            if box:
                # Cropped to the component: its capture shows nothing beyond its own box.
                root = self.box(bp, self.root_path)
                ox, oy = node["box"]["x"] - root["x"], node["box"]["y"] - root["y"]
                left, top = max(box["x"], -ox), max(box["y"], -oy)
                right = min(box["x"] + box["width"], root["width"] - ox)
                bottom = min(box["y"] + box["height"], root["height"] - oy)
                if right - left <= 0 or bottom - top <= 0:
                    continue
                per[bp] = {**box, "x": st.r2(left), "y": st.r2(top),
                           "width": st.r2(right - left), "height": st.r2(bottom - top)}
        if not per:
            return None
        ref = per.get("desktop") or next(iter(per.values()))
        name = f"{self.name_for(path, vchain)[1]}-{which}"
        spec = {"kind": "frame", "name": "Decoration", "source": f"{path}::{which}", "sizing": "FIXED",
                "absolute": True, "x": ref["x"], "y": ref["y"], "fill": ref["fill"],
                "width": self.value({bp: b["width"] for bp, b in per.items()}, f"{name}/width"),
                "height": self.value({bp: b["height"] for bp, b in per.items()}, f"{name}/height"),
                "layout": {"mode": "NONE"}, "children": [], "_stacking": ref["stacking"]}
        if set(per) != set(self.bps):
            spec["visible"] = self.value({bp: bp in per for bp in self.bps}, f"{name}/visible", "BOOLEAN")
        return spec

    def child_paths(self, path: str) -> list[str]:
        seen: list[str] = []
        for bp in self.bps:
            for k in self.children_of(bp, path):
                if k["path"] not in seen and any(self.visible_in(k["path"]).values()):
                    seen.append(k["path"])
        # DOM order: the measurement counter in each path segment
        return sorted(seen, key=lambda p: int(re.search(r"\[(\d+)\]$", p).group(1)))

    def ref_bp(self, path: str) -> str:
        vis = self.visible_in(path)
        return next(bp for bp in self.bps if vis[bp])

    def name_for(self, path: str, chain: str) -> tuple[str, str]:
        node = self.nodes[self.ref_bp(path)][path]
        name = self.label if path == self.root_path else st.node_name(node, self.root_block)
        name = name or "Container"
        idx = re.search(r"\[(\d+)\]$", path).group(1)
        # The measurement index is unique within the component, so the element's own name and
        # index identify it; repeating the whole ancestor path only lengthens every name.
        return name, (f"{slug(name)}-{idx}" if chain else slug(name))

    def convert(self, path: str, parent_inner: dict | None, chain: str) -> dict | None:
        vis = self.visible_in(path)
        if not any(vis.values()):
            return None
        rb = self.ref_bp(path)
        node = self.nodes[rb][path]
        name, vchain = self.name_for(path, chain)
        out: dict = {"name": name, "source": path}
        # Tagged during measurement as the root of a child bundle's own render: the builder
        # makes it an instance of that child's master when the file has one.
        child_of = (node.get("attributes") or {}).get("data-design-lab-child")
        if child_of:
            out["instanceOf"] = child_of
        if not all(vis.values()):
            out["visible"] = self.value({bp: vis[bp] for bp in self.bps}, f"{vchain}/visible", "BOOLEAN")

        widths = {bp: self.box(bp, path)["width"] for bp in self.bps if vis[bp]}
        heights = {bp: self.box(bp, path)["height"] for bp in self.bps if vis[bp]}
        fill = parent_inner is not None and all(
            abs(widths[bp] - parent_inner[bp]) <= TOL for bp in widths if bp in parent_inner)
        out["sizing"] = "FILL" if fill else "FIXED"
        out["width"] = self.value({bp: st.r2(w) for bp, w in widths.items()}, f"{vchain}/width")
        out["height"] = self.value({bp: st.r2(h) for bp, h in heights.items()}, f"{vchain}/height")
        out["x"] = st.r2(node["box"]["x"])
        out["y"] = st.r2(node["box"]["y"])

        tag = node["tag"]
        if tag in ("iframe", "video", "canvas", "object", "embed"):
            # Another document's rendering: only its picture is known, and it reflows by width
            # (a form one column at mobile), so each width shows its own crop of its own capture.
            shots = []
            for bp in self.bps:
                if not vis[bp]:
                    continue
                b = self.box(bp, path)
                shot = {"kind": "image", "name": f"Embed · {MODE_NAMES[bp]}", "source": f"{path}#{bp}",
                        "sizing": "FILL", "width": st.r2(b["width"]), "height": st.r2(b["height"]),
                        "src": f"capture:{bp}:{st.r2(b['x'])},{st.r2(b['y'])},{st.r2(b['width'])},{st.r2(b['height'])}",
                        "fit": "FILL", "x": 0, "y": 0}
                if len([v for v in vis.values() if v]) > 1:
                    shot["visible"] = self.value({m: m == bp for m in self.bps}, f"{vchain}/embed-{bp}", "BOOLEAN")
                shots.append(shot)
            if len(shots) == 1:
                return {**out, **{k: v for k, v in shots[0].items() if k not in ("visible", "source", "name")},
                        "name": "Embed"}
            return {**out, "kind": "frame", "name": "Embed", "clip": True,
                    "layout": {"mode": "VERTICAL", "gap": 0, "primaryAlign": "MIN", "counterAlign": "MIN",
                               "padding": {"top": 0, "right": 0, "bottom": 0, "left": 0}},
                    "children": shots}
        if node.get("svg"):
            return {**out, "kind": "svg", "svg": node["svg"]}
        if node.get("image") and str(node["image"].get("src") or "").startswith("data:image/svg+xml"):
            import base64, urllib.parse
            head, _, data = node["image"]["src"].partition(",")
            svg = base64.b64decode(data).decode("utf-8", "replace") if ";base64" in head else urllib.parse.unquote(data)
            return {**out, "kind": "svg", "svg": svg}
        if node.get("image"):
            fit = node["computed"].get("objectFit", "fill")
            return {**out, "kind": "image", "src": node["image"]["src"], "fit": "FIT" if fit == "contain" else "FILL",
                    **st.style_of(node)}

        kid_paths = self.child_paths(path)
        chars = node.get("inlineText") or (node.get("text") if not kid_paths else None)
        if chars and not kid_paths and st.icon_glyph(chars):
            b = node["box"]
            return {**out, "kind": "image", "name": "Icon", "fit": "FIT",
                    "src": f"capture:{rb}:{st.r2(b['x'])},{st.r2(b['y'])},{st.r2(b['width'])},{st.r2(b['height'])}"}
        style = st.style_of(node)
        shape = st.clip_shape(node["computed"].get("clipPath"), node["box"]["width"], node["box"]["height"])
        if shape and not kid_paths and style.get("fill"):
            return {**out, "kind": "svg", "name": name,
                    "svg": st.shape_svg(shape, node["box"]["width"], node["box"]["height"], style["fill"])}
        if chars and (node.get("inlineText") or not kid_paths):
            icons = {which: st.pseudo_image(node, which) for which in ("before", "after")}
            if any(icons.values()):
                return self.text_with_icons(out, path, chars, vchain, style, icons)
            text = self.text(path, chars, vchain)
            pads = self.padding(path)
            boxed = bool(style) or any(any(v for v in p.values()) for p in [pads.get(bp, {}) for bp in self.bps])
            if not boxed:
                return {**out, "kind": "text", "text": text}
            inner = {"name": "Label", "kind": "text", "text": text, "source": path + "#label",
                     # One line sizes to its own text; wrapping text fills the padded box.
                     "sizing": "FIXED" if text.get("singleLine") else "FILL"}
            return {**out, "kind": "frame", **style,
                    "layout": {"mode": "VERTICAL", "gap": 0, "counterAlign": {"CENTER": "CENTER", "RIGHT": "MAX"}.get(text.get("align"), "MIN"),
                               "padding": self.padding_value(pads, vchain)},
                    "children": [inner]}

        # Absolutely positioned children take no room in the flow: the layout comes from the
        # others, and they are placed over it at their measured offsets.
        positioned = self.positioned_kids(path, kid_paths)
        kid_paths = self.visual_order(path, [k for k in kid_paths if k not in positioned])
        reordered = self.reordered_stack(path, kid_paths, vchain, style, out)
        if reordered:
            reordered["children"] = self.stack_in(reordered["children"],
                                                  self.placed(path, positioned, node, rb, vchain))
            return reordered
        layout, spacers = self.layout(path, kid_paths, vchain)
        if layout["mode"] == "NONE":
            # Placed freely, children overlap: draw them in CSS painting order, so a shape with
            # z-index 1 sits above the photo instead of under it.
            kid_paths = sorted(kid_paths, key=lambda kp: st.stacking(self.nodes[self.ref_bp(kp)][kp]))
        inner = {bp: self.box(bp, path)["width"] - self.pads(bp, path)["left"] - self.pads(bp, path)["right"]
                 for bp in self.bps if vis[bp]}
        children = []
        for i, kp in enumerate(kid_paths):
            if layout.get("slots"):
                child = self.convert(kp, None, vchain)
                if not child:
                    continue
                slot = self.slotted[path][kp]
                wrapper = {"kind": "frame", "name": f"Slot · {child['name']}", "sizing": "FIXED",
                           "width": slot["width"], "height": child["height"], "source": kp + "#slot",
                           "layout": {"mode": "HORIZONTAL", "gap": 0, "primaryAlign": "MIN", "counterAlign": "MIN",
                                      "padding": {"top": slot["padTop"], "right": 0, "bottom": 0, "left": slot["padLeft"]}},
                           "children": [child]}
                if "visible" in child:
                    wrapper["visible"] = child.pop("visible")
                children.append(wrapper)
                continue
            child = self.convert(kp, inner if layout["mode"] != "NONE" else None, vchain)
            if not child:
                continue
            if layout["mode"] == "NONE":
                child["x"] = st.r2(self.box(rb, kp)["x"] - node["box"]["x"]) if kp in self.nodes[rb] else 0
                child["y"] = st.r2(self.box(rb, kp)["y"] - node["box"]["y"]) if kp in self.nodes[rb] else 0
            children.append(child)
            if spacers and i < len(spacers) and spacers[i] is not None:
                children.append({"kind": "frame", "name": "Spacer", "sizing": "FILL", "width": 1,
                                 "height": spacers[i], "layout": {"mode": "NONE"}, "children": [], "source": kp + "#spacer"})
        return {**out, "kind": "frame", **style, "layout": layout,
                "children": self.stack_in(children, self.placed(path, positioned, node, rb, vchain))}

    def placed(self, path: str, positioned: list[str], node: dict, rb: str, vchain: str) -> list[dict]:
        """The absolutely positioned children and decorative pseudo-elements, at their offsets."""
        out = []
        for kp in positioned:
            child = self.convert(kp, None, vchain)
            if child:
                child["absolute"] = True
                child["x"] = st.r2(self.box(rb, kp)["x"] - node["box"]["x"]) if kp in self.nodes[rb] else 0
                child["y"] = st.r2(self.box(rb, kp)["y"] - node["box"]["y"]) if kp in self.nodes[rb] else 0
                child["_stacking"] = st.stacking(self.nodes[self.ref_bp(kp)][kp])
                out.append(child)
        for which in ("before", "after"):
            box = self.pseudo_box(path, which, vchain)
            if box:
                out.insert(0, box) if which == "before" else out.append(box)
        return out

    def stack_in(self, children: list[dict], placed: list[dict]) -> list[dict]:
        """Slot absolutely placed layers into the child order by CSS painting order. Layer order
        is z-order in Figma; flow children keep their relative order, so the layout is unchanged."""
        def key(child):
            if "_stacking" in child:
                return child["_stacking"]
            source = (child.get("source") or "").split("#")[0].split("::")[0]
            node = next((self.nodes[bp][source] for bp in self.bps if source in self.nodes[bp]), None)
            return st.stacking(node) if node else (1, 0)
        out = list(children)
        for item in placed:
            k = key(item)
            # A `::before` paints ahead of its element's children at the same level; anything else
            # after them, in document order.
            ahead = str(item.get("source") or "").endswith("::before")
            at = next((i for i, c in enumerate(out) if (key(c) >= k if ahead else key(c) > k)), len(out))
            out.insert(at, item)
        for item in out:
            item.pop("_stacking", None)
        return out

    def reordered_stack(self, path: str, kid_paths: list[str], vchain: str, style: dict,
                        out: dict) -> dict | None:
        """A vertical stack whose order changes with width (flex `order`, or a reversed
        direction): the photo first at desktop, last at mobile. Figma has one child order for
        every mode, so each placement becomes a slot, a child that moves appears in two, and a
        Breakpoint visibility variable shows the right one; a hidden slot takes no room. Each
        slot's top padding is the gap the site leaves above that child at that width.
        Returns None unless every width is a clean stack and the DOM order is not."""
        if len(kid_paths) < 2:
            return None
        orders = {}
        dom_is_stack = True
        for bp in self.bps:
            if path not in self.nodes[bp] or not st.visible(self.nodes[bp][path]):
                continue
            vis = [k for k in kid_paths if self.visible_in(k)[bp]]
            visual = sorted(vis, key=lambda k: (self.box(bp, k)["y"], self.box(bp, k)["x"]))
            stacked = lambda seq: all(self.box(bp, b)["y"] >= self.box(bp, a)["y"] + self.box(bp, a)["height"] - TOL
                                      for a, b in zip(seq, seq[1:]))
            if not stacked(visual):
                return None
            dom_is_stack &= stacked(vis)
            orders[bp] = visual
        if dom_is_stack or len(orders) < 2:
            return None
        # Merge the per-width orders into one sequence of placements (a longest-common-
        # subsequence merge), each placement used at the widths that draw it there.
        bps = list(orders)
        merged = [{"path": k, "bps": {bps[0]}} for k in orders[bps[0]]]
        for bp in bps[1:]:
            target, seq = orders[bp], [m["path"] for m in merged]
            table = [[0] * (len(target) + 1) for _ in range(len(seq) + 1)]
            for i in range(len(seq) - 1, -1, -1):
                for j in range(len(target) - 1, -1, -1):
                    table[i][j] = (table[i + 1][j + 1] + 1 if seq[i] == target[j]
                                   else max(table[i + 1][j], table[i][j + 1]))
            result, i, j = [], 0, 0
            while i < len(seq) or j < len(target):
                if i < len(seq) and j < len(target) and seq[i] == target[j]:
                    merged[i]["bps"].add(bp); result.append(merged[i]); i += 1; j += 1
                elif j < len(target) and (i == len(seq) or table[i][j + 1] >= table[i + 1][j]):
                    result.append({"path": target[j], "bps": {bp}}); j += 1
                else:
                    result.append(merged[i]); i += 1
            merged = result
        pads = self.padding(path)
        inner = {bp: self.box(bp, path)["width"] - pads[bp]["left"] - pads[bp]["right"] for bp in orders}
        children, seen = [], {}
        for m in merged:
            kp = m["path"]
            seen[kp] = seen.get(kp, 0) + 1
            child = self.convert(kp, inner, vchain)
            if not child:
                continue
            slot_name = f"{self.name_for(kp, vchain)[1]}-{seen[kp]}"
            tops = {}
            for bp in m["bps"]:
                order = orders[bp]
                at = order.index(kp)
                above = (self.box(bp, order[at - 1])["y"] + self.box(bp, order[at - 1])["height"] if at
                         else self.box(bp, path)["y"] + pads[bp]["top"])
                tops[bp] = st.r2(max(0, self.box(bp, kp)["y"] - above))
            slot = {"kind": "frame", "name": f"Slot · {child['name']}", "sizing": "FILL",
                    "width": self.value({bp: st.r2(w) for bp, w in inner.items()}, f"{vchain}/inner-width"),
                    "height": child["height"], "source": f"{kp}#order-{seen[kp]}",
                    "layout": {"mode": "VERTICAL", "gap": 0, "primaryAlign": "MIN", "counterAlign": "MIN",
                               "padding": {"top": self.value(tops, f"{slot_name}/order-top"),
                                           "right": 0, "bottom": 0, "left": 0}},
                    "children": [child]}
            child.pop("visible", None)
            if m["bps"] != set(orders):
                slot["visible"] = self.value({bp: bp in m["bps"] for bp in self.bps}, f"{slot_name}/order-visible", "BOOLEAN")
            children.append(slot)
        return {**out, "kind": "frame", **style,
                "layout": {"mode": "VERTICAL", "gap": 0, "primaryAlign": "MIN", "counterAlign": "MIN",
                           "padding": self.padding_value(pads, vchain)},
                "children": children}

    def text_with_icons(self, out: dict, path: str, chars: str, vchain: str, style: dict,
                        icons: dict) -> dict:
        """Text whose element draws an icon in `::before` or `::after` (a chevron beside a link):
        a row of icon, text, icon, spaced by the pseudo-element's margin."""
        text = self.text(path, chars, vchain)
        children, gap = [], 0
        for which in ("before", "after"):
            icon = icons.get(which)
            if which == "after":
                children.append({"name": "Label", "kind": "text", "text": text, "source": path + "#label",
                                 "sizing": "FIXED" if text.get("singleLine") else "FILL"})
            if not icon:
                continue
            node = {"name": "Icon", "source": f"{path}::{which}", "sizing": "FIXED",
                    "width": icon["width"], "height": icon["height"], "x": 0, "y": 0}
            node.update({"kind": "svg", "svg": icon["svg"]} if icon.get("svg") else
                        {"kind": "image", "src": icon["src"], "fit": "FIT"})
            children.append(node)
            gap = max(gap, icon["gap"])
        pads = self.padding(path)
        return {**out, "kind": "frame", **style,
                "layout": {"mode": "HORIZONTAL", "gap": gap, "primaryAlign": {"CENTER": "CENTER", "RIGHT": "MAX"}.get(text.get("align"), "MIN"),
                           "counterAlign": "CENTER", "padding": self.padding_value(pads, vchain)},
                "children": children}

    # ---------------------------------------------------------------- pieces

    def pads(self, bp: str, path: str) -> dict:
        c = self.nodes[bp][path]["computed"]
        return {k: st.px(c.get(f"padding{k.capitalize()}")) + st.px(c.get(f"border{k.capitalize()}Width"))
                for k in ("top", "right", "bottom", "left")}

    def padding(self, path: str) -> dict:
        return {bp: self.pads(bp, path) for bp in self.bps if path in self.nodes[bp] and st.visible(self.nodes[bp][path])}

    def padding_value(self, pads: dict, vchain: str, extra_top: dict | None = None) -> dict:
        out = {}
        for side in ("top", "right", "bottom", "left"):
            per = {bp: st.r2(p[side] + ((extra_top or {}).get(bp, 0) if side == "top" else 0)) for bp, p in pads.items()}
            out[side] = self.value(per, f"{vchain}/padding-{side}")
        return out

    def text(self, path: str, chars: str, vchain: str) -> dict:
        per = {bp: st.text_of(self.nodes[bp][path], chars) for bp in self.bps
               if path in self.nodes[bp] and st.visible(self.nodes[bp][path])}
        base = dict(per.get("desktop") or next(iter(per.values())))
        for prop in ("size", "lineHeight", "letterSpacing"):
            base[prop] = self.value({bp: t[prop] for bp, t in per.items()}, f"{vchain}/{slug(prop)}")
        base["singleLine"] = all(t.get("singleLine") for t in per.values())
        if len({t["align"] for t in per.values()}) > 1:
            self.notes.append(f"{vchain}: text alignment differs by width; desktop alignment kept")
        return base

    def layout(self, path: str, kid_paths: list[str], vchain: str) -> tuple[dict, list | None]:
        per = {}
        for bp in self.bps:
            if path not in self.nodes[bp] or not st.visible(self.nodes[bp][path]):
                continue
            kids = self.kids(bp, path)
            per[bp] = st.infer_layout(self.nodes[bp][path], kids)
        pads = self.padding(path)
        if not kid_paths:
            return {"mode": "NONE", "padding": self.padding_value(pads, vchain)}, None
        # A child moved by a CSS translate (a carousel's slide track, slid 2820px left to show its
        # third slide) sits where the transform put it, which no flow layout reproduces: place
        # children at their measured positions. Faithful, not a fallback.
        if any(st.translated(self.nodes[bp][k]) for k in kid_paths for bp in per if k in self.nodes[bp]):
            return {"mode": "NONE", "padding": self.padding_value(pads, vchain)}, None
        modes = {bp: l["mode"] for bp, l in per.items()}
        if "NONE" in modes.values():
            return self.slot_flow(path, kid_paths, vchain, pads)
        extra_top = {bp: (l["padding"]["top"] - pads[bp]["top"]) for bp, l in per.items()}
        padding = self.padding_value(pads, vchain, extra_top)
        dirs = set(modes.values())
        wraps = any(l.get("wrap") for l in per.values())
        if dirs == {"VERTICAL"} and not any(l.get("spacers") for l in per.values()):
            return {"mode": "VERTICAL",
                    "gap": self.value({bp: l.get("gap", 0) for bp, l in per.items()}, f"{vchain}/gap"),
                    "counterAlign": per.get("desktop", next(iter(per.values()))).get("counterAlign", "MIN"),
                    "primaryAlign": "MIN", "padding": padding}, None
        if dirs == {"VERTICAL"} and all(self.visible_in(k)[bp] for k in kid_paths for bp in per):
            # Unequal margins at one or more widths: exact spacers, each a variable height.
            n = len(kid_paths)
            gaps_per = {}
            for bp in per:
                vis_kids = [k for k in kid_paths if self.visible_in(k)[bp]]
                if len(vis_kids) != n:
                    self.fallbacks.append(vchain)
                    return {"mode": "NONE", "fellBack": True, "padding": self.padding_value(pads, vchain)}, None
                boxes = [self.box(bp, k) for k in kid_paths]
                gaps_per[bp] = [st.r2(max(0, boxes[i + 1]["y"] - (boxes[i]["y"] + boxes[i]["height"]))) for i in range(n - 1)]
            spacers = [self.value({bp: g[i] for bp, g in gaps_per.items()}, f"{vchain}/spacer-{i + 1}") for i in range(n - 1)]
            return {"mode": "VERTICAL", "gap": 0, "counterAlign": per.get("desktop", next(iter(per.values()))).get("counterAlign", "MIN"),
                    "primaryAlign": "MIN", "padding": padding}, spacers
        if dirs == {"HORIZONTAL"} and not wraps:
            aligns = {l.get("primaryAlign", "MIN") for l in per.values()}
            if len(aligns) > 1:
                self.notes.append(f"{vchain}: horizontal alignment differs by width; desktop alignment kept")
            return {"mode": "HORIZONTAL",
                    "gap": self.value({bp: l.get("gap", 0) for bp, l in per.items()}, f"{vchain}/gap"),
                    "primaryAlign": per.get("desktop", next(iter(per.values()))).get("primaryAlign", "MIN"),
                    "counterAlign": per.get("desktop", next(iter(per.values()))).get("counterAlign", "MIN"),
                    "padding": padding}, None
        if len(dirs) > 1 or any(l.get("primaryAlign", "MIN") != "MIN" for l in per.values() if l["mode"] == "VERTICAL"):
            return self.slot_flow(path, kid_paths, vchain, pads)
        # Grids that wrap at every width: a wrapping row whose children take their measured
        # width at each mode.
        # Measured widths round to half pixels, and three 397.5px cards with two 24px gaps make
        # 1240.5px in a 1240px row: Figma wraps the third. A pixel off the gap keeps the row.
        col_gap = {bp: max(0, (l.get("gap", 0) if l["mode"] == "HORIZONTAL" else 0) - 1) for bp, l in per.items()}
        row_gap = {bp: (l.get("counterGap", 0) if l["mode"] == "HORIZONTAL" else l.get("gap", 0)) for bp, l in per.items()}
        primary = {l.get("primaryAlign", "MIN") for l in per.values() if l["mode"] == "HORIZONTAL"}
        return {"mode": "HORIZONTAL", "wrap": True,
                "gap": self.value(col_gap, f"{vchain}/column-gap"),
                "counterGap": self.value(row_gap, f"{vchain}/row-gap"),
                "primaryAlign": sorted(primary)[0] if primary else "MIN",
                "counterAlign": "MIN", "padding": padding}, None


def _rows(boxes: list[tuple]) -> list[list[int]] | None:
    """Group children (in DOM order) into reading-order rows, or None if they are not in
    row-major order: a child starts a new row when it does not sit to the right of the last."""
    rows: list[list[int]] = []
    for i, (x, y, w, h) in enumerate(boxes):
        if rows:
            px_, py, pw, ph = boxes[rows[-1][-1]]
            if x >= px_ + pw - TOL and y < py + ph - TOL:
                rows[-1].append(i)
                continue
            if y < max(boxes[j][1] + boxes[j][3] for j in rows[-1]) - TOL and x < px_:
                return None
        rows.append([i])
    return rows


def _slot_flow(self, path: str, kid_paths: list[str], vchain: str, pads: dict) -> tuple[dict, None]:
    """Express any reading-order arrangement as a wrapping row of slots.

    Each child sits in a slot. Per breakpoint, slot widths tile each row exactly and the
    slot's left and top padding place the child where the site draws it, so the same frame
    reproduces a row with pushed-right items at desktop and a centred stack at mobile. All
    three numbers are Breakpoint variables; the container itself has no gaps.
    """
    per_bp = {}
    for bp in self.bps:
        if path not in self.nodes[bp] or not st.visible(self.nodes[bp][path]):
            continue
        box = self.box(bp, path)
        p = pads[bp]
        left, top = box["x"] + p["left"], box["y"] + p["top"]
        right = box["x"] + box["width"] - p["right"]
        vis = [k for k in kid_paths if self.visible_in(k)[bp]]
        # Round first, so every sum below is exact in half pixels and slots tile a row exactly.
        rel = [tuple(st.r2(v) for v in (self.box(bp, k)["x"], self.box(bp, k)["y"],
                                          self.box(bp, k)["width"], self.box(bp, k)["height"])) for k in vis]
        left, top, right = st.r2(left), st.r2(top), st.r2(right)
        rows = _rows(rel)
        if rows is None:
            # Children placed out of reading order. When the site positions them itself
            # (absolute shapes over a photo, carousel slides), free placement is what the site
            # does, not a fallback; only in-flow children that cannot be tiled fall back.
            positioned = any(self.nodes[bp][k]["computed"].get("position") in ("absolute", "fixed")
                             for k in vis)
            if positioned:
                return {"mode": "NONE", "padding": self.padding_value(pads, vchain)}, None
            self.fallbacks.append(vchain)
            return {"mode": "NONE", "fellBack": True, "padding": self.padding_value(pads, vchain)}, None
        slots = {}
        above = top
        for row in rows:
            cursor = left
            for pos, i in enumerate(row):
                x, y, w, h = rel[i]
                last = pos == len(row) - 1
                # The last slot in a row reaches the row's end, so the next child wraps; it is
                # never narrower than its own padding plus content, which Figma resolves badly.
                width = max(right - cursor, x + w - cursor) if last else (x + w - cursor)
                slots[vis[i]] = {"width": st.r2(width), "padLeft": st.r2(max(0, x - cursor)),
                                 "padTop": st.r2(max(0, y - above))}
                cursor = x + w
            above = max(rel[i][1] + rel[i][3] for i in row)
        per_bp[bp] = slots
    self.slotted[path] = {}
    for k in kid_paths:
        name = self.name_for(k, vchain)[1]
        vals = {bp: s[k] for bp, s in per_bp.items() if k in s}
        self.slotted[path][k] = {
            "width": self.value({bp: v["width"] for bp, v in vals.items()}, f"{name}/slot-width"),
            "padLeft": self.value({bp: v["padLeft"] for bp, v in vals.items()}, f"{name}/slot-left"),
            "padTop": self.value({bp: v["padTop"] for bp, v in vals.items()}, f"{name}/slot-top"),
        }
    return {"mode": "HORIZONTAL", "wrap": True, "gap": 0, "counterGap": 0, "slots": True,
            "primaryAlign": "MIN", "counterAlign": "MIN", "padding": self.padding_value(pads, vchain)}, None


Merge.slot_flow = _slot_flow


def build(spec: dict, label: str, key: str | None = None) -> dict:
    key = key or slug(spec.get("machineName") or spec.get("component") or label)
    m = Merge(spec, label, key)
    tree = m.convert(m.root_path, None, "")
    tree["sizing"] = "FIXED"
    return {"component": spec.get("component"), "machineName": spec.get("machineName"), "label": label,
            "modes": [MODE_NAMES[bp] for bp in MODES], "measured": m.bps,
            "widths": {MODE_NAMES[bp]: m.widths[bp] for bp in m.bps},
            "variables": dict(sorted(m.variables.items())), "fallbacks": sorted(set(m.fallbacks)),
            "notes": m.notes, "tree": tree}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("spec")
    ap.add_argument("--label", required=True)
    ap.add_argument("--key")
    ap.add_argument("--out")
    ns = ap.parse_args()
    out = build(json.loads(Path(ns.spec).read_text()), ns.label, ns.key)
    text = json.dumps(out, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
    if ns.out:
        Path(ns.out).write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
