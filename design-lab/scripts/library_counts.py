#!/usr/bin/env python3
"""The one place design-lab counts a library.

The Cover, the Getting Started page (figma_build.py) and the benchmark report (score_run.py)
all take their numbers from `counts()`, so no two surfaces can disagree. The rules:

- The population is the inventory: every component in components.json. Usage rows for
  things that are not components (a block or script the usage scan also saw) are reported
  separately as `outsideInventory`, never mixed into component totals.
- Placements and structural references are the per-component values the usage phase merged
  into components.json (references/model.md). They are never re-summed from usage.json.
- A component's tier is the tier that merge assigned. It is not recomputed from placements,
  because the merge also weighs global and template references.
- Built means the Figma build recorded it: figma/state.json `built`, else the index rows,
  else valid build records. A plan verdict of `build` alone is not built.
- Buildable (eligible) means every inventoried component except retirement candidates and
  schema-only entries, and anything the plan maps into a parent or documents only. The gap
  between built and buildable is split into refused by the plan, planned but not built, and
  not in the plan.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

TIERS = ("High Use", "Medium Use", "Low Use", "Structural Only", "Retirement Candidates")
UNTIERED = "Untiered"
# Tiers a stakeholder reads as "how much the site uses it"; the others are shown only when
# they hold built components, so the breakdown always adds up to the built total.
USE_TIERS = ("High Use", "Medium Use", "Low Use")
GAP_REASONS = {"refused": "refused by the plan", "failed": "planned but not built",
               "unplanned": "not in the plan"}
EXCLUDED_REASONS = {"retirement": "retirement candidate", "schema-only": "schema-only",
                    "not-visual": "mapped or documented, not built as a component"}


def _read(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def short_tier(tier: str | None) -> str:
    return (tier or "").replace("Components — ", "").strip() or UNTIERED


def placements(component: dict) -> int:
    return int((component.get("usage") or {}).get("placements") or 0)


def structural(component: dict) -> int:
    usage = component.get("usage") or {}
    value = usage.get("structuralRefs")
    if value is None:
        value = usage.get("structuralReferences")
    return int(value or 0)


def tier(component: dict) -> str:
    return short_tier((component.get("usage") or {}).get("tier"))


def built_ids(run_dir: Path) -> set[str] | None:
    state = _read(run_dir / "figma" / "state.json") or {}
    if isinstance(state.get("built"), list):
        return set(state["built"])
    index = _read(run_dir / "index.json") or {}
    if index.get("rows"):
        return {row["id"] for row in index["rows"] if row.get("built") and row.get("id")}
    builds = run_dir / "builds"
    ids = {(_read(path) or {}).get("id") for path in sorted(builds.glob("*.json"))} if builds.is_dir() else set()
    ids.discard(None)
    return ids or None


def classify(component: dict, plan: dict | None, built: set[str]) -> tuple[str, str | None]:
    """('built' | a gap reason | an excluded reason, detail)."""
    if component["id"] in built:
        return "built", None
    if plan is None:
        return "unplanned", None
    role, verdict = plan.get("libraryRole"), plan.get("verdict")
    if role in ("retirement", "schema-only"):
        return role, plan.get("refuseReason")
    if verdict in ("map", "document"):
        return "not-visual", plan.get("refuseReason")
    if verdict == "refuse":
        return "refused", plan.get("refuseReason")
    return "failed", None


def counts(run_dir: str | Path, built: set[str] | list[str] | None = None) -> dict | None:
    """Every number the Cover, Getting Started and the report show. None without an inventory."""
    run_dir = Path(run_dir)
    inventory = (_read(run_dir / "components.json") or {}).get("components") or []
    if not inventory:
        return None
    plans = {p.get("id"): p for p in (_read(run_dir / "plan.json") or {}).get("plans") or []}
    known = built_ids(run_dir) if built is None else set(built)
    built_known = known is not None
    known = known or set()
    rows = []
    for c in inventory:
        status, detail = classify(c, plans.get(c["id"]), known)
        rows.append({"id": c["id"], "label": c.get("label") or c["id"], "tier": tier(c),
                     "placements": placements(c), "structural": structural(c),
                     "built": status == "built", "status": status, "detail": detail})
    status_counts = Counter(r["status"] for r in rows)
    excluded = {k: status_counts.get(k, 0) for k in EXCLUDED_REASONS}
    gap = {k: status_counts.get(k, 0) for k in GAP_REASONS}
    found, built_n = len(rows), status_counts.get("built", 0)
    eligible = found - sum(excluded.values())
    total_p = sum(r["placements"] for r in rows)
    total_s = sum(r["structural"] for r in rows)
    tiers_present = [t for t in TIERS if any(r["tier"] == t for r in rows)]
    order = list(TIERS) + sorted({r["tier"] for r in rows} - set(TIERS))
    by_tier = []
    for t in order:
        in_tier = [r for r in rows if r["tier"] == t]
        if not in_tier and t not in TIERS:
            continue
        by_tier.append({"tier": t, "found": len(in_tier), "built": sum(r["built"] for r in in_tier),
                        "notBuilt": sum(not r["built"] for r in in_tier),
                        "placements": sum(r["placements"] for r in in_tier),
                        "structural": sum(r["structural"] for r in in_tier)})
    usage = (_read(run_dir / "usage.json") or {}).get("usage") or {}
    ids = {r["id"] for r in rows}
    outside = [{"id": k, "placements": int(v.get("placements") or 0),
                "structural": int(v.get("structuralRefs") or 0)}
               for k, v in usage.items() if isinstance(v, dict) and k not in ids]
    return {
        "builtKnown": built_known,
        "found": found, "built": built_n, "eligible": eligible,
        "ratio": round(built_n / eligible, 4) if eligible else None,
        "gap": gap, "excluded": excluded,
        "reasonLabels": {**GAP_REASONS, **EXCLUDED_REASONS},
        "notBuilt": [r for r in rows if not r["built"]],
        "placements": {"total": total_p, "covered": sum(r["placements"] for r in rows if r["built"]),
                       "ratio": round(sum(r["placements"] for r in rows if r["built"]) / total_p, 4)
                       if total_p else None},
        "structural": {"total": total_s, "covered": sum(r["structural"] for r in rows if r["built"])},
        "outsideInventory": [o for o in outside if o["placements"] or o["structural"]],
        "tiered": bool(tiers_present),
        "byTier": by_tier,
        "coverBreakdown": cover_breakdown(by_tier),
        "components": rows,
    }


def cover_breakdown(by_tier: list[dict]) -> list[dict]:
    """Built components by usage tier, for the Cover. High, Medium and Low use always; any
    other tier only when it holds built components, so the rows add up to the built total."""
    rows = []
    for row in by_tier:
        if row["tier"] in USE_TIERS or row["built"]:
            rows.append({"tier": row["tier"], "built": row["built"]})
    return rows


def coverage_sentence(c: dict) -> str:
    return (f"Built {c['built']} of {c['eligible']} components it could have built"
            + (f" ({c['ratio'] * 100:.0f}%)" if c.get("ratio") is not None else "") + ".")
