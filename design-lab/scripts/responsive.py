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

    def kids(self, bp: str, path: str) -> list[dict]:
        return [k for k in self.index[bp].get(path, []) if st.visible(k)]

    def child_paths(self, path: str) -> list[str]:
        seen: list[str] = []
        for bp in self.bps:
            for k in self.index[bp].get(path, []):
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
            return {**out, "kind": "image", "name": "Embed",
                    "src": f"capture:{rb}:{out['x']},{out['y']},{st.r2(node['box']['width'])},{st.r2(node['box']['height'])}", "fit": "FILL"}
        if node.get("svg"):
            return {**out, "kind": "svg", "svg": node["svg"]}
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
        if chars and (node.get("inlineText") or not kid_paths):
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

        layout, spacers = self.layout(path, kid_paths, vchain)
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
        return {**out, "kind": "frame", **style, "layout": layout, "children": children}

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
        col_gap = {bp: (l.get("gap", 0) if l["mode"] == "HORIZONTAL" else 0) for bp, l in per.items()}
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
