#!/usr/bin/env python3
"""Shared run metrics for the benchmark and the evaluation ledger."""
from __future__ import annotations

import json
import re
import statistics
from collections import Counter, defaultdict
from pathlib import Path

import library_counts

BREAKPOINTS = ("desktop", "tablet", "mobile")


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def not_measured(reason, how=None, **extra):
    return {"status": "not-measured", "reason": reason,
            **({"howToMeasure": how} if how else {}), **extra}


def median(values):
    return round(statistics.median(values), 4) if values else None


def quantile(values, q):
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return round(ordered[index], 4)


def score_coverage(run_dir: Path) -> dict:
    """Built out of what the run could have built; every number from library_counts.py, the
    module the Figma Cover and Getting Started page are drawn from."""
    c = library_counts.counts(run_dir)
    if c is None:
        return not_measured("no components.json, so nothing says what the source holds")
    if not c["builtKnown"]:
        return not_measured("no Figma build state, index or build records, so nothing says what was built",
                            "let the build write its receipts (figma_build.py receipts)")
    section = {"status": "measured", "found": c["found"], "eligible": c["eligible"], "built": c["built"],
               "ratio": c["ratio"], "gap": c["gap"], "excluded": c["excluded"],
               "reasonLabels": c["reasonLabels"], "summary": library_counts.coverage_sentence(c),
               "items": [{"id": r["id"], "label": r["label"], "reason": r["status"], "detail": r["detail"]}
                         for r in c["notBuilt"]],
               "byTier": c["byTier"], "coverBreakdown": c["coverBreakdown"],
               "outsideInventory": c["outsideInventory"]}
    p = c["placements"]
    if p["total"]:
        section["usageWeighted"] = {"placements": p["total"], "covered": p["covered"], "ratio": p["ratio"],
                                    "structuralRefs": c["structural"]["total"],
                                    "structuralCovered": c["structural"]["covered"]}
    else:
        section["usageWeighted"] = not_measured("no usage placements were recorded for this run")
    return section


# ---------------------------------------------------------------------------- conformance

def score_conformance(run_dir: Path, project: dict | None) -> dict:
    report_path = None
    for artifact in ((project or {}).get("artifacts") or {}).values():
        if artifact.get("kind") == "verify-report":
            report_path = (run_dir / artifact["path"]).resolve()
    report_path = report_path or run_dir / "verify-report.json"
    report = read_json(report_path)
    if not report:
        status = (((project or {}).get("phases") or {}).get("verify") or {}).get("status")
        return not_measured(f"no verification report; the verify phase is {status or 'unrecorded'}",
                            "run design-lab:verify and register verify-report.json")
    open_items = report.get("open") or []
    severities = Counter(item.get("severity") or "unrated" for item in open_items)
    return {"status": "measured",
            "summary": f"{len(open_items)} open finding(s), {len(report.get('waived') or [])} waived.",
            "open": {s: severities.get(s, 0) for s in ("blocker", "major", "minor")},
            "openOther": sum(v for k, v in severities.items() if k not in ("blocker", "major", "minor")),
            "waived": len(report.get("waived") or []),
            "passed": len(report.get("passed") or []),
            "inapplicable": len(report.get("inapplicable") or []),
            "completeness": report.get("completeness") or {},
            "findings": [{"severity": item.get("severity"), "check": item.get("check") or item.get("id"),
                          "message": item.get("message") or item.get("detail")}
                         for item in open_items[:40]]}


# ---------------------------------------------------------------------------- accuracy

def breakpoint_of(label: str, index: int, count: int) -> str:
    match = re.search(r"(desktop|tablet|mobile)", label or "", re.I)
    if match:
        return match.group(1).lower()
    return ("mobile", "tablet", "desktop")[index] if count == 3 else f"width-{index}"


def accuracy_pairs(run_dir: Path) -> list[dict]:
    import figma_compare
    labels = {c.get("id"): c.get("label") for c in
              (read_json(run_dir / "components.json") or {}).get("components") or []}
    pairs = []
    for block in sorted((run_dir / "figma" / "results").glob("block_*.json")):
        component = block.stem[len("block_"):]
        specimen = run_dir / "figma" / "compare" / f"{component}.png"
        geometry = (read_json(block) or {}).get("geometry") or {}
        if not specimen.is_file() or not geometry.get("variants"):
            continue
        original = figma_compare.compare(specimen, geometry)
        corrected = figma_compare.compare(specimen, geometry, corrected=True)
        captures = geometry.get("captures") or []
        variants = geometry.get("variants") or []
        for index, (old, new) in enumerate(zip(original["pairs"], corrected["pairs"])):
            capture = captures[index] if index < len(captures) else {}
            variant = variants[index] if index < len(variants) else {}
            pairs.append({
                "component": component, "label": labels.get(component) or component,
                "breakpoint": breakpoint_of(capture.get("label", ""), index, len(captures)),
                "width": round(capture.get("width") or new["width"]),
                "original": {"ratio": old["ratio"], "pass": old["pass"]},
                "corrected": {"ratio": new["ratio"], "pass": new["pass"]},
                "heightDelta": new["heightDelta"], "widthDelta": new["widthDelta"],
                "figmaHeight": variant.get("height"), "liveHeight": capture.get("height"),
                "evidence": {"specimen": str(specimen.relative_to(run_dir)),
                             "geometry": str(block.relative_to(run_dir)), "index": index},
            })
    return pairs


def recorded_pairs(run_dir: Path) -> list[dict]:
    """Fallback: the original-metric results already stored in build records."""
    pairs = []
    for record in sorted((run_dir / "builds").glob("*.json")):
        data = read_json(record) or {}
        metrics = ((data.get("visualEvidence") or {}).get("comparison") or {}).get("metrics") or {}
        items = metrics.get("pairs") or []
        for index, pair in enumerate(items):
            pairs.append({"component": data.get("id") or record.stem, "label": data.get("id") or record.stem,
                          "breakpoint": breakpoint_of(pair.get("label", ""), index, len(items)),
                          "width": pair.get("width"),
                          "original": {"ratio": pair.get("ratio"), "pass": pair.get("pass")},
                          "corrected": None, "heightDelta": pair.get("heightDelta"),
                          "widthDelta": None, "evidence": None})
    return pairs


def summarise(pairs: list[dict], metric: str) -> dict:
    rows = [p for p in pairs if p.get(metric)]
    ratios = [p[metric]["ratio"] for p in rows]
    return {"pass": sum(1 for p in rows if p[metric]["pass"]), "total": len(rows),
            "medianRatio": median(ratios), "p75Ratio": quantile(ratios, 0.75),
            "maxRatio": max(ratios) if ratios else None}


def score_accuracy(run_dir: Path) -> dict:
    import figma_compare
    pairs, source = [], "recomputed from specimen screenshots"
    try:
        pairs = accuracy_pairs(run_dir)
    except ImportError as error:           # Pillow missing
        source = f"recorded results only ({error})"
    if not pairs:
        pairs = recorded_pairs(run_dir)
        source = "original metric as recorded in build records"
    if not pairs:
        return not_measured("no specimen screenshots (figma/compare) or comparison results",
                            "let the runner finish its compare steps, which save both")
    by_breakpoint = {}
    names = [b for b in BREAKPOINTS if any(p["breakpoint"] == b for p in pairs)]
    names += sorted({p["breakpoint"] for p in pairs} - set(names))
    for name in names:
        subset = [p for p in pairs if p["breakpoint"] == name]
        heights = [p["heightDelta"] for p in subset if p.get("heightDelta") is not None]
        by_breakpoint[name] = {
            "original": summarise(subset, "original"),
            "corrected": summarise(subset, "corrected") if subset[0].get("corrected") else None,
            "heightDelta": {"median": median(heights), "max": max(heights) if heights else None,
                            "over10px": sum(1 for h in heights if h > 10)},
        }
    components = defaultdict(dict)
    for pair in pairs:
        components[pair["component"]][pair["breakpoint"]] = pair
    corrected = pairs[0].get("corrected") is not None
    section = {
        "status": "measured" if corrected else "partial",
        "source": source,
        "threshold": figma_compare.THRESHOLD, "tolerance": figma_compare.TOLERANCE,
        "metrics": {
            "original": "Shared top-left area only; greyscale difference over the tolerance. "
                        "Kept so earlier results stay comparable.",
            "corrected": "Larger of the two boxes; area only one side covers counts as changed; "
                         "tolerance applied per colour channel.",
        },
        "overall": {"original": summarise(pairs, "original"),
                    "corrected": summarise(pairs, "corrected") if corrected else None},
        "byBreakpoint": by_breakpoint,
        "components": len(components),
        "pairs": pairs,
    }
    if not corrected:
        section["reason"] = "specimen screenshots are missing, so only the original metric is available"
    return section


def coverage(run_dir: Path) -> dict:
    section = score_coverage(Path(run_dir))
    if section["status"] != "measured":
        return section
    return {"built": section["built"], "inventoried": section["found"],
            "buildable": section["eligible"], "ratio": section["ratio"],
            "placementShare": section["usageWeighted"].get("ratio")}


def corrected_widths(run_dir: Path, accuracy=None):
    section = accuracy if accuracy is not None else score_accuracy(Path(run_dir))
    return (section.get("overall") or {}).get("corrected")


def original_widths(run_dir: Path, accuracy=None):
    section = accuracy if accuracy is not None else score_accuracy(Path(run_dir))
    return (section.get("overall") or {}).get("original")


def open_findings(run_dir: Path):
    section = score_conformance(Path(run_dir), read_json(Path(run_dir) / "project.json"))
    return ({**section["open"], "other": section["openOther"]}
            if section["status"] == "measured" else None)


def tokens(run_dir: Path, cost=None):
    cost = cost if cost is not None else ((read_json(Path(run_dir) / "benchmark/scorecard.json") or {})
                                            .get("sections") or {}).get("cost", {})
    model = cost.get("model") or {}
    return model.get("tokens") if model.get("status") == "measured" else None


def elapsed_time(run_dir: Path, cost=None):
    cost = cost if cost is not None else ((read_json(Path(run_dir) / "benchmark/scorecard.json") or {})
                                            .get("sections") or {}).get("cost", {})
    return {key: cost.get(key) for key in ("clock", "working", "runner") if cost.get(key)} or None


def metrics(run_dir: Path) -> dict:
    accuracy = score_accuracy(Path(run_dir))
    return {"coverage": coverage(run_dir), "correctedWidths": corrected_widths(run_dir, accuracy),
            "originalWidths": original_widths(run_dir, accuracy), "openFindings": open_findings(run_dir),
            "tokens": tokens(run_dir), "time": elapsed_time(run_dir)}
