#!/usr/bin/env python3
"""The fonts a site really renders, where each comes from, and what Figma will draw it with.

Every site's font trouble has been its own, so this is a per-run step, never part of setup. It
reads what the browser rendered (the capture measurements: each text node's CSS font stack,
weight and style) and what the site declares (`@font-face` rules, Google Fonts links, Adobe Fonts
kits, Site Studio font libraries), and decides for each stack which family the visitor actually
sees: a declared family with no source is skipped, as the browser skips it; icon fonts and
generic families are set aside.

With the list of fonts Figma can see (recorded by `workflow.py connect` from the runner), each
family is either available, or missing with the route to get it and a stand-in chosen by default.
The run never stops for a font: the person can get the real one and connect again, or live with
the stand-in, which every report then names as a decision, not as a failure.

    fonts.py <run folder>          write <run>/fonts.json and print the summary
"""
from __future__ import annotations

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
                 "ui-serif": "New York", "ui-monospace": "SF Mono"}
ICON = re.compile(r"icomoon|fontawesome|font awesome|\bfa\b|glyphicons|material icons|material symbols|"
                  r"dashicons|swiper-icons|slick|icon", re.I)
# Fonts every Mac has, which Figma desktop sees through its font helper.
SYSTEM_NAMES = {"arial": "Arial", "helvetica": "Helvetica", "helvetica neue": "Helvetica Neue", "times": "Times",
                "times new roman": "Times New Roman", "georgia": "Georgia", "verdana": "Verdana", "courier": "Courier",
                "courier new": "Courier New", "menlo": "Menlo", "monaco": "Monaco", "tahoma": "Tahoma"}
MAC_SYSTEM = {"arial", "arial black", "helvetica", "helvetica neue", "times", "times new roman", "georgia",
              "verdana", "tahoma", "trebuchet ms", "courier", "courier new", "menlo", "monaco", "futura",
              "gill sans", "optima", "palatino", "avenir", "avenir next", "baskerville", "didot", "american typewriter",
              "sf pro", "sf pro text", "sf pro display", "sf mono", "new york", "lucida grande", "geneva"}
STYLE_WORDS = [("extralight", "ExtraLight", 200), ("ultralight", "ExtraLight", 200), ("thin", "Thin", 100),
               ("hairline", "Thin", 100), ("light", "Light", 300), ("book", "Regular", 400), ("regular", "Regular", 400),
               ("normal", "Regular", 400), ("medium", "Medium", 500), ("semibold", "SemiBold", 600),
               ("demibold", "SemiBold", 600), ("demi", "SemiBold", 600), ("extrabold", "ExtraBold", 800),
               ("ultrabold", "ExtraBold", 800), ("bold", "Bold", 700), ("black", "Black", 900), ("heavy", "Black", 900)]
# Stand-ins Figma always has (Google Fonts), chosen so lines break close to where the site's do.
METRIC_COMPATIBLE = {"arial": "Arimo", "helvetica": "Arimo", "helvetica neue": "Arimo", "times new roman": "Tinos",
                     "times": "Tinos", "courier new": "Cousine", "courier": "Cousine", "calibri": "Carlito",
                     "cambria": "Caladea", "georgia": "Gelasio"}
STAND_IN_BY_GENRE = {"sans": "Inter", "serif": "Source Serif 4", "mono": "Roboto Mono", "condensed": "Roboto Condensed"}
# Foundries known from earlier sites: where the person can get a desktop licence or a trial.
FOUNDRIES = {"suisse": ("Swiss Typefaces", "https://www.swisstypefaces.com/fonts/suisse/"),
             "greta": ("Typotheque", "https://www.typotheque.com/help/licensing/testing-fonts")}
SKIP_DIRS = {"node_modules", "vendor", ".git", "contrib", "core", "libraries", "tests", "test", "dist-dev"}
SCAN_SUFFIXES = {".css", ".twig", ".yml", ".yaml", ".html", ".scss"}


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
    return str(style or "").lower() in ("italic", "oblique") or str(style or "").lower().startswith("oblique")


def weight_of(value) -> int:
    try:
        return int(round(float(str(value).split()[0])))
    except (ValueError, IndexError):
        return {"normal": 400, "bold": 700, "lighter": 300, "bolder": 700}.get(str(value).strip().lower(), 400)


# ---- What the browser rendered -------------------------------------------------------------

def rendered_text(run: Path) -> dict:
    """Every (font stack, weight, italic) a text node used, with the components that used it."""
    used = defaultdict(set)
    for path in sorted((run / "capture" / "measurements").glob("*.spec.json")):
        try:
            spec = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        component = path.name[: -len(".spec.json")]
        for measurement in (spec.get("measurements") or {}).values():
            for node in measurement.get("nodes") or []:
                if not str(node.get("text") or "").strip():
                    continue
                c = node.get("computed") or {}
                if not c.get("fontFamily"):
                    continue
                used[(c["fontFamily"], weight_of(c.get("fontWeight")), italic_of(c.get("fontStyle")))].add(component)
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
    """The face a served file holds, from its name (`SuisseIntl-Semibold.woff2` -> SemiBold), else
    from the declared weight; the face, not the number, is what Figma names."""
    stem = norm(Path(filename).stem)
    base = next((style for word, style, _ in STYLE_WORDS if word in stem), None)
    if base is None:
        base = next((style for _, style, w in STYLE_WORDS if w == weight), "Regular")
    if italic or "italic" in stem or "oblique" in stem:
        return "Italic" if base == "Regular" else f"{base} Italic"
    return base


def licence_near(file: Path) -> str | None:
    for folder in (file.parent, file.parent.parent):
        for name in ("OFL.txt", "OFL", "LICENSE.txt", "LICENSE", "LICENCE.txt"):
            candidate = folder / name
            if candidate.is_file():
                text = candidate.read_text(errors="replace")[:4000]
                if "SIL Open Font License" in text or "OFL" in name:
                    return "OFL"
                if "Apache License" in text:
                    return "Apache"
    return None


def declared(repo: Path, sitestudio: Path | None = None) -> dict:
    """The site's font sources: self-hosted faces, Google Fonts families, Adobe Fonts kits."""
    web = next((repo / d for d in ("docroot", "web") if (repo / d).is_dir()), repo)
    roots = [web / "themes" / "custom", web / "modules" / "custom", web / "sites" / "default" / "files" / "cohesion",
             sitestudio]
    faces, google, kits = defaultdict(list), set(), set()
    for path in scan_files([r for r in roots if r]):
        text = path.read_text(errors="replace")
        if path.suffix in (".css", ".scss"):
            for block in re.findall(r"@font-face\s*\{([^}]*)\}", text):
                family = re.search(r"font-family\s*:\s*([^;]+)", block)
                if not family:
                    continue
                name = stack_of(family.group(1))[0]
                weights = re.search(r"font-weight\s*:\s*([^;]+)", block)
                style = re.search(r"font-style\s*:\s*([^;]+)", block)
                urls = re.findall(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", block)
                local = next((u for u in urls if not u.startswith(("http:", "https:", "//", "data:"))), None)
                file = (path.parent / local.split("?")[0].split("#")[0]).resolve() if local else None
                weight_text = (weights.group(1).strip() if weights else "400").split()
                italic = italic_of(style.group(1).strip() if style else "normal")
                for w in {weight_of(weight_text[0]), weight_of(weight_text[-1])}:
                    faces[norm(name)].append({"family": name, "weight": w, "italic": italic,
                                              "file": str(file) if file else (urls[0] if urls else None),
                                              "exists": bool(file and file.is_file()),
                                              "style": face_style(local or name, w, italic),
                                              "licence": licence_near(file) if file and file.is_file() else None,
                                              "declaredIn": str(path)})
        for match in re.findall(r"fonts\.googleapis\.com/css2?\?([^\"'\s)<>]+)", text):
            for value in urllib.parse.parse_qs(match.replace("&amp;", "&")).get("family", []):
                for fam in value.split("|"):
                    google.add(fam.split(":")[0].replace("+", " ").strip())
        for kit in re.findall(r"use\.typekit\.net/([a-z0-9]+)\.(?:css|js)", text):
            kits.add(kit)
    return {"faces": dict(faces), "google": sorted(google), "kits": sorted(kits)}


def adobe_kit(kit: str, timeout: float = 8) -> dict:
    """An Adobe Fonts kit's families from its public endpoint (no login): display name, the CSS
    names a site uses for it, and the variations served. Empty when it cannot be reached."""
    try:
        with urllib.request.urlopen(f"https://typekit.com/api/v1/json/kits/{kit}/published", timeout=timeout) as r:
            value = json.loads(r.read())
    except (OSError, ValueError):
        return {}
    out = {}
    for family in ((value.get("kit") or {}).get("families") or []):
        out[family.get("name")] = {"cssNames": family.get("css_names") or [], "slug": family.get("slug"),
                                   "variations": family.get("variations") or []}
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
    """The face a browser draws for a weight and style, by CSS's font matching: the same style
    first (else the other), then the exact weight; for 400, 500 next; for 500, 400 next; then
    lighter weights for 500 and below, heavier above, before going the other way."""
    if not faces:
        return None
    same = [f for f in faces if f["italic"] == italic] or faces
    weights = sorted({f["weight"] for f in same})
    if weight in weights:
        chosen = weight
    else:
        lighter = [w for w in weights if w < weight][::-1]
        heavier = [w for w in weights if w > weight]
        if weight == 400 and 500 in weights:
            chosen = 500
        elif weight == 500 and 400 in weights:
            chosen = 400
        elif weight <= 500:
            chosen = (lighter + heavier)[0]
        else:
            chosen = (heavier + lighter)[0]
    return next(f for f in same if f["weight"] == chosen)


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


def route(family: str, source: str, faces: list, kit_family: str | None, kit: str | None) -> dict:
    """How the person can make a missing family available to Figma, as concrete steps."""
    if source == "adobe":
        slug = (kit_family or family).lower().replace(" ", "-")
        return {"kind": "adobe-fonts", "steps": [
            f"Open https://fonts.adobe.com/fonts/{slug} signed in with an Adobe account and activate {kit_family or family} "
            f"(it is served by the site's Adobe Fonts kit {kit}).",
            "Quit and reopen Figma desktop, then run workflow.py connect again."]}
    if source == "google":
        return {"kind": "figma-problem", "steps": [
            f"{family} is a Google font, which Figma always has: check that the build runs in Figma desktop through "
            "the design-lab runner, then run workflow.py connect again."]}
    if source == "system":
        return {"kind": "figma-problem", "steps": [
            f"{family} is a macOS font: check it is enabled in Font Book and that the build runs in Figma desktop, "
            "then run workflow.py connect again."]}
    licence = next((f.get("licence") for f in faces if f.get("licence")), None)
    if licence:
        files = sorted({f["file"] for f in faces if f.get("exists")})
        return {"kind": "open-licence", "licence": licence, "steps": [
            f"{family} is under the {licence} licence, which allows installing it: open these files in Font Book and "
            f"install them: {', '.join(files[:6])}.", "Quit and reopen Figma desktop, then run workflow.py connect again."]}
    foundry = next((v for k, v in FOUNDRIES.items() if k in norm(family)), None)
    steps = ["Ask the client (or the agency that set up its brand) for the desktop font files of "
             f"{family} (the styles above) and install them with Font Book."]
    steps.append(f"Or get a desktop licence or trial from {foundry[0]}: {foundry[1]}." if foundry else
                 "Or get a desktop licence or trial from its foundry.")
    steps.append("Quit and reopen Figma desktop, then run workflow.py connect again. The site's own web font files are "
                 "licensed for the website only: do not install them unless the licence says you may.")
    return {"kind": "commercial", "foundry": foundry[0] if foundry else None, "steps": steps}


def plan(run: Path, repo: Path, sitestudio: Path | None, figma: dict | None, fetch_kits: bool = True) -> dict:
    sources = declared(repo, sitestudio)
    kits = {kit: (adobe_kit(kit) if fetch_kits else {}) for kit in sources["kits"]}
    kit_css = {norm(css): (name, kit) for kit, families in kits.items() for name, info in families.items()
               for css in [*info["cssNames"], name]}
    google = {norm(name) for name in sources["google"]}
    families, unrendered, icons = {}, {}, set()
    resolved_stacks = {}
    for (css, weight, italic), components in rendered_text(run).items():
        stack = stack_of(css)
        chosen = None
        for entry in stack:
            key = norm(entry)
            if ICON.search(entry):
                icons.add(entry)
                chosen = ("icon", entry)
                break
            if entry.lower() in GENERIC:
                drawn = GENERIC_DRAWN.get(entry.lower(), "Helvetica")
                chosen = ("system", drawn)
                break
            if key in sources["faces"] and any(f["exists"] or str(f["file"] or "").startswith(("http", "//"))
                                                for f in sources["faces"][key]):
                chosen = ("self-hosted", sources["faces"][key][0]["family"])
                break
            if key in google:
                chosen = ("google", entry)
                break
            if key in kit_css:
                chosen = ("adobe", entry)
                break
            if entry.lower() in MAC_SYSTEM:
                chosen = ("system", entry)
                break
            unrendered.setdefault(entry, {"family": entry, "why": "declared in CSS with no source on the site, so "
                                          "browsers skip it and draw the next family in the stack"})
        if not chosen:
            chosen = ("system", "Times")   # a stack with no usable entry: the browser's default
        source, family = chosen
        resolved_stacks[css] = family if source != "icon" else None
        if source == "icon":
            continue
        family = SYSTEM_NAMES.get(family.lower(), family) if source == "system" else family
        entry = families.setdefault(norm(family), {"family": family, "source": source, "stack": stack,
                                                   "components": set(), "uses": set()})
        entry["components"] |= components
        entry["uses"].add((weight, italic))

    out_families = []
    build = {"families": {}, "stacks": resolved_stacks, "skip": sorted(norm(u) for u in unrendered),
             "icons": sorted(norm(i) for i in icons)}
    for key, entry in sorted(families.items(), key=lambda kv: -len(kv[1]["components"])):
        family, source = entry["family"], entry["source"]
        faces = sources["faces"].get(key, [])
        kit_family, kit = kit_css.get(key, (None, None))
        figma_family = available_family(kit_family or family, figma) if figma is not None else None
        uses = sorted(entry["uses"])
        face_map = {}
        for weight, italic in uses:
            served = css_match(faces, weight, italic)
            if served:
                face_map[f"{weight}|{int(italic)}"] = served["style"]
        display = kit_family or SYSTEM_NAMES.get(family.lower(), family)
        record = {"family": display, "cssFamily": family, "source": source, "components": len(entry["components"]),
                  "uses": [{"weight": w, "italic": i, "face": face_map.get(f"{w}|{int(i)}")} for w, i in uses],
                  "available": None if figma is None else figma_family is not None, "figmaFamily": figma_family}
        if kit:
            record["adobeKit"] = kit
        target = figma_family
        if figma is not None and figma_family is None:
            g = genre(entry["stack"], display)
            stand_in = METRIC_COMPATIBLE.get(display.lower()) or STAND_IN_BY_GENRE[g]
            record["standIn"] = {"family": stand_in, "default": True,
                                 "reason": ("metric-compatible with " + display) if display.lower() in METRIC_COMPATIBLE
                                 else f"a {g} family Figma always has; widths will differ from {display}"}
            record["route"] = route(display, source, faces, kit_family, kit)
            target = stand_in
        out_families.append(record)
        build["families"][key] = {"family": target, "standIn": bool(record.get("standIn")), "faces": face_map}
    return {"families": out_families, "unrendered": sorted(unrendered.values(), key=lambda u: u["family"]),
            "icons": sorted(icons), "kits": sorted(kits), "figmaChecked": figma is not None, "build": build}


def summary_lines(document: dict) -> list[str]:
    families = document.get("families") or []
    if not document.get("figmaChecked"):
        return [f"{len(families)} font famil{'y' if len(families) == 1 else 'ies'} rendered: "
                + ", ".join(f["family"] for f in families) + "; Figma not checked yet (workflow.py connect checks it)."]
    missing = [f for f in families if f.get("standIn")]
    out = [f"{len(families) - len(missing)} of {len(families)} font famil{'y' if len(families) == 1 else 'ies'} available "
           "to Figma" + (": nothing to do." if not missing else ".")]
    for f in missing:
        out.append(f"- {f['family']} ({f['components']} component(s)) is not available to Figma: the build uses "
                   f"{f['standIn']['family']} instead, by default. To use the real font:")
        styles = sorted({u["face"] or f"weight {u['weight']}" + (" italic" if u["italic"] else "") for u in f["uses"]})
        out.append(f"    Styles the site uses: {', '.join(styles)}.")
        out.extend(f"    {step}" for step in f["route"]["steps"])
    if document.get("unrendered"):
        out.append("Declared but never rendered (no source on the site): "
                   + ", ".join(u["family"] for u in document["unrendered"]) + ".")
    if document.get("icons"):
        out.append("Icon fonts, not text: " + ", ".join(document["icons"]) + ".")
    return out


def finalise(document: dict) -> dict:
    """Sets do not survive JSON: the plan as written."""
    return json.loads(json.dumps(document, default=sorted))


if __name__ == "__main__":
    run = Path(sys.argv[1]).resolve()
    project = json.loads((run / "project.json").read_text())
    figma_fonts = run / "figma" / "available-fonts.json"
    figma = json.loads(figma_fonts.read_text()) if figma_fonts.is_file() else None
    doc = finalise(plan(run, Path(project["repository"]["root"]),
                        Path(project["decisions"]["sitestudioConfig"]) if (project.get("decisions") or {}).get("sitestudioConfig") else None,
                        figma))
    (run / "fonts.json").write_text(json.dumps(doc, indent=2) + "\n")
    print("\n".join(summary_lines(doc)))
