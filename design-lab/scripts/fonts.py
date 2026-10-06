#!/usr/bin/env python3
"""The fonts a site really renders, where each comes from, and what Figma will draw it with.

Every site's font trouble has been its own, so this is a per-run step, never part of setup. It
reads what the browser rendered (the capture measurements: each text node's CSS font stack,
weight, style and characters) and what the site declares (`@font-face` rules, Google Fonts links,
Adobe Fonts kits, Site Studio font libraries), and decides for each stack which family the
visitor actually sees: a declared family with no source is skipped, as the browser skips it; a
face limited by `unicode-range` covers only its characters; icon fonts and generic families are
set aside.

With the list of fonts Figma can see (recorded by `workflow.py connect` from the runner), each
family is either available, or missing with the route to get it and a stand-in chosen by default.
The run never stops for a font: the person can get the real one and connect again, or live with
the stand-in, which every report then names as a decision, not as a failure.

    fonts.py <run folder>          write <run>/fonts.json and print the summary
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

GENERIC = {"serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif",
           "ui-monospace", "ui-rounded", "math", "emoji", "fangsong", "-apple-system", "blinkmacsystemfont"}
# What Chrome on macOS draws a generic family with, and what Figma desktop calls those fonts.
GENERIC_DRAWN = {"serif": "Times", "sans-serif": "Helvetica", "monospace": "Courier", "system-ui": "SF Pro",
                 "-apple-system": "SF Pro", "blinkmacsystemfont": "SF Pro", "ui-sans-serif": "SF Pro",
                 "ui-serif": "New York", "ui-monospace": "SF Mono", "cursive": "Apple Chancery", "fantasy": "Papyrus"}
# Icon fonts by name: known families, and a name that is the word "icon" or "icons" on its own.
ICON = re.compile(r"^(icomoon|fontawesome|font ?awesome( \d+)?( (free|pro|brands))?|fa[- ](solid|regular|brands|light)|"
                  r"glyphicons( halflings)?|material (icons|symbols)( \w+)?|dashicons|swiper-icons|slick|ionicons|"
                  r"feather|bootstrap-icons|remixicon|tabler-icons)$|(^|[\s_-])icons?($|[\s_-])", re.I)
SYSTEM_NAMES = {"arial": "Arial", "helvetica": "Helvetica", "helvetica neue": "Helvetica Neue", "times": "Times",
                "times new roman": "Times New Roman", "georgia": "Georgia", "verdana": "Verdana", "courier": "Courier",
                "courier new": "Courier New", "menlo": "Menlo", "monaco": "Monaco", "tahoma": "Tahoma",
                "trebuchet ms": "Trebuchet MS", "futura": "Futura", "gill sans": "Gill Sans", "optima": "Optima",
                "palatino": "Palatino", "avenir": "Avenir", "avenir next": "Avenir Next", "baskerville": "Baskerville",
                "didot": "Didot", "lucida grande": "Lucida Grande", "geneva": "Geneva", "arial black": "Arial Black",
                "american typewriter": "American Typewriter", "sf pro": "SF Pro", "sf mono": "SF Mono",
                "new york": "New York"}
# A file's face, from its name; longer words first, so ExtraLight is not read as Light.
STYLE_WORDS = [("extralight", "ExtraLight", 200), ("ultralight", "ExtraLight", 200), ("semibold", "SemiBold", 600),
               ("demibold", "SemiBold", 600), ("extrabold", "ExtraBold", 800), ("ultrabold", "ExtraBold", 800),
               ("hairline", "Thin", 100), ("thin", "Thin", 100), ("light", "Light", 300), ("book", "Book", 400),
               ("regular", "Regular", 400), ("normal", "Regular", 400), ("medium", "Medium", 500),
               ("demi", "SemiBold", 600), ("heavy", "Heavy", 900), ("black", "Black", 900), ("bold", "Bold", 700)]
# Stand-ins Figma always has (Google Fonts), chosen so lines break close to where the site's do.
METRIC_COMPATIBLE = {"arial": "Arimo", "helvetica": "Arimo", "helvetica neue": "Arimo", "times new roman": "Tinos",
                     "times": "Tinos", "courier new": "Cousine", "courier": "Cousine", "calibri": "Carlito",
                     "cambria": "Caladea", "georgia": "Gelasio"}
# The same design under its other macOS name: Figma desktop leaves some system fonts out of its list
# (Courier, while it offers Courier New), so the other name is the closest stand-in when Figma has it.
SYSTEM_RELATIVE = {"courier": "Courier New", "courier new": "Courier", "times": "Times New Roman",
                   "times new roman": "Times", "helvetica": "Helvetica Neue", "helvetica neue": "Helvetica"}
STAND_IN_BY_GENRE = {"sans": "Inter", "serif": "Source Serif 4", "mono": "Roboto Mono", "condensed": "Roboto Condensed"}
# Listed by Figma on a Mac, never drawn: Apple licenses SF only for its own platforms.
UNDRAWABLE = {"sf pro", "sf pro text", "sf pro display", "sf pro rounded", "sf compact", "sf mono"}
# Foundries known from earlier sites: where the person can get a desktop licence or a trial.
FOUNDRIES = {"suisse": ("Swiss Typefaces", "https://www.swisstypefaces.com/fonts/suisse/"),
             "greta": ("Typotheque", "https://www.typotheque.com/help/licensing/testing-fonts")}
DESKTOP_FORMATS = {".ttf", ".otf"}
SKIP_DIRS = {"node_modules", "vendor", ".git", "contrib", "core", "libraries", "tests", "test", "dist-dev"}
SCAN_SUFFIXES = {".css", ".twig", ".yml", ".yaml", ".html", ".scss", ".json"}


def norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def stack_of(css: str) -> list[str]:
    """`"Suisse Int'l", sans-serif` -> ["Suisse Int'l", "sans-serif"]."""
    out = []
    for part in re.findall(r'"[^"]*"|\'[^\']*\'|[^,]+', css or ""):
        part = part.strip().strip("'\"").strip()
        if part:
            out.append(part)
    return out


def italic_of(style: str) -> bool:
    return str(style or "").strip().lower().startswith(("italic", "oblique"))


def weight_of(value) -> int:
    try:
        return int(round(float(str(value).split()[0])))
    except (ValueError, IndexError):
        return {"normal": 400, "bold": 700, "lighter": 300, "bolder": 700}.get(str(value).strip().lower(), 400)


def is_icon(name: str) -> bool:
    return bool(ICON.search(name.strip()))


def ranges_of(css: str | None) -> list[tuple[int, int]] | None:
    """`unicode-range: U+0000-00FF, U+0131` -> [(0, 255), (305, 305)]; None when unlimited."""
    if not css:
        return None
    out = []
    for part in css.split(","):
        part = part.strip().upper().removeprefix("U+")
        if "?" in part:
            out.append((int(part.replace("?", "0"), 16), int(part.replace("?", "F"), 16)))
        elif "-" in part:
            a, b = part.split("-", 1)
            out.append((int(a, 16), int(b, 16)))
        elif part:
            out.append((int(part, 16), int(part, 16)))
    return out or None


def covers(ranges: list | None, text: str) -> bool:
    if not ranges:
        return True
    return all(any(a <= ord(ch) <= b for a, b in ranges) for ch in text if not ch.isspace())


# ---- What the browser rendered -------------------------------------------------------------

def rendered_text(run: Path) -> dict:
    """Every (font stack, weight, italic) a text node used: the components and the characters."""
    used = defaultdict(lambda: {"components": set(), "chars": set()})
    for path in sorted((run / "capture" / "measurements").glob("*.spec.json")):
        try:
            spec = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        component = path.name[: -len(".spec.json")]
        for measurement in (spec.get("measurements") or {}).values():
            for node in measurement.get("nodes") or []:
                text = str(node.get("text") or "")
                c = node.get("computed") or {}
                if not text.strip() or not c.get("fontFamily"):
                    continue
                entry = used[(c["fontFamily"], weight_of(c.get("fontWeight")), italic_of(c.get("fontStyle")))]
                entry["components"].add(component)
                entry["chars"].update(ch for ch in text if not ch.isspace())
    return used


# ---- What the site declares ----------------------------------------------------------------

def scan_files(roots: list[Path]):
    for root in roots:
        if not root or not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
            for name in filenames:
                path = Path(dirpath) / name
                if path.suffix in SCAN_SUFFIXES and path.stat().st_size < 3_000_000:
                    yield path


def face_style(filename: str, weight: int, italic: bool) -> str:
    """The face a served file holds, from its name (`Brand-Semibold.woff2` -> SemiBold), else from
    the declared weight; the face, not the number, is what Figma names."""
    stem = norm(Path(filename).stem) if filename else ""
    base = next((style for word, style, _ in STYLE_WORDS if word in stem), None)
    if base is None:
        base = {100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold",
                700: "Bold", 800: "ExtraBold", 900: "Black"}.get(round(weight / 100) * 100, "Regular")
    if italic or "italic" in stem or "oblique" in stem:
        return "Italic" if base == "Regular" else f"{base} Italic"
    return base


def licence_of(file: Path) -> str | None:
    """The open licence a font file is covered by: a licence file in its own folder."""
    for name in ("OFL.txt", "OFL", "OFL.md", "LICENSE.txt", "LICENSE", "LICENCE.txt"):
        candidate = file.parent / name
        if candidate.is_file():
            text = candidate.read_text(errors="replace")[:4000]
            if "SIL Open Font License" in text or name.startswith("OFL"):
                return "OFL"
            if "Apache License" in text:
                return "Apache"
    return None


def unescape(text: str) -> str:
    """Configuration stores CSS and links inside YAML and JSON strings: undo their escaping."""
    return html.unescape(text.replace("\\/", "/").replace('\\"', '"').replace("\\n", "\n"))


def declared(repo: Path, sitestudio: Path | None = None) -> dict:
    """The site's font sources: self-hosted faces, Google Fonts families, Adobe Fonts kits."""
    web = next((repo / d for d in ("docroot", "web") if (repo / d).is_dir()), repo)
    roots = [web / "themes" / "custom", web / "modules" / "custom", web / "sites" / "default" / "files" / "cohesion",
             sitestudio]
    faces, google, kits = defaultdict(list), set(), set()
    for path in scan_files([r for r in roots if r]):
        text = unescape(path.read_text(errors="replace"))
        for block in re.findall(r"@font-face\s*\{([^}]*)\}", text):
            family = re.search(r"font-family\s*:\s*([^;]+)", block)
            if not family:
                continue
            name = stack_of(family.group(1))[0]
            weights = re.search(r"font-weight\s*:\s*([^;]+)", block)
            style = re.search(r"font-style\s*:\s*([^;]+)", block)
            ranges = re.search(r"unicode-range\s*:\s*([^;]+)", block)
            urls = re.findall(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", block)
            source = next((u for u in urls if not u.startswith("data:")), None)
            remote = bool(source and source.startswith(("http:", "https:", "//")))
            file = (path.parent / source.split("?")[0].split("#")[0]).resolve() if source and not remote else None
            declared_weights = weights.group(1).split() if weights else ["400"]   # "400" or a range "200 800"
            low, high = weight_of(declared_weights[0]), weight_of(declared_weights[-1])
            italic = italic_of(style.group(1) if style else "normal")
            basename = Path(urllib.parse.urlparse(source).path).name if source else ""
            faces[norm(name)].append({
                "family": name, "weight": low, "weightMax": high, "variable": high != low, "italic": italic,
                "file": str(file) if file else source, "exists": bool(file and file.is_file()) or remote,
                "style": face_style(basename or name, low, italic),
                "licence": licence_of(file) if file and file.is_file() else None,
                "desktop": Path(basename).suffix.lower() in DESKTOP_FORMATS,
                "ranges": ranges_of(ranges.group(1)) if ranges else None, "declaredIn": str(path)})
        for match in re.findall(r"fonts\.googleapis\.com/css2?\?([^\"'\s)<>]+)", text):
            for value in urllib.parse.parse_qs(match).get("family", []):
                for fam in value.split("|"):
                    google.add(fam.split(":")[0].replace("+", " ").strip())
        for kit in re.findall(r"use\.typekit\.net/([a-z0-9]+)\.(?:css|js)", text):
            kits.add(kit)
    return {"faces": dict(faces), "google": sorted(google), "kits": sorted(kits)}


def adobe_kit(kit: str, timeout: float = 8) -> dict | None:
    """An Adobe Fonts kit's families from its public endpoint (no login): display name, the CSS
    names a site uses for it, its slug on fonts.adobe.com, and the variations served. None when
    the endpoint cannot be reached, which is not the same as a kit with no families."""
    try:
        with urllib.request.urlopen(f"https://typekit.com/api/v1/json/kits/{kit}/published", timeout=timeout) as r:
            value = json.loads(r.read())
    except (OSError, ValueError):
        return None
    out = {}
    for family in ((value.get("kit") or {}).get("families") or []):
        out[family.get("name")] = {"cssNames": family.get("css_names") or [], "slug": family.get("slug"),
                                   "variations": family.get("variations") or []}
    return out


def kits_for(run: Path, ids: list[str]) -> dict:
    """Each kit's families, fetched once and kept in the run, so a later step works offline. A
    kit that could not be reached stays None."""
    cache_path = run / "fonts-kits.json"
    try:
        cache = json.loads(cache_path.read_text())
    except (OSError, ValueError):
        cache = {}
    out = {}
    for kit in ids:
        if cache.get(kit) is None:
            fetched = adobe_kit(kit)
            if fetched is not None:
                cache[kit] = fetched
        out[kit] = cache.get(kit)
    if cache:
        cache_path.write_text(json.dumps(cache, indent=2) + "\n")
    return out


# ---- Which family the visitor sees, and what Figma draws it with ----------------------------

def genre(stack: list[str], family: str) -> str:
    names = " ".join(stack).lower()
    if "condensed" in family.lower():
        return "condensed"
    if "monospace" in names or "mono" in family.lower():
        return "mono"
    tail = [s.lower() for s in stack if s.lower() in GENERIC]
    if tail and tail[0] == "serif":
        return "serif"
    if any(k in family.lower() for k in ("serif", "text pro", "garamond", "caslon", "freight text", "georgia", "times")) \
            and "sans" not in family.lower():
        return "serif"
    return "sans"


def css_match(faces: list, weight: int, italic: bool) -> dict | None:
    """The face a browser draws for a weight and style, by the CSS Fonts 4 matching rules: the
    same style first (else the other); a face whose weight range holds the weight; else, for a
    weight from 400 to 500, the weights above it up to 500, then below it, then above 500; below
    400, lighter then heavier; above 500, heavier then lighter."""
    if not faces:
        return None
    same = [f for f in faces if f["italic"] == italic] or faces
    for face in same:
        if face["weight"] <= weight <= face.get("weightMax", face["weight"]):
            return face
    weights = sorted({f["weight"] for f in same} | {f.get("weightMax", f["weight"]) for f in same})
    lighter = [w for w in weights if w < weight][::-1]
    heavier = [w for w in weights if w > weight]
    if 400 <= weight <= 500:
        order = [w for w in heavier if w <= 500] + lighter + [w for w in heavier if w > 500]
    elif weight < 400:
        order = lighter + heavier
    else:
        order = heavier + lighter
    chosen = order[0]
    return next(f for f in same if f["weight"] <= chosen <= f.get("weightMax", f["weight"]))


def available_family(family: str, figma: dict) -> str | None:
    """The Figma family for a CSS family: exact, then ignoring case and punctuation, then with a
    trial or web suffix (Suisse Intl Trial), or without a Pro/Std one."""
    if family in figma:
        return family
    by_key = {norm(name): name for name in figma}
    key = norm(family)
    if key in by_key:
        return by_key[key]
    for suffix in ("trial", "web", "pro", "std", "text"):
        if key + suffix in by_key:
            return by_key[key + suffix]
        if key.endswith(suffix) and key[: -len(suffix)] in by_key:
            return by_key[key[: -len(suffix)]]
    return None


def route(family: str, source: str, faces: list, adobe: dict | None) -> dict:
    """How the person can make a missing family available to Figma, as concrete steps."""
    if source == "adobe":
        slug = (adobe or {}).get("slug") or family.lower().replace(" ", "-")
        kit = (adobe or {}).get("kit")
        return {"kind": "adobe-fonts", "steps": [
            f"Open https://fonts.adobe.com/fonts/{slug} signed in with an Adobe account and activate {family}"
            + (f" (it is served by the site's Adobe Fonts kit {kit})." if kit else "."),
            "Quit and reopen Figma desktop, open the target file again and start the design-lab runner, then tell Claude, which connects again and redraws with the real font."]}
    if source == "system":
        return {"kind": "figma-omits", "steps": [],
                "note": f"{family} comes with macOS, but Figma desktop leaves it out of its font list, so there is "
                        "nothing to install: the stand-in is the closest font Figma offers."}
    if source == "google":
        return {"kind": "figma-problem", "steps": [
            f"{family} is a Google font, which Figma always has: check that the build runs in Figma desktop "
            "through the design-lab runner, then tell Claude, which connects again."]}
    covered = [f for f in faces if f.get("licence")]
    if faces and len(covered) == len(faces):
        licence = covered[0]["licence"]
        desktop = sorted({f["file"] for f in covered if f.get("desktop")})
        web = sorted({f["file"] for f in covered if not f.get("desktop")})
        steps = []
        if desktop:
            steps.append(f"Open these files in Font Book and install them: {', '.join(desktop[:6])}.")
        if web:
            steps.append(f"These are web font files, which macOS cannot install as they are: convert each to TTF first "
                         f"(for example `python3 -m fontTools.ttLib.woff2 decompress <file>`, after "
                         f"`python3 -m pip install fonttools brotli`), then install the TTF files: {', '.join(web[:6])}.")
        steps.append("Quit and reopen Figma desktop, open the target file again and start the design-lab runner, then tell Claude, which connects again and redraws with the real font.")
        return {"kind": "open-licence", "licence": licence,
                "note": f"{family} is under the {licence} licence, which allows installing it.", "steps": steps}
    foundry = next((v for k, v in FOUNDRIES.items() if k in norm(family)), None)
    return {"kind": "commercial", "foundry": foundry[0] if foundry else None, "steps": [
        "Ask the client (or the agency that set up its brand) for the desktop font files of "
        f"{family} (the styles above) and install them with Font Book.",
        f"Or get a desktop licence or trial from {foundry[0]}: {foundry[1]}." if foundry else
        "Or get a desktop licence or trial from its foundry.",
        "Quit and reopen Figma desktop, open the target file again and start the design-lab runner, then tell Claude, "
        "which connects again and redraws with the real font. The site's own web font files are licensed for the "
        "website only: do not install them unless the licence says you may."]}


def choose(stack: list[str], chars: set, sources: dict, google: set, kit_css: dict, kits_unread: bool,
           unrendered: dict, icons: set) -> tuple[str, str] | None:
    """The family the browser draws this text in: the first entry that is served and covers it."""
    for entry in stack:
        key = norm(entry)
        if is_icon(entry):
            icons.add(entry)
            return ("icon", entry)
        if entry.lower() in GENERIC:
            return ("system", GENERIC_DRAWN.get(entry.lower(), "Helvetica"))
        faces = sources["faces"].get(key)
        if faces and any(f["exists"] for f in faces):
            ranges = [r for f in faces for r in (f.get("ranges") or [(0, 0x10FFFF)])]
            if not chars or any(covers(ranges, ch) for ch in chars):
                return ("self-hosted", faces[0]["family"])
            continue   # none of this text is in the family's ranges: the browser uses the next family
        if key in google:
            return ("google", entry)
        if key in kit_css:
            return ("adobe", entry)
        if entry.lower() in SYSTEM_NAMES:
            return ("system", SYSTEM_NAMES[entry.lower()])
        if kits_unread and not faces:
            # An Adobe kit could not be read, and this family may be in it: keep it rather than
            # guess the browser skipped it.
            return ("adobe", entry)
        unrendered.setdefault(entry, {"family": entry, "why": "declared in CSS with no source on the site, so "
                                      "browsers skip it and draw the next family in the stack"})
    return None


def plan(run: Path, repo: Path, sitestudio: Path | None, figma: dict | None) -> dict:
    sources = declared(repo, sitestudio)
    kits = kits_for(run, sources["kits"])
    kits_unread = any(v is None for v in kits.values())
    kit_css = {norm(css): {"name": name, "kit": kit, "slug": info.get("slug")}
               for kit, families in kits.items() if families for name, info in families.items()
               for css in [*info["cssNames"], name]}
    google = {norm(name) for name in sources["google"]}
    families, unrendered, icons = {}, {}, set()
    stacks = {}
    for (css, weight, italic), used in rendered_text(run).items():
        stack = stack_of(css)
        chosen = choose(stack, used["chars"], sources, google, kit_css, kits_unread, unrendered, icons) \
            or ("system", "Times")   # nothing usable: the browser's default
        source, family = chosen
        if source == "icon":
            stacks[css] = {"icon": family}
            continue
        # Text a self-hosted family's ranges do not cover is drawn in the next family that serves it.
        stacks.setdefault(css, {"family": family})
        if source == "self-hosted":
            ranges = [r for f in sources["faces"][norm(family)] for r in (f.get("ranges") or [(0, 0x10FFFF)])]
            stacks[css]["ranges"] = ranges if any(r != (0, 0x10FFFF) for r in ranges) else None
            if stacks[css]["ranges"]:
                rest = stack[stack.index(next(s for s in stack if norm(s) == norm(family))) + 1:]
                other = choose(rest, set(), sources, google, kit_css, kits_unread, {}, set())
                stacks[css]["otherwise"] = other[1] if other else "Helvetica"
        entry = families.setdefault(norm(family), {"family": family, "source": source, "stack": stack,
                                                   "components": set(), "uses": set()})
        entry["components"] |= used["components"]
        entry["uses"].add((weight, italic))

    out_families = []
    build = {"families": {}, "stacks": stacks, "skip": sorted(norm(u) for u in unrendered),
             "icons": sorted(norm(i) for i in icons)}
    for key, entry in sorted(families.items(), key=lambda kv: -len(kv[1]["components"])):
        family, source = entry["family"], entry["source"]
        faces = sources["faces"].get(key, [])
        adobe = kit_css.get(key)
        display = (adobe or {}).get("name") or family
        figma_family = available_family(display, figma) if figma is not None else None
        # Figma lists Apple's system SF families on a Mac but draws their text blank (in
        # exports and for every other viewer), so the build must use a stand-in for them.
        if display.lower() in UNDRAWABLE:
            figma_family = None
        face_map, variable = {}, {}
        for weight, italic in sorted(entry["uses"]):
            served = css_match(faces, weight, italic)
            if served and served.get("variable"):
                variable[f"{weight}|{int(italic)}"] = weight   # drawn on the weight axis, not a named face
            elif served:
                face_map[f"{weight}|{int(italic)}"] = served["style"]
        record = {"family": display, "cssFamily": family, "source": source, "components": len(entry["components"]),
                  "uses": [{"weight": w, "italic": i, "face": face_map.get(f"{w}|{int(i)}")}
                           for w, i in sorted(entry["uses"])],
                  "available": None if figma is None else figma_family is not None, "figmaFamily": figma_family}
        if adobe:
            record["adobeKit"] = adobe["kit"]
        if source == "adobe" and not adobe:
            record["note"] = "the site's Adobe Fonts kit could not be read; treated as one of its families"
        target = figma_family
        if figma is not None and figma_family is None:
            g = genre(entry["stack"], display)
            relative = SYSTEM_RELATIVE.get(display.lower()) if source == "system" else None
            relative = relative and available_family(relative, figma)
            stand_in = relative or METRIC_COMPATIBLE.get(display.lower()) or STAND_IN_BY_GENRE[g]
            record["standIn"] = {"family": stand_in, "default": True,
                                 "reason": (f"the same design as {display} under its other macOS name") if relative
                                 else ("metric-compatible with " + display) if display.lower() in METRIC_COMPATIBLE
                                 else f"a {g} family Figma always has; widths will differ from {display}"}
            record["route"] = route(display, source, faces, adobe)
            target = stand_in
        out_families.append(record)
        build["families"][key] = {"family": target, "standIn": bool(record.get("standIn")), "faces": face_map,
                                  "variable": variable, "display": display}
    return {"families": out_families, "unrendered": sorted(unrendered.values(), key=lambda u: u["family"]),
            "icons": sorted(icons), "kits": {k: v is not None for k, v in kits.items()},
            "figmaChecked": figma is not None, "build": build}


def summary_lines(document: dict) -> list[str]:
    families = document.get("families") or []
    if not document.get("figmaChecked"):
        return [f"{len(families)} font famil{'y' if len(families) == 1 else 'ies'} rendered: "
                + ", ".join(f["family"] for f in families) + "; Figma not checked yet (workflow.py connect checks it)."]
    missing = [f for f in families if f.get("standIn")]
    out = [f"{len(families) - len(missing)} of {len(families)} font famil{'y' if len(families) == 1 else 'ies'} available "
           "to Figma" + (": nothing to do." if not missing else ".")]
    for f in missing:
        out.append(f"- {f['family']} (in {f['components']} captured component(s)) is not available to Figma: the build uses "
                   f"{f['standIn']['family']} instead, by default." + (" To use the real font:" if f["route"]["steps"] else ""))
        styles = sorted({u["face"] or f"weight {u['weight']}" + (" italic" if u["italic"] else "") for u in f["uses"]})
        out.append(f"    Styles the site uses: {', '.join(styles)}.")
        if f["route"].get("note"):
            out.append(f"    {f['route']['note']}")
        out.extend(f"    {step}" for step in f["route"]["steps"])
    if document.get("unrendered"):
        out.append("Declared but never rendered (no source on the site): "
                   + ", ".join(u["family"] for u in document["unrendered"]) + ".")
    if document.get("icons"):
        out.append("Icon fonts, drawn as text in the library: " + ", ".join(document["icons"]) + ".")
    unread = [k for k, ok in (document.get("kits") or {}).items() if not ok]
    if unread:
        out.append(f"The Adobe Fonts kit {', '.join(unread)} could not be read; its families are kept as the site's.")
    return out


def finalise(document: dict) -> dict:
    """Sets and tuples do not survive JSON: the plan as written."""
    return json.loads(json.dumps(document, default=sorted))


if __name__ == "__main__":
    run = Path(sys.argv[1]).resolve()
    project = json.loads((run / "project.json").read_text())
    figma_fonts = run / "figma" / "available-fonts.json"
    figma = json.loads(figma_fonts.read_text()) if figma_fonts.is_file() else None
    folder = (project.get("decisions") or {}).get("sitestudioConfig")
    doc = finalise(plan(run, Path(project["repository"]["root"]), Path(folder) if folder else None, figma))
    (run / "fonts.json").write_text(json.dumps(doc, indent=2) + "\n")
    print("\n".join(summary_lines(doc)))
