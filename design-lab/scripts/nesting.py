"""A child component's rendering inside its parent, from the parent's measurement.

Capture tags the root of every child bundle's own render with `data-design-lab-child`. The
child's subtree of the parent's measurement, rebased to the child's own box, is a measurement
of the child as that parent renders it: the evidence for a child with no example page of its
own (capture_all.derive_children), and for a layout of a child that differs from its own
capture (figma_build alternates).
"""

from __future__ import annotations

import re


def _shown(box: dict, width: float, height: float) -> float:
    w = max(0, min(box["x"] + box["width"], width) - max(box["x"], 0))
    h = max(0, min(box["y"] + box["height"], height) - max(box["y"], 0))
    return w * h / max(1, box["width"] * box["height"])


def _transparent(color: str) -> bool:
    return not color or color == "transparent" or bool(re.match(r"rgba\(.*,\s*0\)$", color))


def subtree(spec: dict, child: str) -> tuple[dict, dict] | None:
    """({`<bp>:default`: measurement}, {bp: root box in the parent}) for the child's rendering
    the parent's screenshot shows most of, or None unless every width has one at least four
    fifths shown. A carousel's later slides sit off to the side; a grid's gutters let an item
    overhang a little."""
    derived, boxes = {}, {}
    for key, m in (spec.get("measurements") or {}).items():
        nodes = m.get("nodes") or []
        frame = m.get("rootBox") or (nodes[0]["box"] if nodes else {})
        width, height = frame.get("width", 0), frame.get("height", 0)
        tagged = [n for n in nodes if (n.get("attributes") or {}).get("data-design-lab-child") == child]
        root = max(tagged, key=lambda n: _shown(n["box"], width, height), default=None)
        if root is None or _shown(root["box"], width, height) < 0.8:
            return None
        ox, oy = root["box"]["x"], root["box"]["y"]
        cut = len(root["path"]) - len(root["path"].rsplit("/", 1)[1]) - 1
        sub = [{**n, "path": n["path"][cut:],
                "box": {**n["box"], "x": round(n["box"]["x"] - ox, 2), "y": round(n["box"]["y"] - oy, 2)}}
               for n in nodes if n["path"] == root["path"] or n["path"].startswith(root["path"] + "/")]
        # What shows through the child is its nearest coloured ancestor inside the parent (a
        # yellow panel), and only failing that, what showed through the parent.
        by_path = {n["path"]: n for n in nodes}
        backdrop, up = m.get("backdrop"), root["path"].rsplit("/", 1)[0]
        while up:
            color = ((by_path.get(up) or {}).get("computed") or {}).get("backgroundColor") or ""
            if not _transparent(color):
                backdrop = color
                break
            up = up.rsplit("/", 1)[0]
        derived[key] = {"rootBox": {"width": root["box"]["width"], "height": root["box"]["height"]},
                        "nodes": sub, "backdrop": backdrop}
        boxes[key.split(":")[0]] = root["box"]
    return (derived, boxes) if derived else None


def signature(tree: dict) -> tuple[int, int]:
    """Text layers and site images in a build tree, counted as the builder counts an
    instance's, so a parent's rendering is matched to the variant with the same structure."""
    texts = images = 0
    stack = [tree]
    while stack:
        node = stack.pop()
        if node.get("kind") == "text":
            texts += 1
        elif node.get("kind") == "image" and node.get("src") and not str(node["src"]).startswith("capture:"):
            images += 1
        stack.extend(node.get("children") or [])
    return texts, images
