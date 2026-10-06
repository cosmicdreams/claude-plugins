#!/usr/bin/env python3
"""Drive a whole Figma library build as a fixed sequence of steps.

The model's only job during a build is to relay: ask for the next step, send its payload to
Figma (or upload its files), and record what came back. Every decision — which pages exist,
their order, what every panel says, where every component goes, which image fills which
rectangle — is made here, from the artifacts, by rule. Two runs over the same artifacts ask
Figma for the same things in the same order.

  figma_build.py init   --project W --file-key KEY --site-url URL --canonical-base-url URL
  figma_build.py next   --project W        # prints the next step as JSON
  figma_build.py record --project W --step ID --result result.json
  figma_build.py status --project W

A step is one of:
  {"kind": "use_figma", "step": id, "payload": path}      send the file's contents verbatim
  {"kind": "upload", "step": id, "nodeIds": [...], "files": [{file, contentType}], "scaleMode"}
  {"kind": "done"}
State lives in W/figma/state.json; results in W/figma/results/<step>.json. A recorded step is
never re-planned, so a resumed build continues where it stopped.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import render_payload  # noqa: E402
import spec_to_tree  # noqa: E402
import responsive  # noqa: E402
import library_counts  # noqa: E402  the one source of every count on Cover and Getting Started

STANDARD_VERSION = "4.1.0"
TIERS = ["High Use", "Medium Use", "Low Use", "Structural Only", "Retirement Candidates"]
TIER_PAGES = [f"Components — {t}" for t in TIERS]
FOUNDATION_ORDER = ["Color", "Typography", "Spacing & Layout", "Elevation & Shape"]
BREAKPOINTS = ["mobile", "tablet", "desktop"]
PARKING_Y = -6000  # masters are built off-canvas, then moved into their block
VIEWPORTS = {"Desktop": 1400, "Tablet": 800, "Mobile": 375}  # measure.mjs defaults
COLUMN_ORDER = ("Mobile", "Tablet", "Desktop")  # specimen columns, narrowest first


# ---------------------------------------------------------------- artifacts

def load(project: Path, name: str, default=None):
    path = project / name
    if not path.exists():
        if default is not None:
            return default
        raise SystemExit(f"missing artifact: {path}")
    return json.loads(path.read_text())


def short_tier(tier: str | None) -> str:
    return library_counts.short_tier(tier)


def components(project: Path) -> list[dict]:
    return [_with_capture_path(project, c) for c in _components(project)]


def _with_capture_path(project: Path, c: dict) -> dict:
    """A component captured inside its parent (no example page of its own) is shown on the
    parent's page; that page is its example."""
    evidence = load(project, "capture-evidence.json", {"captures": {}}).get("captures", {}).get(c["id"]) or {}
    if evidence.get("path") and any("data-design-lab-child" in (img.get("selector") or "") for img in [evidence]):
        return {**c, "_capturePath": evidence["path"]}
    return c


def _components(project: Path) -> list[dict]:
    return load(project, "components.json")["components"]


def tier_names(comps: list[dict]) -> list[str]:
    """The tier pages this library has. With no usage tier on any component there is no usage
    source, and the standard (library-standard.md, pages) collapses the five tier pages into
    one `Components — Untiered`. Otherwise the five always exist, plus `Untiered` when some
    component has no tier, so every component has a page to live on."""
    tiers = {short_tier((c.get("usage") or {}).get("tier")) for c in comps}
    if tiers <= {"Untiered"}:
        return ["Untiered"]
    return TIERS + (["Untiered"] if "Untiered" in tiers else [])


def plans(project: Path) -> dict[str, dict]:
    return {p["id"]: p for p in load(project, "plan.json", {"plans": []}).get("plans", [])}


def site_name(repo: Path) -> str:
    cfg = next(iter(sorted(repo.glob("config/*/system.site.yml"))), None)
    if cfg:
        m = re.search(r"^name:\s*'?(.+?)'?\s*$", cfg.read_text(), re.M)
        if m:
            return m.group(1)
    return repo.name


def repo_root(project: Path) -> Path:
    r = load(project, "project.json").get("repository")
    return Path(r["root"] if isinstance(r, dict) else r or ".")


def git_commit(repo: Path) -> str:
    try:
        return subprocess.run(["git", "-C", str(repo), "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "unknown"


def placements(c: dict) -> int:
    return library_counts.placements(c)


def structural(c: dict) -> int:
    return library_counts.structural(c)


def example_path(c: dict) -> str | None:
    u = c.get("usage") or {}
    if c.get("_capturePath") and not (u.get("examples") or u.get("renderedExamples")):
        return c["_capturePath"]
    for key in ("examples", "renderedExamples", "exampleCandidates"):
        vals = u.get(key) or []
        if vals:
            v = vals[0]
            return v.get("path") if isinstance(v, dict) else v
    return None


def build_order(comps: list[dict], plan: dict[str, dict]) -> list[dict]:
    """Tier order, then placements descending, then id: the index order everywhere."""
    def key(c):
        tier = short_tier((c.get("usage") or {}).get("tier"))
        t = TIERS.index(tier) if tier in TIERS else len(TIERS)
        return (t, -placements(c), -structural(c), c["id"])
    return sorted(comps, key=key)


def spec_file_for(measurements: Path, comp: dict) -> Path | None:
    by_id = measurements / f"{comp['id'].replace(':', '__').replace('/', '__')}.spec.json"
    if by_id.exists():
        return by_id
    machine = measurements / f"{comp.get('machineName') or comp['id'].split(':')[-1]}.spec.json"
    return machine if machine.exists() else None


def add_alternates(project: Path, comps: list[dict], built: list[dict], measurements: Path, trees: Path) -> None:
    """Other layouts the site renders a built child in. Each built parent's rendering of the
    child (its tagged subtree of the parent's measurement) becomes a tree; one whose structure
    (text layers, images) differs from the child's own and from every layout already found is
    stored on the child's tree as an alternate, built as a sibling variant, so that parent can
    nest an instance of the layout it actually shows."""
    import nesting
    by_id = {c["id"]: c for c in comps}
    ids = [b["id"] for b in built]
    for child in ids:
        tree_file = trees / f"{child}.json"
        tree = json.loads(tree_file.read_text())
        seen = {nesting.signature(tree["tree"])}
        alternates = []
        for parent in ids:
            if parent == child or child not in {a for slot in by_id[parent].get("slots") or []
                                                for a in slot.get("accepts") or []}:
                continue
            spec_file = spec_file_for(measurements, by_id[parent])
            found = nesting.subtree(json.loads(spec_file.read_text()), child) if spec_file else None
            if not found:
                continue
            key = f"{child.split(':')[-1]}@{parent.split(':')[-1]}"
            try:
                alt = responsive.build({"measurements": found[0]}, by_id[child].get("label") or child, key)
            except (IndexError, KeyError, StopIteration):
                continue
            sig = nesting.signature(alt["tree"])
            if sig in seen:
                continue
            seen.add(sig)
            alternates.append({"label": f"In {by_id[parent].get('label') or parent}", "parent": parent,
                               "variables": alt["variables"], "tree": alt["tree"]})
        if alternates:
            tree["alternates"] = alternates
        else:
            tree.pop("alternates", None)
        tree_file.write_text(json.dumps(tree, indent=1, sort_keys=True) + "\n")


def children_first(built: list[dict], comps: list[dict]) -> list[dict]:
    """Build order for the steps: a component a parent nests is built before the parent, so
    the parent can instance it; otherwise the index order."""
    by_id = {c["id"]: c for c in comps}
    ids = [b["id"] for b in built]
    out, seen = [], set()

    def visit(cid, path=()):
        if cid in seen or cid in path or cid not in ids:
            return
        for slot in by_id.get(cid, {}).get("slots") or []:
            for child in slot.get("accepts") or []:
                visit(child, path + (cid,))
        seen.add(cid)
        out.append(next(b for b in built if b["id"] == cid))
    for cid in ids:
        visit(cid)
    return out


# ---------------------------------------------------------------- init

def build_trees(project: Path, trees: Path, only: str | None = None) -> list[dict]:
    """The init tree path, also usable in a temporary directory without a runner."""
    trees.mkdir(parents=True, exist_ok=True)
    comps = components(project)
    plan = plans(project)
    measurements = project / "capture" / "measurements"
    built = []
    for c in build_order(comps, plan):
        p = plan.get(c["id"], {})
        if p.get("verdict") != "build":
            continue
        if only and c["id"] not in only.split(","):
            continue
        # Measurements are named by machine name; a Drupal id (`paragraph:card`) has no dot, and
        # a block and a paragraph can share a machine name, so the spec must name this source.
        machine = c.get("machineName") or c["id"].split(":")[-1].split(".")[-1]
        spec_file = measurements / f"{c['id'].replace(':', '__').replace('/', '__')}.spec.json"
        if not spec_file.exists():
            spec_file = measurements / f"{machine}.spec.json"  # runs before 0.15.1
        if not spec_file.exists():
            continue
        spec_source = (json.loads(spec_file.read_text()).get("source") or {}).get("sourceRef")
        if c.get("sourceRef") and spec_source and spec_source != c["sourceRef"]:
            continue
        try:
            tree = responsive.build(json.loads(spec_file.read_text()), c.get("label") or c["id"], c["id"].split(".")[-1])
        except (IndexError, KeyError, StopIteration):
            continue  # no usable measurement at any width
        (trees / f"{c['id']}.json").write_text(json.dumps(tree, indent=1, sort_keys=True) + "\n")
        built.append({"id": c["id"]})

    add_alternates(project, comps, built, measurements, trees)
    return built


def cmd_init(ns) -> int:
    project = Path(ns.project).resolve()
    out = project / "figma"
    previous = json.loads((out / "state.json").read_text()) if (out / "state.json").is_file() else None
    if getattr(ns, "rebuild", False):
        # Rebuild in place: the same file, emptied of this run's earlier build by a first `wipe`
        # step, so a fix can be tried without a new file or anyone restarting the runner.
        if not previous or previous.get("fileKey") != ns.file_key:
            raise SystemExit("--rebuild needs an earlier build of this run in the same file "
                             f"({ns.file_key}); run init without it for a new file")
        for folder in ("results", "payloads", "trees", "compare", "verify", "dump"):
            for stale in (out / folder).glob("*") if (out / folder).is_dir() else []:
                if stale.is_file():
                    stale.unlink()
        for stale in (project / "builds").glob("*.json") if (project / "builds").is_dir() else []:
            stale.unlink()
    (out / "results").mkdir(parents=True, exist_ok=True)
    (out / "payloads").mkdir(exist_ok=True)
    (out / "trees").mkdir(exist_ok=True)
    comps = components(project)
    built = build_trees(project, out / "trees", getattr(ns, "only", None))
    steps = ([{"id": "wipe"}] if getattr(ns, "rebuild", False) else []) + [{"id": "pages"}, {"id": "variables"}]
    steps += [{"id": f"foundation:{d}"} for d in foundation_domains(project)]
    steps += [{"id": f"tier:{t}"} for t in tier_names(comps)]
    for b in children_first(built, comps):
        steps += [{"id": f"build:{b['id']}"}, {"id": f"images:{b['id']}"},
                  {"id": f"block:{b['id']}"}, {"id": f"evidence:{b['id']}"}, {"id": f"compare:{b['id']}"}]
    if (project / "compositions.json").exists():
        steps += [{"id": "examples"}]
    # The Cover shows what was built, so it is drawn once every component step is recorded.
    steps += [{"id": "cover"}, {"id": "getting-started"}]
    state = {
        "standardVersion": STANDARD_VERSION,
        "fileKey": ns.file_key,
        "siteUrl": ns.site_url.rstrip("/"),
        "canonicalBaseUrl": ns.canonical_base_url.rstrip("/"),
        "runtime": render_payload.runtime_hash(),
        "offlineImages": bool(getattr(ns, "offline_images", False) or (project / "corpus.json").is_file()),
        # The build plan, in order. What is built is read from `done` (library_counts.recorded_ids).
        "planned": [b["id"] for b in built],
        "steps": steps,
        "done": [],
        # Keep the runner connected after the build, waiting for the next one (`--iterate`).
        "iterate": bool(getattr(ns, "iterate", False) or (previous or {}).get("iterate")
                        and getattr(ns, "rebuild", False)),
    }
    # The connect handshake drew a name-only Cover; the build fills that page rather than
    # adding a second one. Keep the state key for older build records.
    target = load(project, "project.json", {}).get("target") or {}
    connection = target.get("connection") or target.get("preflight") or {}
    if connection.get("coverPageId") and connection.get("fileKey") == ns.file_key:
        state["preflightCover"] = connection["coverPageId"]
    (out / "state.json").write_text(json.dumps(state, indent=1) + "\n")
    print(json.dumps({"steps": len(steps), "components": len(built), "runtime": state["runtime"]}))
    return 0


# ---------------------------------------------------------------- content rules

def foundation_domains(project: Path) -> list[str]:
    plan = load(project, "variable-plan.json", {"collections": {}})
    kinds = {v["type"] for col in plan["collections"].values() for v in col["variables"]}
    names = [v["name"] for col in plan["collections"].values() for v in col["variables"]]
    out = []
    if "COLOR" in kinds:
        out.append("Color")
    if any(n.startswith("Typography/") for n in names) or (project / "capture" / "measurements").exists():
        out.append("Typography")
    if any(n.startswith("Spacing/") for n in names):
        out.append("Spacing & Layout")
    if any(n.startswith(("Shape/", "Elevation/", "Radius/")) for n in names):
        out.append("Elevation & Shape")
    if (project / "voice.json").exists():
        out.append("Brand Voice & Language")
    return out


def page_list(project: Path) -> list[str]:
    pages = (["Cover", "Getting Started"] + [f"Foundations — {d}" for d in foundation_domains(project)] +
             [f"Components — {t}" for t in tier_names(components(project))])
    if (project / "compositions.json").exists():
        pages.append("Examples")
    return pages


def result(project: Path, step: str) -> dict:
    return json.loads((project / "figma" / "results" / f"{safe(step)}.json").read_text())


def safe(step: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", step)


def page_id(project: Path, name: str) -> str:
    return result(project, "pages")["pages"][name]


def variables_args(project: Path) -> dict:
    return {"collections": load(project, "variable-plan.json")["collections"]}


COVER_LABELS = library_counts.COVER_LABELS


def provenance(project: Path, state: dict) -> dict:
    """Where the file came from. Stored as hidden plugin data, never drawn on a page; the
    benchmark report (score_run.py) shows it to developers."""
    repo = repo_root(project)
    return {"source": repo.name, "commit": git_commit(repo), "siteUrl": state.get("siteUrl"),
            "captureWidths": sorted(VIEWPORTS.values()), "standardVersion": STANDARD_VERSION,
            "runtime": state.get("runtime"), "builtOn": date.today().isoformat(),
            "regenerate": "design-lab:run"}


def cover_args(project: Path, state: dict) -> dict:
    """The Cover is for the library's recipient: the site's name, one generic line, how many
    components the library holds and how that number splits by usage tier. Nothing else."""
    c = library_counts.counts(project, library_counts.recorded_ids(state))
    tiers = [{"key": row["tier"], "value": str(row["built"]), "label": COVER_LABELS.get(row["tier"], row["tier"]),
              "color": library_counts.TIER_COLORS[row["tier"]]}
             for row in c["coverBreakdown"]] if c["tiered"] else []
    return {
        "pageId": page_id(project, "Cover"),
        "ground": library_counts.COVER_GROUND,
        "headline": site_name(repo_root(project)),
        "subtitle": "Component Library",
        "total": {"value": str(c["built"]), "label": "components" if c["built"] != 1 else "component"},
        "tiers": tiers,
        "provenance": provenance(project, state),
        "version": STANDARD_VERSION,
    }


def foundation_args(project: Path, domain: str) -> dict:
    plan = load(project, "variable-plan.json")
    variables = [v for col in plan["collections"].values() for v in col["variables"]]
    by_name = {v["name"]: v for v in variables}
    sections = []
    intro = []
    if domain == "Color":
        prim = [v for v in variables if v["type"] == "COLOR" and not v.get("aliasOf")]
        sem = [v for v in variables if v["type"] == "COLOR" and v.get("aliasOf")]
        sw = lambda v: {"variable": v["name"], "label": (v.get("codeName") or v["name"]).lstrip("-"),
                        "value": expand_hex(v.get("hex") or by_name.get(v.get("aliasOf"), {}).get("hex") or "#000000"),
                        "code": f"var({v['codeName']})" if v.get("codeName") else None,
                        "alias": (by_name.get(v.get("aliasOf"), {}).get("codeName") or v.get("aliasOf") or "").lstrip("-") or None}
        intro = ["Every colour the site's stylesheets declare, bound to its variable. Semantic colours point at a primitive; the arrow names it."]
        if prim:
            sections.append({"kind": "color", "title": "Primitives", "note": None, "swatches": [sw(v) for v in sorted(prim, key=lambda v: v["name"])]})
        if sem:
            sections.append({"kind": "color", "title": "Semantic", "note": None, "swatches": [sw(v) for v in sorted(sem, key=lambda v: v["name"])]})
    elif domain == "Typography":
        fams = [v for v in variables if v["type"] == "STRING" and "FONT_FAMILY" in (v.get("scopes") or [])]
        intro = ["Font families come from the site's tokens. The scale below is measured from the rendered components, because the stylesheets declare no type-size tokens; those values are literals in the components, not variables."]
        if fams:
            sections.append({"kind": "type-family", "title": "Families", "note": None, "families": [
                {"variable": v["name"], "family": next(iter((v.get("valuesByMode") or {"": ""}).values())),
                 "code": f"var({v['codeName']})" if v.get("codeName") else None,
                 "sample": "The quick brown fox jumps over the lazy dog"} for v in sorted(fams, key=lambda v: v["name"])]})
        rows = measured_type(project)
        if rows:
            sections.append({"kind": "type-scale", "title": "Measured scale", "note": "Sizes observed on the built components, largest first. Measured, not tokens.", "rows": rows})
    elif domain == "Spacing & Layout":
        steps = [v for v in variables if v["name"].startswith("Spacing/") and v["type"] == "FLOAT"]
        sections.append({"kind": "spacing", "title": "Spacing", "note": None, "steps": [
            {"variable": v["name"], "label": v["name"].split("/")[-1], "value": float(next(iter(v["valuesByMode"].values()))),
             "code": f"var({v['codeName']})" if v.get("codeName") else None} for v in sorted(steps, key=lambda v: float(next(iter(v["valuesByMode"].values()))))]})
    elif domain == "Elevation & Shape":
        steps = [v for v in variables if v["name"].startswith(("Shape/", "Radius/")) and v["type"] == "FLOAT"]
        sections.append({"kind": "radius", "title": "Radius", "note": None, "steps": [
            {"variable": v["name"], "label": v["name"].split("/")[-1], "value": float(next(iter(v["valuesByMode"].values()))),
             "code": f"var({v['codeName']})" if v.get("codeName") else None} for v in sorted(steps, key=lambda v: v["name"])]})
    return {"pageId": page_id(project, f"Foundations — {domain}"), "title": f"Foundations — {domain}", "intro": intro, "sections": sections}


def expand_hex(h: str) -> str:
    # rgb()/rgba() custom properties: same treatment as 8-digit hex, alpha dropped.
    rgb = re.match(r"\s*rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)", h)
    if rgb:
        return "#" + "".join(f"{round(float(c)):02x}" for c in rgb.groups())
    s = h.lstrip("#")
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    return "#" + s[:6].lower()


WEIGHT_NAMES = {100: "Thin", 200: "Extra Light", 300: "Light", 400: "Regular", 500: "Medium",
                600: "Semi Bold", 700: "Bold", 800: "Extra Bold", 900: "Black"}


def measured_type(project: Path) -> list[dict]:
    """Distinct desktop text styles across built trees, largest first, with one real sample
    each. A size that varies by width shows its desktop value; the Breakpoint variable holds
    the rest."""
    seen: dict[tuple, dict] = {}
    for f in sorted((project / "figma" / "trees").glob("*.json")):
        tree = json.loads(f.read_text())
        variables = tree.get("variables", {})
        def desk(v):
            if isinstance(v, dict) and "var" in v:
                return variables[v["var"]]["values"]["Desktop"]
            return v
        stack = [tree["tree"]] if "tree" in tree else [b["tree"] for b in tree.get("breakpoints", []) if b.get("tree")]
        while stack:
            n = stack.pop()
            stack.extend(reversed(n.get("children", [])))
            if n.get("kind") != "text":
                continue
            t = n["text"]
            key = (t["family"], t["weight"], desk(t["size"]), desk(t["lineHeight"]))
            if key not in seen:
                seen[key] = {"sample": t["characters"][:60], "from": tree["label"]}
    rows = []
    for (family, weight, size, lh), info in sorted(seen.items(), key=lambda kv: (-kv[0][2], -kv[0][1], kv[0][0])):
        style = "Bold" if weight >= 600 else "Regular"
        rows.append({"label": f"{int(size) if size == int(size) else size}px · {WEIGHT_NAMES.get(weight, weight)}",
                     "family": family, "style": style, "weight": weight, "size": size, "lineHeight": lh,
                     "spec": f"{family} {weight} · {size}px / {lh or 'normal'} · first seen in {info['from']}",
                     "sample": info["sample"]})
    return rows[:12]


def tier_args(project: Path, state: dict, tier: str) -> dict:
    comps = [c for c in components(project) if short_tier((c.get("usage") or {}).get("tier")) == tier]
    # Tier pages are drawn before the components, so the summary states only what is true before and
    # after they are built: how many components the tier has and their placements. Whether each one
    # was built is on the Cover and in the Getting Started index, which count recorded steps.
    planned = [c for c in comps if c["id"] in library_counts.planned_ids(state)]
    total = sum(placements(c) for c in comps)
    summary = [f"{len(comps)} component{'s' if len(comps) != 1 else ''} in this tier. "
               f"{total:,} author placement{'s' if total != 1 else ''} between them."]
    empty = None
    if not planned:
        empty = ("No component in this tier is in the source." if not comps else
                 f"None of the {len(comps)} components in this tier is part of the library. The index on Getting Started gives each one's reason.")
    thresholds = ("No usage source counted these components' placements, so they have no tier."
                  if tier == "Untiered" else
                  "Tiers by author placements: High Use 50 or more · Medium Use 10 to 49 · Low Use 1 to 9 · Structural Only when placed only inside other components · Retirement Candidates when placed nowhere.")
    return {"pageId": page_id(project, f"Components — {tier}"), "title": f"Components — {tier}", "summary": summary,
            "thresholds": thresholds, "emptyLine": empty}


def component_page(c: dict) -> str:
    return f"Components — {short_tier((c.get('usage') or {}).get('tier'))}"


# Prefixed like the foundation collection (`Core`), so it groups with it in the picker
# instead of colliding with every other library's `Breakpoint`.
BREAKPOINT_COLLECTION = "Core Breakpoint"


def mode_names(tree: dict) -> dict:
    """`<Role> <viewport>px`, the standard's mode naming, from the capture viewports."""
    return {role: f"{role} {VIEWPORTS[role]}px" for role in ("Desktop", "Tablet", "Mobile")}


# Class words that name an option differently from its stored value (Bootstrap's text-start).
OPTION_SYNONYMS = {"left": ("start",), "right": ("end",), "center": ("middle",)}
GENERIC_OPTIONS = {"none", "default", "auto", "normal", "inherit"}


def variant_values(project: Path, cid: str) -> list[dict]:
    """Each planned variant axis with the option its captured instance renders, read from the
    rendered classes (`width-default`, `banner-secondary`, `bio--large`). An axis whose option
    the classes do not name is recorded as unknown, never guessed."""
    plan = plans(project).get(cid, {})
    axes = [a for a in plan.get("variantAxes") or [] if a.get("field") != "Breakpoint"]
    if not axes:
        return []
    comp = next(c for c in components(project) if c["id"] == cid)
    fields = {f["name"]: f for f in comp.get("fields") or []}
    spec_file = project / "capture" / "measurements" / f"{cid.replace(':', '__').replace('/', '__')}.spec.json"
    nodes = ((json.loads(spec_file.read_text()).get("measurements") or {}).get("desktop:default") or {}).get(
        "nodes", []) if spec_file.exists() else []
    words = [re.split(r"[-_]+", cls.lower()) for n in nodes[:8] for cls in n.get("classes") or []]
    out = []
    for axis in axes:
        options = (fields.get(axis["field"]) or {}).get("options") or []
        field_words = set(re.split(r"[-_]+", axis["field"].lower())) - {"field"}
        hits = []
        for option in options:
            value = str(option.get("value", "")).lower()
            names = [re.split(r"[-_]+", value)] + [[s] for s in OPTION_SYNONYMS.get(value, ())]
            # A generic word (`d-none`) names nothing unless its class also names the field
            # (`width-default` for field_width).
            generic = value in GENERIC_OPTIONS
            if any(any(parts[i:i + len(name)] == name for i in range(len(parts) - len(name) + 1))
                   and (not generic or field_words & set(parts))
                   for parts in words for name in names if name and name != [""]):
                hits.append(option)
        seen = hits[0] if len(hits) == 1 else None
        out.append({"axis": axis.get("label") or axis["field"], "field": axis["field"],
                    "value": (seen.get("label") or seen.get("value")) if seen else None,
                    "others": [o.get("label") or o.get("value") for o in options if o is not seen]})
    return out


def child_masters(project: Path, comp: dict) -> dict:
    out = {}
    for slot in comp.get("slots") or []:
        for child in slot.get("accepts") or []:
            try:
                out[child] = result(project, f"build:{child}")["componentId"]
            except (FileNotFoundError, KeyError):
                pass
    return out


def font_plan(project: Path) -> dict | None:
    try:
        return (json.loads((project / "fonts.json").read_text()) or {}).get("build")
    except (OSError, ValueError):
        return None


def build_args(project: Path, cid: str, state: dict) -> dict:
    tree = json.loads((project / "figma" / "trees" / f"{cid}.json").read_text())
    comp = next(c for c in components(project) if c["id"] == cid)
    return {"pageId": page_id(project, component_page(comp)), "x": 0, "y": PARKING_Y, "id": cid,
            "name": f"{cid} — {comp.get('label') or cid}", "description": description(project, comp),
            "collection": BREAKPOINT_COLLECTION, "modeNames": mode_names(tree),
            # The masters of children this component nests, already built (children build first),
            # so the builder fetches each by id instead of loading every page to find it.
            "masters": child_masters(project, comp),
            # Planned variant axes: the master becomes the one variant capture observed, in a set.
            "variant": {v["axis"]: v["value"] or "As captured" for v in variant_values(project, cid)},
            "variables": {**tree["variables"], **{k: v for alt in tree.get("alternates") or []
                                                   for k, v in alt["variables"].items()}},
            # Which family each font stack draws in, with the face each weight serves and the
            # stand-ins chosen for families Figma lacks (fonts.json, written at connect).
            "fonts": font_plan(project),
            "alternates": [{"label": alt["label"], **spec_to_tree.compact(alt["tree"])}
                           for alt in tree.get("alternates") or []],
            **spec_to_tree.compact(tree["tree"])}


def description(project: Path, c: dict) -> str:
    """The Assets-panel search payload: what, usage, configuration, example, pointer."""
    u = c.get("usage") or {}
    fields = ", ".join(f"{f.get('label') or f['name']} ({f['kind']})" for f in c.get("fields") or []) or "none"
    ex = example_path(c) or "none verified"
    return (f"{c.get('label') or c['id']} — {c['id']} ({c.get('group') or 'ungrouped'}).\n"
            f"Usage: {short_tier(u.get('tier'))}; {placements(c)} author placements, {structural(c)} structural references, "
            f"rendered on {u.get('renderedPages') or 0} public pages.\n"
            f"Fields: {fields}.\nResponsive: one component; resize an instance and set its Breakpoint mode (Desktop, Tablet, Mobile).\nExample: {ex}\n"
            f"Documentation: the block beside this component on its tier page.")


def fields_rows(c: dict, plan: dict) -> list[list[str]]:
    treat = {p["field"]: p["treatment"] for p in plan.get("properties", [])}
    axes = {a["field"] for a in plan.get("variantAxes", [])}
    rows = []
    for f in c.get("fields") or []:
        t = "variant axis — only the rendered option is drawn" if f["name"] in axes else {
            "text": "text in the drawn instance", "boolean": "shown as rendered",
            "variable": "value as rendered", "swap": "nested content as rendered",
            "manual": "as rendered; not a Figma property", "skip": "not visible"}.get(treat.get(f["name"]), "as rendered")
        rows.append([f["name"], f["kind"], "yes" if f.get("required") else "no", t])
    for s in c.get("slots") or []:
        rows.append([s["name"], "slot", "yes" if s.get("required") else "no", "nested content as rendered"])
    return rows


def block_args(project: Path, state: dict, cid: str, order: int) -> dict:
    comp = next(c for c in components(project) if c["id"] == cid)
    plan = plans(project).get(cid, {})
    tree = json.loads((project / "figma" / "trees" / f"{cid}.json").read_text())
    u = comp.get("usage") or {}
    ex = example_path(comp)
    facts = [["Author placements", str(placements(comp))],
             ["Structural references", str(structural(comp))],
             ["Rendered on", f"{u.get('renderedPages') or 0} public pages"]]
    if ex:
        facts.append(["Example", ex, state["canonicalBaseUrl"] + ex])
    facts.append(["Source", str(Path(comp.get("sourceRef") or "").parent)])
    chips = [c for c in [comp.get("group"), "Global chrome" if u.get("globalTemplate") else None] if c]
    relations = []
    if comp.get("contains"):
        relations.append("Contains: " + ", ".join(sorted(comp["contains"])) + ".")
    if comp.get("containedBy"):
        relations.append("Placed inside: " + ", ".join(sorted(comp["containedBy"])) + ".")
    # Theme Twig references arrive as {file, line}; Canvas content templates as their id.
    for ref in sorted({r["file"] if isinstance(r, dict) else str(r) for r in u.get("templateRefs") or []}):
        kind = "theme template" if ref.endswith(".twig") else "Canvas content template"
        relations.append(f"Rendered by the {kind} {ref}.")
    notes = [d.get("detail") or str(d) for d in comp.get("defects") or []][:4]
    names = mode_names(tree)
    cols = []
    for role in COLUMN_ORDER:
        if role.lower() not in tree["measured"]:
            continue
        width = tree["widths"][role]
        cols.append({"label": f"{role} · {fmt(width)}px", "width": width, "mode": names[role], "master": role == "Desktop"})
    return {
        "pageId": page_id(project, component_page(comp)),
        "setId": result(project, f"build:{cid}")["componentId"],
        "id": cid, "order": order,
        "doc": {"label": comp.get("label") or cid, "machine": cid, "tier": short_tier(u.get("tier")),
                "purpose": comp.get("description"), "chips": chips, "facts": facts,
                "properties": [["Breakpoint", "MODE", "Desktop, Tablet, Mobile", "Desktop"]],
                "fields": fields_rows(comp, plan), "relations": relations, "notes": notes},
        "columns": cols,
        "collection": BREAKPOINT_COLLECTION,
        "evidence": [{"label": f"{e['viewport']} {e['width']}px", "width": e["width"], "height": e["height"]}
                     for e in evidence_captures(project, cid, tree)],
        "captured": "the running site",
        "backdrop": backdrop(project, cid),
        "fileKey": state["fileKey"],
    }


def backdrop(project: Path, cid: str) -> str:
    """The desktop backdrop measured behind the component, as hex; white when unmeasured."""
    spec_file = project / "capture" / "measurements" / f"{cid.replace(':', '__').replace('/', '__')}.spec.json"
    if not spec_file.exists():
        return "#ffffff"
    m = (json.loads(spec_file.read_text()).get("measurements") or {}).get("desktop:default") or {}
    color = spec_to_tree.parse_color(m.get("backdrop"))
    return color["hex"] if color and color.get("opacity", 1) >= 1 else "#ffffff"


def evidence_captures(project: Path, cid: str, tree: dict) -> list[dict]:
    """The captures shown under the specimen, one per drawn column, in column order: a
    breakpoint that was captured but not measured has no column, so it has no capture either.
    The block's evidence rectangles and the evidence upload both come from this list, so the
    Nth rectangle always receives the Nth file."""
    by_viewport = {e["viewport"].lower(): e for e in capture_images(project, cid)}
    return [by_viewport[role.lower()] for role in COLUMN_ORDER
            if role.lower() in tree["measured"] and role.lower() in by_viewport]


def fmt(n: float) -> str:
    return str(int(n)) if n == int(n) else str(n)


def capture_images(project: Path, cid: str) -> list[dict]:
    ev = load(project, "capture-evidence.json", {"captures": {}}).get("captures", {}).get(cid) or {}
    imgs = [i for i in ev.get("images", []) if (i.get("state") or "default") == "default"]
    def rank(i):
        v = (i.get("viewport") or "").lower()
        return BREAKPOINTS.index(v) if v in BREAKPOINTS else 9
    out = []
    for i in sorted(imgs, key=rank):
        w, h = i.get("width"), i.get("height")
        if not (w and h):
            from PIL import Image
            with Image.open(i["file"]) as im:
                w, h = im.size
        out.append({"viewport": (i.get("viewport") or "").capitalize(), "file": i["file"], "width": w, "height": h})
    return out


VOICE_SECTIONS = ["Voice", "Naming & terminology", "Headlines", "Calls to action", "Readability", "Search"]


def clip(text: str, limit: int = 220) -> str:
    """Whole sentences up to about `limit` characters, so a quote never ends mid-word."""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return (cut[:end + 1] if end > 60 else cut.rsplit(" ", 1)[0] + " …").strip()


def evidence_text(ev: dict) -> str:
    parts = [f"{ev.get('numerator', 0)} of {ev.get('denominator', 0)}"]
    for q in ev.get("quotes") or []:
        parts.append(f"“{clip(q['quote'], 90)}” ({q['address']})")
    return " · ".join(parts)


def spaced(key: str) -> str:
    """`callToAction` -> `call to action`."""
    return re.sub(r"([a-z])([A-Z])", r"\1 \2", key).lower()


def voice_args(project: Path) -> dict:
    v = load(project, "voice.json")
    c = v.get("corpus", {})
    pos = v.get("positioning") or {}
    rules = v.get("rules") or []
    sections = [{"title": sec, "rows": [{"kind": r["kind"], "rule": r["rule"], "evidence": evidence_text(r.get("evidence") or {})}
                                        for r in rules if r.get("section") == sec]} for sec in VOICE_SECTIONS]
    def fmt_counts(value):
        if isinstance(value, dict):
            return " · ".join(f"{spaced(k)} {n}" for k, n in value.items())
        return str(value)
    mechanics = [[m.get("Rule", ""), fmt_counts(m.get("As published")), m.get("Notes", "")] for m in v.get("mechanics") or []]
    vocab = [{"phrase": p["phrase"], "count": len(p.get("pages") or []) or p.get("count", 0)}
             for p in ((v.get("vocabulary") or {}).get("phrases") or [])][:16]
    return {
        "pageId": page_id(project, "Foundations — Brand Voice & Language"),
        "lede": (f"Drawn from the copy on {c.get('pagesFetched', 0)} published pages ({c.get('sentences', 0):,} sentences, "
                 f"{c.get('callToActionLabels', 0)} calls to action), read {c.get('fetchDate', '')}. Observed rows describe what the "
                 "site does most often; Watch rows are inconsistencies found in the same read. Nothing here is taken from a brand document."),
        "positioning": ({"line": pos["h1"], "supporting": [clip(p) for p in (pos.get("paragraphs") or [])[:2]],
                         "attribution": f"Homepage · {pos.get('address', '/')}"} if pos.get("h1") else None),
        "stats": (v.get("stats") or [])[:5],
        "sections": sections,
        "vocabulary": vocab,
        "mechanics": mechanics,
        "inconsistencies": [f"{r['rule']}: {evidence_text(r.get('evidence') or {})}" for r in v.get("inconsistencies") or []],
    }


def component_ids(comps: list[dict]) -> dict[str, str]:
    """Rendered `data-component-id` (`provider:name`) -> inventory id. The inventory's own
    `sourceSdcId` wins; otherwise the theme path in `sourceRef`, as find_rendered_components.py
    reads it; otherwise the conventional `sdc.<provider>.<name>`."""
    out = {}
    for c in comps:
        source = c.get("sourceSdcId")
        if not source:
            m = re.search(r"(?:^|/)themes/(?:custom|contrib)/([^/]+)/components/([^/]+)/", c.get("sourceRef") or "")
            source = f"{m.group(1)}:{m.group(2)}" if m else None
        if source:
            out.setdefault(source, c["id"])
    return out


def component_id(render_id: str, ids: dict[str, str]) -> str:
    provider, _, name = render_id.partition(":")
    return ids.get(render_id) or f"sdc.{provider}.{name}"


def examples_args(project: Path, state: dict) -> dict:
    """Up to three real pages, recomposed from instances: the home page first, then the pages
    using the most distinct built components, skipping any page that repeats a chosen set."""
    inventory = components(project)
    comps = {c["id"]: c for c in inventory}
    ids = component_ids(inventory)
    pages = load(project, "compositions.json").get("pages", [])
    built = library_counts.recorded_ids(state)
    def distinct(p):
        return sorted({component_id(r, ids) for r in p["components"]} & built)
    ranked = sorted(pages, key=lambda p: (p["address"] != "/", -len(distinct(p)), p["address"]))
    chosen, seen = [], []
    for p in ranked:
        key = distinct(p)
        if not key or key in seen:
            continue
        chosen.append(p)
        seen.append(key)
        if len(chosen) == 3:
            break
    out = []
    for p in chosen:
        items = []
        for r in p["components"]:
            cid = component_id(r, ids)
            label = (comps.get(cid) or {}).get("label") or cid
            if cid in built:
                tree = json.loads((project / "figma" / "trees" / f"{cid}.json").read_text())
                items.append({"componentId": result(project, f"build:{cid}")["componentId"], "label": label,
                              "desktop": tree["widths"].get("Desktop"), "mobile": tree["widths"].get("Mobile")})
            else:
                items.append({"missing": label})
        out.append({"address": p["address"], "title": p.get("title") or p["address"], "items": items})
    names = mode_names({})
    return {"pageId": page_id(project, "Examples"), "collection": BREAKPOINT_COLLECTION,
            "desktopMode": names["Desktop"], "mobileMode": names["Mobile"], "pages": out}


def getting_started_args(project: Path, state: dict) -> dict:
    comps = components(project)
    plan = plans(project)
    built = library_counts.recorded_ids(state)
    ordered = build_order(comps, plan)
    counted = library_counts.counts(project, built)
    shown = set(tier_names(comps))
    coverage = [[row["tier"], str(row["found"]), str(row["built"]), str(row["notBuilt"]), f"{row['placements']:,}"]
                for row in counted["byTier"] if row["tier"] in shown]
    index = []
    gaps = []
    for c in ordered:
        p = plan.get(c["id"], {})
        if c["id"] in built:
            status = "Built"
            set_id = result(project, f"build:{c['id']}")["componentId"]
            block_id = result(project, f"block:{c['id']}")["blockId"]
        else:
            reason = p.get("refuseReason") or ("mapped into its parent" if p.get("verdict") == "map" else "no capture")
            status = "Mapped into parent" if p.get("verdict") == "map" else "Not built"
            set_id = block_id = None
            gaps.append(f"{c.get('label') or c['id']} ({c['id']}): {status.lower()} — {reason}.")
        index.append({"placements": placements(c), "label": c.get("label") or c["id"], "machine": c["id"],
                      "tier": short_tier((c.get("usage") or {}).get("tier")), "type": c.get("group") or "—",
                      "status": status, "setId": set_id, "blockId": block_id})
    domains = foundation_domains(project)
    for d in FOUNDATION_ORDER:
        if d not in domains:
            gaps.append(f"Foundations — {d} is omitted: the site's stylesheets declare no {d.lower()} tokens.")
    if "Typography" in domains:
        gaps.append("Type sizes and line heights are literals in the components: the stylesheets declare no type-size tokens. The Typography page shows them as measured values.")
    for d in domains:
        try:
            missing = result(project, f"foundation:{d}").get("missing") or []
        except FileNotFoundError:
            missing = []
        for m in sorted(set(missing)):
            gaps.append(f"Foundations — {d}: {m} is not available in Figma; its specimen is drawn in Inter.")
    # What this build itself measured as unresolved, named by the check that will report it, so
    # the page never reads cleaner than the file is.
    differing, missing_fonts = [], set()
    for c in ordered:
        if c["id"] not in built:
            continue
        try:
            compare = result(project, f"compare:{c['id']}")
        except FileNotFoundError:
            compare = {}
        if compare and not compare.get("pass"):
            worst = max((p.get("ratio") or 0) for p in compare.get("pairs") or [{}])
            differing.append(f"{c['id']} ({worst:.0%})")
        try:
            missing_fonts.update(result(project, f"build:{c['id']}").get("missingFonts") or [])
        except FileNotFoundError:
            pass
    if differing:
        gaps.append(f"master-matches-capture: {len(differing)} component(s) differ from their live capture by more "
                    f"than the 6% threshold at one or more widths, so build-record-assertions records a failing "
                    f"visual comparison for each: {', '.join(differing)}.")
    if missing_fonts:
        gaps.append(f"fonts-available: {', '.join(sorted(missing_fonts))} "
                    f"{'is' if len(missing_fonts) == 1 else 'are'} not available to Figma here, so text using "
                    f"{'it' if len(missing_fonts) == 1 else 'them'} is drawn in Inter; make the families available and rebuild.")
    for c in ordered:
        if c["id"] not in built:
            continue
        for v in variant_values(project, c["id"]):
            seen = f"the captured instance is {v['value']}" if v["value"] else "the captured instance's option is not recorded in its classes"
            gaps.append(f"{c.get('label') or c['id']} ({c['id']}) — {v['axis']}: {seen}; "
                        f"{', '.join(v['others']) or 'no other option'} not captured, so not drawn as variants.")
    repo = repo_root(project)
    return {
        "pageId": page_id(project, "Getting Started"),
        "title": f"{site_name(repo)} component library",
        "what": "The components of the running site, each drawn from a live capture at three widths, with its documentation beside it on its usage tier page.",
        "whatNot": "Not a redesign: every value is what the site renders today, defects included. Not a search index: use Figma's Find and the Assets panel.",
        "coverage": {"columns": [{"title": "Tier"}, {"title": "Components", "width": 160}, {"title": "Built", "width": 120},
                                 {"title": "Not built", "width": 140}, {"title": "Placements", "width": 160}], "rows": coverage},
        "organisation": ["Pages are usage tiers, the only page axis. Within a page, components run from most to least placed.",
                         "Author placements and structural references are counted separately: a component placed only inside others is Structural Only, not dead."],
        "thresholds": {"columns": [{"title": "Tier"}, {"title": "Rule", "width": 360}],
                       "rows": [["High Use", "50 or more author placements"], ["Medium Use", "10 to 49"], ["Low Use", "1 to 9"],
                                ["Structural Only", "0 placements, placed inside other components"], ["Retirement Candidates", "0 placements, 0 references"]]},
        "blockGuide": [["Head", "Name, machine name, tier, and what the component is for."],
                       ["Usage", "Author placements, structural references, pages it renders on, a live example and its source."],
                       ["Figma properties", "What you can change on an instance."],
                       ["Fields", "Every field an author fills in, and how it appears in Figma."],
                       ["Breakpoints", "The component at mobile, tablet and desktop, side by side, narrowest first."],
                       ["Live reference", "Screenshots of the running site in the same columns, for comparison."]],
        "index": index,
        "gaps": gaps,
        "changelog": [[date.today().isoformat(), library_counts.coverage_sentence(counted)
                       + f" {counted['found']} found in the source."]],
        "regenerate": ["design-lab:run against the same repository and site", "figma_build.py init, then next/record until done", "design-lab:verify"],
    }


# ---------------------------------------------------------------- stepping

def pending(state: dict) -> dict | None:
    done = set(state["done"])
    return next((s for s in state["steps"] if s["id"] not in done), None)


def emit_payload(project: Path, step: str, template: str, args: dict) -> dict:
    path = project / "figma" / "payloads" / f"{safe(step)}.js"
    code = render_payload.call_payload(template, args)
    if len(code) > render_payload.LIMIT and not os.environ.get("DESIGN_LAB_RUNNER"):
        raise SystemExit(f"{step}: payload {len(code)} characters exceeds {render_payload.LIMIT}")
    path.write_text(code)
    return {"kind": "use_figma", "step": step, "payload": str(path), "characters": len(code)}


def cmd_next(ns) -> int:
    project = Path(ns.project).resolve()
    state = json.loads((project / "figma" / "state.json").read_text())
    step = pending(state)
    if not step:
        # A finished build serves nothing more, so a template edited since (the next fix being
        # tried) is no reason to refuse; the runner waits for the next init.
        print(json.dumps({"kind": "done"}))
        return 0
    if state["runtime"] != render_payload.runtime_hash():
        raise SystemExit("the renderer changed since init; re-run init so every step uses one runtime")
    sid = step["id"]
    head, _, rest = sid.partition(":")
    if sid == "wipe":
        collections = list(load(project, "variable-plan.json", {"collections": {}})["collections"])
        # Collections this run built earlier and a later plan dropped (a merged-away mode
        # collection): the last verification recorded them in this run's own file.
        built = load(project, "figma/verify/state.json", {}).get("collections") or []
        collections += [c["name"] for c in built if c.get("name") and c["name"] not in collections]
        out = emit_payload(project, sid, "wipe", {"fileKey": state["fileKey"],
                                                  "collections": collections + [BREAKPOINT_COLLECTION]})
    elif sid == "pages":
        out = emit_payload(project, sid, "pages", {"pages": page_list(project)})
    elif sid == "variables":
        out = emit_payload(project, sid, "variables", variables_args(project))
    elif sid == "cover":
        out = emit_payload(project, sid, "cover", cover_args(project, state))
    elif head == "foundation" and rest == "Brand Voice & Language":
        out = emit_payload(project, sid, "voice", voice_args(project))
    elif head == "foundation":
        out = emit_payload(project, sid, "foundation", foundation_args(project, rest))
    elif sid == "examples":
        out = emit_payload(project, sid, "examples", examples_args(project, state))
    elif head == "tier":
        out = emit_payload(project, sid, "tier_page", tier_args(project, state, rest))
    elif head == "build":
        out = emit_payload(project, sid, "build_responsive", build_args(project, rest, state))
    elif head == "images":
        out = images_step(project, sid, rest, state)
    elif head == "block":
        order = library_counts.planned_ids(state).index(rest)
        out = emit_payload(project, sid, "component_block", block_args(project, state, rest, order))
    elif head == "evidence":
        tree = json.loads((project / "figma" / "trees" / f"{rest}.json").read_text())
        ev = evidence_captures(project, rest, tree)
        ids = result(project, f"block:{rest}")["evidenceIds"]
        if len(ev) != len(ids):
            raise SystemExit(f"{sid}: the block drew {len(ids)} capture rectangles but {len(ev)} "
                             "captures match its columns; re-run the block step")
        out = {"kind": "upload", "step": sid, "nodeIds": ids, "scaleMode": "FILL",
               "files": [{"file": e["file"], "contentType": "image/png"} for e in ev]}
    elif head == "compare":
        block = result(project, f"block:{rest}")
        geo = block.get("geometry")
        if not geo or not geo.get("captures"):
            out = {"kind": "skip", "step": sid, "reason": "no geometry or captures to compare"}
        else:
            shot = project / "figma" / "compare" / f"{safe(rest)}.png"
            shot.parent.mkdir(exist_ok=True)
            out = {"kind": "screenshot", "step": sid, "nodeId": block["specimenId"],
                   "maxDimension": int(max(geo["specimen"]["width"], geo["specimen"]["height"]) + 1),
                   "out": str(shot)}
    elif sid == "getting-started":
        out = emit_payload(project, sid, "getting_started", getting_started_args(project, state))
    else:
        raise SystemExit(f"unknown step {sid}")
    print(json.dumps(out))
    return 0


def text_masks(project: Path, cid: str, geometry: dict) -> list[list[dict]] | None:
    """Per comparison pair, the live text boxes at that pair's breakpoint (root-relative, the
    same coordinates as both crops), so the comparison skips glyphs and keeps layout."""
    measurements = project / "capture" / "measurements"
    spec_file = measurements / f"{cid.replace(':', '__').replace('/', '__')}.spec.json"
    if not spec_file.exists():
        return None
    specs = json.loads(spec_file.read_text()).get("measurements") or {}
    masks = []
    for variant in geometry.get("variants") or []:
        # Mobile and tablet are labelled instances; the master itself is the desktop rendering.
        m = re.search(r"\b(Desktop|Tablet|Mobile)\b", variant.get("label") or "", re.I)
        bp = m.group(1).lower() if m else "desktop"
        nodes = (specs.get(f"{bp}:default") or {}).get("nodes") or []
        masks.append([n["box"] for n in nodes
                      if (n.get("text") or n.get("inlineText")) and spec_to_tree.visible(n)])
    return masks


def images_step(project: Path, sid: str, cid: str, state: dict) -> dict:
    """Image rectangles created by the build steps, filled from the site's own files. Icon
    glyphs (src `capture:<breakpoint>:x,y,w,h`) are cropped from that breakpoint's capture."""
    tree_file = project / "figma" / "trees" / f"{cid}.json"
    img_dir = project / "figma" / "images" / cid.split(".")[-1]
    fetched = subprocess.run([sys.executable, str(HERE / "fetch_images.py"), str(tree_file),
                              "--fallback-base-url", state["canonicalBaseUrl"],
                              "--base-url", state["siteUrl"], "--out", str(img_dir)]
                             + (["--offline"] if state.get("offlineImages") or (project / "corpus.json").is_file() else []),
                             capture_output=True, text=True, timeout=600)
    if fetched.returncode != 0:
        raise SystemExit(f"{sid}: fetch_images.py exited {fetched.returncode}: "
                         f"{(fetched.stderr or fetched.stdout).strip()}")
    # A source that failed to download is in the manifest without a file; its rectangle
    # keeps its placeholder and the build record's image-upload assertion fails.
    manifest = {m["src"]: m for m in json.loads((img_dir / "images.json").read_text())}
    shots = {e["viewport"].lower(): e["file"] for e in capture_images(project, cid)}
    node_ids, files, modes = [], [], set()
    images = result(project, f"build:{cid}").get("images", [])
    for img in images:
        src = img["src"]
        if src.startswith("capture:"):
            m = crop_capture(src, shots, img_dir)
        else:
            m = manifest.get(src)
        if m and m.get("file"):
            node_ids.append(img["id"])
            files.append({"file": m["file"], "contentType": m["contentType"]})
            modes.add(img.get("fit", "FILL"))
    if not node_ids:
        return {"kind": "skip", "step": sid,
                "reason": "no image could be fetched" if images else "no images"}
    return {"kind": "upload", "step": sid, "nodeIds": node_ids, "files": files,
            "scaleMode": "FIT" if modes == {"FIT"} else "FILL"}


def crop_capture(src: str, shots: dict, out: Path) -> dict | None:
    """Cut an element's pixels out of its breakpoint capture; the capture is element-scoped at
    scale 1, so the tree's root-relative box is also its pixel box."""
    _, bp, box = src.split(":", 2)
    shot = shots.get(bp)
    if not shot:
        return None
    x, y, w, h = (float(v) for v in box.split(","))
    from PIL import Image
    path = out / f"crop-{bp}-{int(x)}-{int(y)}-{int(w)}-{int(h)}.png"
    with Image.open(shot) as im:
        im.crop((int(x), int(y), int(x + w + 0.999), int(y + h + 0.999))).save(path)
    return {"file": str(path), "contentType": "image/png"}


def cmd_record(ns) -> int:
    project = Path(ns.project).resolve()
    sp = project / "figma" / "state.json"
    state = json.loads(sp.read_text())
    step = pending(state)
    if not step or step["id"] != ns.step:
        raise SystemExit(f"expected to record {step['id'] if step else 'nothing'}, got {ns.step}")
    data = json.loads(Path(ns.result).read_text()) if ns.result else {}
    required = {"wipe": "removedPages", "pages": "pages", "block": "blockId", "build": "componentId"}
    key = required.get(ns.step.split(":")[0])
    if key and key not in data:
        raise SystemExit(f"{ns.step}: result has no {key}; not recording a failed step")
    if ns.step == "pages":
        # The file must be empty, or hold only this run's initial Cover: anything else is
        # someone's work, and the build does not write around it.
        if data.get("foreign"):
            raise SystemExit("pages: the file holds pages design-lab did not create ("
                             + ", ".join(data["foreign"]) + "); the build needs an empty file, or one holding only "
                             "this run's initial Cover")
        if state.get("preflightCover") and data["pages"].get("Cover") != state["preflightCover"]:
            raise SystemExit(f"pages: the Cover page is {data['pages'].get('Cover')}, not the page connect drew "
                             f"({state['preflightCover']}); the build must fill in the initial Cover, not add another")
    if ns.step.startswith("compare:") and data.get("file"):
        import figma_compare
        cid = ns.step.split(":", 1)[1]
        geo = result(project, "block:" + cid)["geometry"]
        data = {"file": data["file"], **figma_compare.compare(Path(data["file"]), geo,
                                                             masks=text_masks(project, cid, geo))}
    (project / "figma" / "results" / f"{safe(ns.step)}.json").write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")
    state["done"].append(ns.step)
    sp.write_text(json.dumps(state, indent=1) + "\n")
    print(json.dumps({"recorded": ns.step, "remaining": len(state["steps"]) - len(state["done"])}))
    return 0


def cmd_status(ns) -> int:
    project = Path(ns.project).resolve()
    state = json.loads((project / "figma" / "state.json").read_text())
    nxt = pending(state)
    print(json.dumps({"done": len(state["done"]), "total": len(state["steps"]), "next": nxt["id"] if nxt else None,
                      "planned": len(library_counts.planned_ids(state)),
                      "built": len(library_counts.recorded_ids(state)), "runtime": state["runtime"]}))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("init")
    i.add_argument("--project", required=True)
    i.add_argument("--file-key", required=True)
    i.add_argument("--site-url", required=True)
    i.add_argument("--canonical-base-url", required=True)
    i.add_argument("--offline-images", action="store_true", help="use only the saved image cache")
    i.add_argument("--only", help="comma-separated component ids: a smoke build of a subset")
    i.add_argument("--rebuild", action="store_true",
                   help="rebuild in the same file: a first step clears this run's earlier build")
    i.add_argument("--iterate", action="store_true",
                   help="keep the runner connected after the build, waiting for the next init")
    for name in ("next", "status", "receipts"):
        sub.add_parser(name).add_argument("--project", required=True)
    r = sub.add_parser("record")
    r.add_argument("--project", required=True)
    r.add_argument("--step", required=True)
    r.add_argument("--result")
    ns = ap.parse_args()
    if ns.cmd == "receipts":
        return subprocess.run([sys.executable, str(HERE / "figma_receipts.py"), "--project", ns.project]).returncode
    return {"init": cmd_init, "next": cmd_next, "record": cmd_record, "status": cmd_status}[ns.cmd](ns)


if __name__ == "__main__":
    raise SystemExit(main())
