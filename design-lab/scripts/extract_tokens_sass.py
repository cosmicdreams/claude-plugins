#!/usr/bin/env python3
"""Extract source-authored Sass scalar variables and simple token maps."""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from artifact_contracts import tool_version, validate, write_json
from extract_tokens_sourcemap import FLAGS, VAR, classify as value_family, resolve as resolve_alias

STANDARD_VERSION = "3.0.0"
SKIP = re.compile(r"/(node_modules|vendor|\.git|contrib|core)/")
TOKEN_MAPS = {"spacers", "grid-breakpoints", "container-max-widths", "font-sizes"}


def _files(root):
    found = []
    for directory, dirs, files in os.walk(root):
        if SKIP.search(directory + os.sep):
            dirs[:] = []
            continue
        for name in files:
            if name.endswith(".scss"):
                found.append(os.path.join(directory, name))
    return sorted(found)


def _balanced_map(text, name):
    match = re.search(rf"^\s*\${re.escape(name)}\s*:\s*\(", text, re.M)
    if not match:
        return None
    start = text.find("(", match.start())
    depth = 0
    quote = None
    for index in range(start, len(text)):
        char = text[index]
        if quote:
            if char == quote and text[index - 1] != "\\":
                quote = None
            continue
        if char in "'\"":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return text[start + 1:index]
    return None


def _map_entries(body):
    entries = []
    depth = 0
    for raw_line in body.splitlines():
        line = re.sub(r"//.*$", "", raw_line).strip()
        if depth == 0:
            match = re.match(r"[\"']?([A-Za-z0-9_-]+)[\"']?\s*:\s*([^,]+),?", line)
            if match and "(" not in match.group(2):
                entries.append((match.group(1), match.group(2).strip()))
        depth += line.count("(") - line.count(")")
    return entries


def _make_resolver(table):
    """Return a cycle-safe, memoized resolver for a repository-sized Sass table.

    ``extract_tokens_sourcemap.resolve`` is deliberately small and depth-limited because a
    source map normally contributes only a few dozen declarations. Applying it independently
    to every declaration in a source tree can revisit a large alias graph exponentially. A
    source-tree extractor needs each named declaration resolved once.
    """
    cache = {}
    resolving = set()

    def named(name):
        if name in cache:
            return cache[name]
        if name in resolving or name not in table:
            return "$" + name
        resolving.add(name)
        value = expression(table[name])
        resolving.remove(name)
        cache[name] = value
        return value

    def expression(raw):
        value = str(raw).strip()
        substituted = re.sub(r"\$([A-Za-z0-9_-]+)", lambda match: named(match.group(1)), value)
        # Reuse the source-map resolver for literal em()/colour functions after the alias
        # graph is gone; this call is constant work and cannot fan out recursively.
        value = resolve_alias(substituted, {})
        multiplication = re.fullmatch(
            r"\s*(-?[\d.]+)(px|rem|em)?\s*\*\s*(-?[\d.]+)\s*", value)
        if multiplication:
            number = float(multiplication.group(1)) * float(multiplication.group(3))
            suffix = multiplication.group(2) or ""
            return f"{number:g}{suffix}"
        return value

    return expression


def _family(name, value):
    rules = (
        (r"font-size|(^|-)text-size", "font-size"),
        (r"line-height|leading", "line-height"),
        (r"font-family", "font-family"),
        (r"font-weight", "font-weight"),
        (r"letter-spacing|tracking", "letter-spacing"),
        (r"radius|rounded", "radius"),
        (r"duration|transition|delay|ease", "motion"),
        (r"spacer|spacing|gap|gutter|padding|margin", "spacing"),
    )
    for pattern, family in rules:
        if re.search(pattern, name, re.I):
            return family
    return value_family(value)


def _map_family(name, value):
    return {
        "spacers": "spacing",
        "font-sizes": "font-size",
        "grid-breakpoints": "breakpoint",
        "container-max-widths": "container-width",
    }.get(name, _family(name, value))


def extract(root):
    root = os.path.abspath(root)
    sources = []
    texts = {}
    table = {}
    for path in _files(root):
        try:
            with open(path, errors="ignore") as handle:
                body = handle.read()
        except OSError:
            continue
        found = VAR.findall(body)
        if not found and not any(_balanced_map(body, name) for name in TOKEN_MAPS):
            continue
        texts[path] = body
        sources.append({"source": os.path.relpath(path, root), "variables": len(found)})
        for name, value in found:
            table.setdefault(name, FLAGS.sub("", value).strip())

    if not table:
        raise ValueError(f"no source-authored Sass variables found under {root}")

    resolve = _make_resolver(table)
    tokens = []
    for path, body in texts.items():
        relative = os.path.relpath(path, root)
        layer = "base" if "/source/00-config/" in ("/" + relative) or "/source/01-base/" in ("/" + relative) else "component"
        for name, raw_value in VAR.findall(body):
            raw = FLAGS.sub("", raw_value).strip()
            if raw.startswith("("):
                continue
            value = resolve(raw)
            tokens.append({"name": name, "codeName": "$" + name, "raw": raw,
                           "value": value, "family": _family(name, value),
                           "isAlias": raw != value, "layer": layer,
                           "provenance": {"kind": "config", "ref": relative}})
        for map_name in TOKEN_MAPS:
            map_body = _balanced_map(body, map_name)
            if map_body is None:
                continue
            for key, raw in _map_entries(map_body):
                value = resolve(raw)
                tokens.append({"name": f"{map_name}-{key}", "codeName": None,
                               "codePath": f"${map_name}[{key}]", "raw": raw,
                               "value": value, "family": _map_family(map_name, value),
                               "isAlias": raw != value, "layer": layer,
                               "description": ("Map entry has no standalone Sass identifier; "
                                               f"source path is ${map_name}[{key}]."),
                               "provenance": {"kind": "config", "ref": relative}})

    by_name = {}
    shadowed = []
    for token in tokens:
        previous = by_name.get(token["name"])
        if previous is None or previous["layer"] != "base" and token["layer"] == "base":
            if previous:
                shadowed.append(previous)
            by_name[token["name"]] = token
        else:
            shadowed.append(token)
    kept = sorted(by_name.values(), key=lambda token: (token["layer"] != "base",
                                                        token["family"], token["name"]))
    families = {}
    for token in kept:
        families[token["family"]] = families.get(token["family"], 0) + 1
    document = {
        "standardVersion": STANDARD_VERSION,
        "toolVersion": tool_version(),
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "source": {"strategy": "sass-source", "root": root,
                   "files": [source["source"] for source in sources]},
        "totals": {"tokens": len(kept), "base": sum(t["layer"] == "base" for t in kept),
                   "component": sum(t["layer"] == "component" for t in kept),
                   "shadowed": len(shadowed), "byFamily": families},
        "typeScaling": {"observable": False, "noneScale": None,
                        "reason": "Sass declarations do not state every consuming breakpoint; measure rendered roles."},
        "tokens": kept,
        "shadowed": shadowed,
        "sourcesWithVariables": sorted(sources, key=lambda source: -source["variables"]),
        "problems": [],
    }
    errors = validate(document, "tokens")
    if errors:
        raise ValueError("invalid token artifact: " + "; ".join(errors))
    return document


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("repo")
    parser.add_argument("--output")
    args = parser.parse_args()
    document = extract(args.repo)
    if args.output:
        write_json(args.output, document)
        print(json.dumps({"output": os.path.abspath(args.output), "totals": document["totals"]}))
    else:
        print(json.dumps(document, indent=2))


if __name__ == "__main__":
    main()
