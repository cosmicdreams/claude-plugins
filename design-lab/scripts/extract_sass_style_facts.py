#!/usr/bin/env python3
"""Extract bounded visual declarations from Sass without flattening nested selectors."""

from __future__ import annotations

import re
from pathlib import Path


VISUAL_PROPERTIES = {
    "display", "flex-direction", "gap", "grid-gap", "row-gap", "column-gap",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "max-width", "min-height", "width", "height", "background-color", "background",
    "color", "border-radius", "border", "border-bottom", "font-size", "line-height",
    "font-weight", "text-align", "box-shadow", "margin",
}


def strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", "", text)


def blocks(text: str) -> list[tuple[int, str, str]]:
    """Return depth, selector, body for each rule.

    Resetting the selector buffer at every declaration terminator is essential. Without it,
    declarations from a root rule become a prefix on the following nested selector.
    """
    result = []
    depth = 0
    selector: list[str] = []
    stack: list[tuple[str, int, int]] = []
    quote = None
    escaped = False
    for index, char in enumerate(text):
        if quote:
            escaped = char == "\\" and not escaped
            if char == quote and not escaped:
                quote = None
            elif char != "\\":
                escaped = False
            continue
        if char in ("'", '"'):
            quote = char
            selector.append(char)
        elif char == "{":
            stack.append(("".join(selector).strip(), index + 1, depth))
            selector = []
            depth += 1
        elif char == "}":
            depth -= 1
            if stack:
                name, start, rule_depth = stack.pop()
                result.append((rule_depth, name, text[start:index]))
            selector = []
        elif char == ";":
            selector = []
        else:
            selector.append(char)
    return result


def own_declarations(body: str) -> list[dict]:
    depth = 0
    current: list[str] = []
    declarations = []
    quote = None
    for char in body:
        if quote:
            current.append(char)
            if char == quote:
                quote = None
            continue
        if char in ("'", '"'):
            quote = char
            if depth == 0:
                current.append(char)
        elif char == "{":
            if depth == 0:
                current = []
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                current = []
        elif depth == 0:
            current.append(char)
            if char == ";":
                declarations.append("".join(current))
                current = []
    if current:
        declarations.append("".join(current))
    result = []
    for declaration in declarations:
        value = declaration.strip().rstrip(";").strip()
        if not value or ":" not in value or value.startswith(("//", "@")):
            continue
        name, _, raw = value.partition(":")
        name, raw = name.strip(), raw.strip()
        if name not in VISUAL_PROPERTIES and not name.startswith("--"):
            continue
        resolution = ("css-custom-property" if "var(--" in raw else
                      "sass-variable" if "$" in raw else "literal")
        result.append({"property": name, "value": raw, "resolution": resolution})
    return result


def extract_file(path: str | Path) -> dict:
    path = Path(path)
    text = strip_comments(path.read_text(encoding="utf-8", errors="replace"))
    roots, parts = [], []
    for depth, selector, body in blocks(text):
        declarations = own_declarations(body)
        if not declarations:
            continue
        entry = {"selector": selector, "declarations": declarations}
        (roots if depth == 0 else parts).append(entry)
    return {
        "rootRules": roots,
        "partRules": parts,
        "mediaQueries": len(re.findall(r"@include\s+media-breakpoint|@media\b", text)),
    }
