#!/usr/bin/env python3
"""Compare each built variant with its live capture, from one screenshot of the specimen.

component_block.js returns the geometry of every variant and every capture rectangle inside
the specimen frame. One screenshot of that frame at scale 1 therefore holds both the Figma
master and the live reference, already aligned in columns; this script crops each pair and
measures how far apart they are. One read call per component, not one per breakpoint.

  figma_compare.py <specimen.png> <geometry.json> [--out result.json]

geometry.json: {"variants": [{"label", "x", "y", "width", "height"}],
                "captures": [{"label", "x", "y", "width", "height"}]}  (same order)

A pair passes when at most THRESHOLD of its pixels differ by more than TOLERANCE.

Text can be masked out (`masks`, one list of root-relative boxes per pair, from the live
measurement): both crops are painted white inside each box, so the comparison measures shapes,
images, colours and layout, and a font the Figma machine lacks is reported once, by
`fonts-available`, instead of as pixel error in every component. The unmasked ratio is kept
beside it as `ratioUnmasked`.
Antialiased text alone sits well under two percent; a wrong font, a missing image or a
shifted block does not.

Two metrics, kept side by side so older results stay comparable:

- original (the default): compares only the area the two crops share from their top-left
  corner and applies the tolerance to a greyscale difference, so a master that is too short
  can still pass;
- corrected (`--corrected`, or compare(..., corrected=True)): compares over the larger of
  the two boxes, counts every pixel the other crop does not cover as changed, and applies
  the tolerance to each colour channel separately.
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


def compare_pair_corrected(a: Image.Image, b: Image.Image) -> dict:
    """Corrected metric: unmatched area and per-channel tolerance both count."""
    w, h = max(a.width, b.width), max(a.height, b.height)
    shared_w, shared_h = min(a.width, b.width), min(a.height, b.height)
    total = max(1, w * h)
    changed = total - shared_w * shared_h            # area only one of the two covers
    if shared_w and shared_h:
        box = (0, 0, shared_w, shared_h)
        diff = ImageChops.difference(a.convert("RGB").crop(box), b.convert("RGB").crop(box))
        red, green, blue = diff.split()
        worst = ImageChops.lighter(ImageChops.lighter(red, green), blue)
        changed += sum(worst.histogram()[TOLERANCE + 1:])
    ratio = changed / total
    return {"width": w, "height": h, "changed": changed, "ratio": round(ratio, 4),
            "widthDelta": round(abs(a.width - b.width), 1),
            "heightDelta": round(abs(a.height - b.height), 1), "pass": ratio <= THRESHOLD}


def masked(img: Image.Image, boxes: list[dict]) -> Image.Image:
    img = img.copy()
    for b in boxes:
        x, y = round(b["x"]) - 1, round(b["y"]) - 1
        img.paste("white", (max(0, x), max(0, y), x + round(b["width"]) + 2, y + round(b["height"]) + 2))
    return img


def compare(png: Path, geometry: dict, corrected: bool = False,
            masks: list[list[dict]] | None = None) -> dict:
    with Image.open(png) as raw:
        img = Image.new("RGB", raw.size, "white")
        img.paste(raw.convert("RGBA"), mask=raw.convert("RGBA").split()[-1])
    pairs = []
    for i, (v, c) in enumerate(zip(geometry["variants"], geometry["captures"])):
        pair = compare_pair_corrected if corrected else compare_pair
        a, b = region(img, v), region(img, c)
        boxes = (masks or [])[i] if masks and i < len(masks) else None
        if boxes:
            unmasked = pair(a, b)["ratio"]
            a, b = masked(a, boxes), masked(b, boxes)
        r = pair(a, b)
        if boxes:
            r["ratioUnmasked"], r["textMasked"] = unmasked, len(boxes)
        r["label"] = v.get("label")
        r["heightDelta"] = round(abs(v["height"] - c["height"]), 1)
        pairs.append(r)
    out = {"threshold": THRESHOLD, "tolerance": TOLERANCE, "pairs": pairs,
           "pass": bool(pairs) and all(p["pass"] for p in pairs)}
    return {"metric": "corrected", **out} if corrected else out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("png")
    ap.add_argument("geometry")
    ap.add_argument("--out")
    ap.add_argument("--corrected", action="store_true",
                    help="count height difference and unmatched area; tolerance per channel")
    ns = ap.parse_args()
    out = compare(Path(ns.png), json.loads(Path(ns.geometry).read_text()), ns.corrected)
    text = json.dumps(out, indent=1) + "\n"
    if ns.out:
        Path(ns.out).write_text(text)
    else:
        print(text, end="")
    return 0 if out["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
