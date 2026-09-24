#!/usr/bin/env python3
"""Compare each built variant with its live capture, from one screenshot of the specimen.

component_block.js returns the geometry of every variant and every capture rectangle inside
the specimen frame. One screenshot of that frame at scale 1 therefore holds both the Figma
master and the live reference, already aligned in columns; this script crops each pair and
measures how far apart they are. One read call per component, not one per breakpoint.

  figma_compare.py <specimen.png> <geometry.json> [--out result.json]

geometry.json: {"variants": [{"label", "x", "y", "width", "height"}],
                "captures": [{"label", "x", "y", "width", "height"}]}  (same order)

A pair passes when at most THRESHOLD of its pixels differ by more than TOLERANCE in any
channel. Antialiased text alone sits well under two percent; a wrong font, a missing image
or a shifted block does not.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops

TOLERANCE = 40      # per-channel difference that counts as a changed pixel
THRESHOLD = 0.06    # share of changed pixels a passing pair may have


def region(img: Image.Image, box: dict) -> Image.Image:
    x, y = round(box["x"]), round(box["y"])
    return img.crop((x, y, x + round(box["width"]), y + round(box["height"])))


def compare_pair(a: Image.Image, b: Image.Image) -> dict:
    w, h = min(a.width, b.width), min(a.height, b.height)
    a, b = a.crop((0, 0, w, h)), b.crop((0, 0, w, h))
    diff = ImageChops.difference(a, b).convert("L")
    changed = sum(1 for v in diff.getdata() if v > TOLERANCE)
    total = max(1, w * h)
    return {"width": w, "height": h, "changed": changed, "ratio": round(changed / total, 4),
            "heightDelta": round(abs(a.height - b.height), 1), "pass": changed / total <= THRESHOLD}


def compare(png: Path, geometry: dict) -> dict:
    with Image.open(png) as raw:
        img = Image.new("RGB", raw.size, "white")
        img.paste(raw.convert("RGBA"), mask=raw.convert("RGBA").split()[-1])
    pairs = []
    for v, c in zip(geometry["variants"], geometry["captures"]):
        r = compare_pair(region(img, v), region(img, c))
        r["label"] = v.get("label")
        r["heightDelta"] = round(abs(v["height"] - c["height"]), 1)
        pairs.append(r)
    return {"threshold": THRESHOLD, "tolerance": TOLERANCE, "pairs": pairs,
            "pass": bool(pairs) and all(p["pass"] for p in pairs)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("png")
    ap.add_argument("geometry")
    ap.add_argument("--out")
    ns = ap.parse_args()
    out = compare(Path(ns.png), json.loads(Path(ns.geometry).read_text()))
    text = json.dumps(out, indent=1) + "\n"
    if ns.out:
        Path(ns.out).write_text(text)
    else:
        print(text, end="")
    return 0 if out["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
