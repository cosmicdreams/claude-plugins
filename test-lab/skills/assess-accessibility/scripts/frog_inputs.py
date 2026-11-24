"""Read Screaming Frog SEO Spider exports into plain Python structures.

Export file names are Screaming Frog's tab and filter names in snake_case (verified on
25.1.0). Every CSV starts with a UTF-8 byte-order mark.

Required files in the export folder:
  internal_all.csv            Internal:All (one row per crawled URL, custom extraction columns)
  accessibility_all.csv       Accessibility:All (per-page violation counts)
  all_violations.csv          bulk Accessibility:All Violations (one row per issue per page)
  all_incomplete.csv          bulk Accessibility:All Incomplete (axe "needs review")
Optional:
  custom_extraction_all.csv   Custom Extraction:All, when the extraction columns are not in internal_all.csv
"""
import csv
import re
from pathlib import Path

INVENTORY = ["video", "audio", "captions", "media_iframe", "iframe", "autoplay", "form", "input",
             "personal_input", "search", "accesskey", "meta_refresh"]
REQUIRED = ["internal_all.csv", "accessibility_all.csv", "all_violations.csv", "all_incomplete.csv"]


class ExportError(RuntimeError):
    """The exports cannot support an assessment. The message says why and what to do."""


def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def rule_id(help_url):
    """axe rule id from a Deque help URL such as .../rules/axe/4.10/color-contrast?application=..."""
    path = (help_url or "").split("?")[0].rstrip("/")
    return path.rsplit("/", 1)[-1] if "/rules/" in path else ""


def criteria_in(text):
    """Success criteria named in a Guidelines cell, e.g. 'WCAG 2.1 AA, 1.4.3' -> ['1.4.3']."""
    return sorted(set(re.findall(r"(?<![\d.])([1-4]\.\d{1,2}\.\d{1,2})(?![\d.])", text or "")))


def _extraction_value(row, name):
    """Screaming Frog names extraction columns '<name> 1' (first match) or '<name>'."""
    for key in (f"{name} 1", name):
        if key in row:
            return row[key]
    return None


def _number(value):
    try:
        return float(str(value).strip() or "nan")
    except ValueError:
        return float("nan")


def is_html_200(row):
    return row.get("Status Code") == "200" and "html" in row.get("Content Type", "").lower()


def load(folder):
    folder = Path(folder)
    missing = [n for n in REQUIRED if not (folder / n).is_file()]
    if missing:
        raise ExportError(f"Missing Screaming Frog exports in {folder}: {', '.join(missing)}. "
                          "A missing file means the export failed, never that there were no issues.")

    internal = [r for r in read_csv(folder / "internal_all.csv") if is_html_200(r)]
    if not internal:
        raise ExportError("internal_all.csv has no HTML pages with status 200; the crawl found nothing to assess.")
    extraction = {}
    if (folder / "custom_extraction_all.csv").is_file():
        extraction = {r["Address"]: r for r in read_csv(folder / "custom_extraction_all.csv")}

    pages = {}
    for r in internal:
        src = {**r, **extraction.get(r["Address"], {})}
        inv = {}
        for name in INVENTORY:
            v = _extraction_value(src, name)
            inv[name] = None if v is None else _number(v)
        pages[r["Address"]] = {
            "url": r["Address"],
            "title": r.get("Title 1", ""),
            "depth": int(r.get("Crawl Depth") or 0),
            "body_class": _extraction_value(src, "body_class") or "",
            "inventory": inv,
        }

    a11y = {r["Address"]: r for r in read_csv(folder / "accessibility_all.csv")}
    ran = [u for u in pages if (a11y.get(u, {}).get("All Violations", "") or "").strip() != ""]
    if not ran:
        raise ExportError("Accessibility counts are blank for every page: axe did not run. The config needs "
                          "JavaScript rendering and Extraction > Accessibility turned on.")

    def issues(name):
        out = []
        for r in read_csv(folder / name):
            if r.get("Address") not in pages:
                continue
            out.append({
                "issue": r.get("Issue", ""), "url": r["Address"], "location": r.get("Location on Page", ""),
                "guidelines": r.get("Guidelines", ""), "impact": (r.get("User Impact", "") or "").lower(),
                "rule": rule_id(r.get("Help URL", "")), "help_url": r.get("Help URL", ""),
                "description": r.get("Issue Description", ""), "fix": r.get("How To Fix", ""),
            })
        return out

    return {
        "pages": pages,
        "axe_ran": sorted(ran),
        "violations": issues("all_violations.csv"),
        "incomplete": issues("all_incomplete.csv"),
        "inventory_available": any(v is not None for p in pages.values() for v in p["inventory"].values()),
    }
