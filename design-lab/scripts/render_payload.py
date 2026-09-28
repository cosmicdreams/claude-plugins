#!/usr/bin/env python3
"""Deliver the fixed scripts/render/*.js templates to Figma through use_figma.

Every template is the body of an async function with one argument, ARGS. The template never
changes during a build; only ARGS does. Each payload is self-contained and readable: the
step's ARGS, a checksum proving they arrived intact, then the template's own code (plus the
shared documentation kit when the template draws documentation). Nothing is stored in the
Figma file and nothing is evaluated later.

Usage:
  render_payload.py call <template> <args.json>   # the payload for one step
  render_payload.py inline <template> <args.json> # the same without the checksum
  render_payload.py hash                          # renderer version recorded by a build
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

RENDER_DIR = Path(__file__).resolve().parent / "render"
LIMIT = 50_000  # use_figma rejects code longer than this
NAMESPACE = "designlab"
DROP = {"source", "tag"}  # provenance for humans; the renderer never reads them


def fnv1a(text: str) -> str:
    """32-bit FNV-1a over UTF-16 code units; the loader computes the same in JavaScript."""
    h = 0x811C9DC5
    data = text.encode("utf-16-le")
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def templates() -> dict[str, str]:
    """Every renderer unit, by name. Files starting with `_` are shared libraries (the
    documentation kit), sent ahead of any template that draws documentation, so the
    documentation style is defined exactly once."""
    return {p.stem: p.read_text() for p in sorted(RENDER_DIR.glob("*.js"))}


def libraries() -> list[str]:
    return [name for name in templates() if name.startswith("_")]


def digest(source: str) -> str:
    """Unit version: FNV-1a over the template source, recorded by a build as its runtime."""
    return fnv1a(source)


def runtime_hash() -> str:
    return digest("".join(f"{k}\n{v}" for k, v in templates().items()))


# Values the renderer assumes when a key is absent. Leaving them out roughly halves a build
# payload, which is text the relaying model has to reproduce exactly.
DEFAULTS = {"italic": False, "underline": False, "letterSpacing": 0, "case": "ORIGINAL",
            "align": "LEFT", "familyVar": None, "var": None, "opacity": 1, "wrap": False,
            "primaryAlign": "MIN", "counterAlign": "MIN", "gap": 0, "fellBack": False}


def strip(value):
    if isinstance(value, dict):
        return {k: strip(v) for k, v in value.items()
                if k not in DROP and not (k in DEFAULTS and v == DEFAULTS[k])}
    if isinstance(value, list):
        return [strip(v) for v in value]
    return value


def integral(value):
    """20.0 -> 20, so the literal matches what JavaScript's JSON.stringify writes back."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: integral(v) for k, v in value.items()}
    if isinstance(value, list):
        return [integral(v) for v in value]
    return value


def literal(args: dict) -> str:
    """The ARGS literal as sent: ASCII only, so no character can be altered in transit. Icon
    fonts use private-use code points that do not survive a tool call unescaped."""
    return json.dumps(integral(strip(args)), sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def decoded(args: dict) -> str:
    """What JavaScript's JSON.stringify writes for the parsed literal; the checksum covers this."""
    return json.dumps(integral(strip(args)), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


# Templates that draw documentation use the shared kit; the component builder and the data
# templates do not, and are sent without it.
USES_KIT = {"cover", "foundation", "tier_page", "component_block", "getting_started", "voice", "examples"}


def call_payload(template: str, args: dict) -> str:
    """Everything one step runs, in one readable payload: the step's arguments, a checksum
    that proves they arrived intact, then the template code itself (with the documentation kit
    when the template draws documentation). Nothing is stored in the file or evaluated later,
    and the code sent is exactly the code in scripts/render at the runtime recorded by init."""
    lit = literal(args)
    sig = fnv1a(decoded(args))
    shared = "".join(templates()[u] + "\n" for u in libraries()) if template in USES_KIT else ""
    return (
        f"const ARGS = {lit};\n"
        f"let __h = 0x811c9dc5; const __s = JSON.stringify(ARGS);\n"
        f"for (let i = 0; i < __s.length; i++) {{ __h ^= __s.charCodeAt(i); __h = Math.imul(__h, 0x01000193) >>> 0; }}\n"
        f"if (__h.toString(16).padStart(8, '0') !== '{sig}') throw new Error("
        f"'design-lab arguments were altered in transit: checksum ' + __h.toString(16) + ', expected {sig}');\n"
        + shared + templates()[template]
    )


def inline_payload(template: str, args: dict) -> str:
    shared = "".join(templates()[u] + "\n" for u in libraries())
    return f"const ARGS = {literal(args)};\n" + shared + templates()[template]


def emit(code: str, out: str | None) -> int:
    if len(code) > LIMIT:
        print(f"payload is {len(code)} characters; use_figma accepts {LIMIT}", file=sys.stderr)
        return 2
    if out:
        Path(out).write_text(code)
    else:
        sys.stdout.write(code)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="mode", required=True)
    for mode in ("call", "inline"):
        c = sub.add_parser(mode); c.add_argument("template"); c.add_argument("args"); c.add_argument("--out")
    sub.add_parser("hash")
    ns = ap.parse_args()
    if ns.mode == "hash":
        print(runtime_hash())
        return 0
    args = json.loads(Path(ns.args).read_text())
    code = call_payload(ns.template, args) if ns.mode == "call" else inline_payload(ns.template, args)
    return emit(code, ns.out)


if __name__ == "__main__":
    raise SystemExit(main())
