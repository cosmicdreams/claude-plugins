#!/usr/bin/env python3
"""Render a design-lab scorecard as one self-contained HTML report.

Called by score_run.py. Inline CSS, inline SVG charts and base64 WebP thumbnails, so the file
can be mailed, opened offline or shown in a recording. Every chart has a text equivalent.
"""
from __future__ import annotations

import base64
import datetime as dt
import html
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import library_counts  # noqa: E402  the Cover's category colors, shared with cover.js

BREAKPOINT_NAMES = {"desktop": "Desktop", "tablet": "Tablet", "mobile": "Mobile"}
BP_ORDER = {"desktop": 0, "tablet": 1, "mobile": 2}
RATIO_EDGES = (0.02, 0.04, 0.06, 0.09, 0.12, 0.18, 0.25, 0.35, 0.5)
HEIGHT_EDGES = (1, 2, 5, 10, 25, 50, 100)
# Closeness bins on the corrected changed-pixel share; strongest match first.
BINS = ((0.02, "q5", "under 2%"), (0.06, "q4", "2–6%"), (0.12, "q3", "6–12%"),
        (0.25, "q2", "12–25%"), (9.0, "q1", "over 25%"))
THUMB_WIDTH = 520
THUMB_MAX_HEIGHT = 300


def esc(value) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def num(value) -> str:
    if value is None:
        return "–"
    if isinstance(value, float) and not value.is_integer():
        return f"{value:,.1f}"
    return f"{int(value):,}"


def pct(ratio, digits=0) -> str:
    return "–" if ratio is None else f"{ratio * 100:.{digits}f}%"


def duration(seconds) -> str:
    if seconds is None:
        return "–"
    seconds = int(seconds)
    if seconds < 90:
        return f"{seconds} s"
    hours, rest = divmod(seconds, 3600)
    if hours:
        return f"{hours} h {round(rest / 60)} min"
    return f"{rest // 60} min {rest % 60} s" if rest % 60 else f"{rest // 60} min"


def split_duration(seconds) -> tuple[str, str]:
    """A verdict figure and its unit: 5 min 27 s is ("5", " min 27 s"); 2 h 10 min is ("2", " h 10 min")."""
    seconds = int(round(seconds))
    if seconds < 90:
        return str(seconds), " s"
    hours, rest = divmod(seconds, 3600)
    if hours:
        return str(hours), f" h {round(rest / 60)} min"
    return str(rest // 60), f" min {rest % 60} s" if rest % 60 else " min"


def day(value) -> str:
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00")).strftime("%-d %B %Y")
    except (TypeError, ValueError):
        return "date not recorded"


def stamp(value) -> str:
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone().strftime("%-d %b %H:%M")
    except (TypeError, ValueError):
        return "–"


def compact(value) -> str:
    if value is None:
        return "–"
    for size, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "k")):
        if value >= size:
            figure = value / size
            return (f"{figure:.1f}" if figure < 10 else f"{figure:.0f}") + suffix
    return str(value)


def coverage_strip(cov: dict) -> str:
    """One square per component found. Built squares wear their Cover category color (High, Medium,
    Low, Other, in the Cover's order); the gap (could have been built) is outlined; components that
    are not counted are hatched, retirement candidates in the reserved crimson. The strip sits on the
    Cover's navy in light and dark modes alike, so the colors look exactly as they do on the Cover."""
    if cov.get("status") != "measured":
        return ""
    labels = cov.get("reasonLabels") or {}
    items = cov.get("items") or []
    breakdown = cov.get("coverBreakdown") or [{"tier": library_counts.OTHER, "built": cov["built"]}]
    squares = []
    for row in breakdown:
        name = library_counts.COVER_LABELS.get(row["tier"], row["tier"])
        squares += [f'<span class="c-built" style="background:{library_counts.TIER_COLORS[row["tier"]]}" '
                    f'data-tier="{esc(row["tier"])}" title="built · {esc(name)}"></span>'] * row["built"]
    gap_first = sorted(items, key=lambda item: item["reason"] not in (cov.get("gap") or {}))
    for item in gap_first:
        kind = ("c-gap" if item["reason"] in (cov.get("gap") or {}) else
                "c-out c-retire" if item["reason"] == "retirement" else "c-out")
        squares.append(f'<span class="{kind}" title="{esc(item["label"])}: {esc(labels.get(item["reason"]))}"></span>')
    gap = [f"{n} {labels.get(k, k)}" for k, n in (cov.get("gap") or {}).items() if n]
    out = [f'<span class="key {"key-retire" if k == "retirement" else "key-out"}"></span>'
           f"{n} {esc(labels.get(k, k))}{'s' if n != 1 and k == 'retirement' else ''}"
           for k, n in (cov.get("excluded") or {}).items() if n]
    usage = cov.get("usageWeighted") or {}
    parts = [f'<span class="key" style="--k:{library_counts.TIER_COLORS[row["tier"]]}"></span>'
             f'<b>{row["built"]}</b> {esc(library_counts.COVER_LABELS.get(row["tier"], row["tier"]))}'
             for row in breakdown]
    if gap:
        parts.append('<span class="key key-gap"></span>not built: ' + "; ".join(esc(g) for g in gap))
    if out:
        parts.append("not counted: " + "; ".join(out))
    weighted = (f'<p class="cov-w">Built components carry <b>{num(usage["covered"])} of {num(usage["placements"])}</b> '
                f'placements on the site (<b>{usage["ratio"] * 100:.0f}%</b>)'
                + (f' and {num(usage["structuralCovered"])} of {num(usage["structuralRefs"])} nested uses'
                   if usage.get("structuralRefs") else "") + ".</p>") if usage.get("placements") else ""
    outside = cov.get("outsideInventory") or []
    if outside and weighted:
        op, os_ = sum(o["placements"] for o in outside), sum(o["structural"] for o in outside)
        weighted = weighted.replace("</p>", f' The usage scan also saw {len(outside)} item{"s" if len(outside) != 1 else ""} '
                                    f'outside the inventory ({op} placement{"s" if op != 1 else ""}, {os_} nested '
                                    f'use{"s" if os_ != 1 else ""}), not counted here.</p>', 1)
    return (f'<div class="cov" role="img" aria-label="{esc(cov.get("summary"))}" style="--ground:{library_counts.COVER_GROUND}">'
            f'<div class="cov-sq" aria-hidden="true">{"".join(squares)}</div>'
            f'<p class="cov-k">{" · ".join(parts)}</p></div>{weighted}')


def bin_of(ratio):
    for limit, name, _ in BINS:
        if ratio <= limit:
            return name
    return "q1"


STATUS = {
    "measured": ("Measured", "●"),
    "partial": ("Partly measured", "◐"),
    "not-measured": ("Not measured", "○"),
    "scored-later": ("Scored later", "◌"),
}


def status_tag(status: str) -> str:
    label, glyph = STATUS.get(status, (status, "·"))
    return f'<span class="tag tag-{esc(status)}"><span aria-hidden="true">{glyph}</span> {esc(label)}</span>'


def section(ident: str, title: str, status: str, lead: str, body: str) -> str:
    return (f'<section class="sec" id="{ident}" aria-labelledby="{ident}-h">'
            f'<header class="sec-head"><h2 id="{ident}-h">{esc(title)}</h2>{status_tag(status)}</header>'
            f'<p class="lead">{lead}</p>{body}</section>')


def absent(title: str, part: dict) -> str:
    how = part.get("howToMeasure")
    return (f'<div class="absent" role="note"><p class="absent-t">{esc(title)}</p>'
            f'<p>{esc(part.get("reason") or "No evidence for this run.")}</p>'
            + (f'<p class="how"><span>Next run:</span> {esc(how)}</p>' if how else "") + "</div>")


# ------------------------------------------------------------------------------ thumbnails

def thumbnails(run_dir: Path, pairs: list[dict], breakpoint: str) -> dict:
    """Crop Figma and live regions for one breakpoint out of each specimen screenshot."""
    try:
        from PIL import Image
    except ImportError:
        return {}
    wanted = {p["component"]: p for p in pairs if p["breakpoint"] == breakpoint and p.get("evidence")}
    result = {}
    for component, pair in wanted.items():
        evidence = pair["evidence"]
        specimen = run_dir / evidence["specimen"]
        geometry = (json.loads((run_dir / evidence["geometry"]).read_text(encoding="utf-8"))
                    .get("geometry") or {})
        try:
            variant = geometry["variants"][evidence["index"]]
            capture = geometry["captures"][evidence["index"]]
            with Image.open(specimen) as raw:
                canvas = Image.new("RGB", raw.size, "white")
                rgba = raw.convert("RGBA")
                canvas.paste(rgba, mask=rgba.split()[-1])
        except (OSError, KeyError, IndexError, ValueError):
            continue
        shots = {}
        for side, box in (("figma", variant), ("live", capture)):
            x, y = round(box["x"]), round(box["y"])
            crop = canvas.crop((x, y, x + round(box["width"]), y + round(box["height"])))
            scale = min(1.0, THUMB_WIDTH / max(1, crop.width))
            crop = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
                               Image.LANCZOS)
            cropped = crop.height > THUMB_MAX_HEIGHT
            if cropped:
                crop = crop.crop((0, 0, crop.width, THUMB_MAX_HEIGHT))
            buffer = io.BytesIO()
            crop.save(buffer, "WEBP", quality=72, method=5)
            shots[side] = {"src": "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode(),
                           "w": crop.width, "h": crop.height, "cropped": cropped}
        result[component] = shots
    return result


# ------------------------------------------------------------------------------ charts

def field(accuracy: dict) -> str:
    """The signature: every component at every width, shaded by closeness to the live site."""
    pairs = accuracy.get("pairs") or []
    metric = "corrected" if pairs and pairs[0].get("corrected") else "original"
    components = {}
    for p in pairs:
        components.setdefault(p["component"], {})[p["breakpoint"]] = p
    # Passing widths first, then closeness, so the ticks and the order tell the same story.
    rows = [b for b in ("desktop", "tablet", "mobile") if any(b in v for v in components.values())]

    def verdicts(c):
        return tuple(not (components[c].get(b) or {}).get(metric, {}).get("pass") for b in rows)
    # Most passing widths first, then grouped by which widths pass, then by closeness: the ticks
    # form solid blocks instead of scattering among worse squares.
    order = sorted(components, key=lambda c: (sum(verdicts(c)), verdicts(c),
                                              sum(v[metric]["ratio"] for v in components[c].values())
                                              / max(1, len(components[c]))))
    cell, gap, label_w = 30, 4, 86
    width = label_w + len(order) * (cell + gap)
    height = len(rows) * (cell + gap)
    out = [f'<svg class="field-svg" viewBox="0 0 {width} {height}" role="img" '
           f'aria-labelledby="field-t field-d"><title id="field-t">Closeness to the live site, '
           f'every component at every width</title><desc id="field-d">{esc(field_desc(accuracy, metric))}</desc>']
    for r, name in enumerate(rows):
        y = r * (cell + gap)
        out.append(f'<text class="f-row" x="{label_w - 12}" y="{y + cell / 2 + 4}" text-anchor="end">'
                   f'{BREAKPOINT_NAMES.get(name, name)}</text>')
        for c, component in enumerate(order):
            pair = components[component].get(name)
            x = label_w + c * (cell + gap)
            if not pair:
                out.append(f'<rect class="f-none" x="{x}" y="{y}" width="{cell}" height="{cell}" rx="3"/>')
                continue
            value = pair[metric]
            tip = (f"{pair['label']} · {BREAKPOINT_NAMES.get(name, name)} {pair.get('width')}px · "
                   f"{pct(value['ratio'], 1)} of pixels differ"
                   + (f" (original measure {pct(pair['original']['ratio'], 1)})" if metric == "corrected" else "")
                   + (f" · {num(pair.get('heightDelta'))}px height difference" if pair.get("heightDelta") else "")
                   + (" · within tolerance" if value["pass"] else ""))
            out.append(f'<g class="f-cell" tabindex="0" data-tip="{esc(tip)}"><rect class="{bin_of(value["ratio"])}" '
                       f'x="{x}" y="{y}" width="{cell}" height="{cell}" rx="3"/>'
                       + (f'<path class="f-check" d="M{x + 9} {y + 15.5}l4.5 4.5 8-9"/>' if value["pass"] else "")
                       + "</g>")
    out.append("</svg>")
    legend = "".join(f'<li><span class="sw {name}"></span>{esc(text)}</li>' for _, name, text in BINS)
    threshold = pct(accuracy.get("threshold"), 0)
    return ("".join(out) +
            f'<div class="field-key"><p class="mono">Pixels that differ from the live capture</p>'
            f'<ul class="bins">{legend}</ul><p class="mono key-note"><svg width="14" height="12" aria-hidden="true">'
            f'<path class="f-check key" d="M1 6l4 4 8-9"/></svg> within the {threshold} tolerance</p></div>')


def field_desc(accuracy, metric):
    parts = []
    for name, value in (accuracy.get("byBreakpoint") or {}).items():
        m = value.get(metric) or {}
        parts.append(f"{BREAKPOINT_NAMES.get(name, name)}: {m.get('pass')} of {m.get('total')} within tolerance, "
                     f"median {pct(m.get('medianRatio'), 1)} of pixels differ")
    return "; ".join(parts) + "."


def pass_bars(accuracy: dict) -> str:
    rows = [(name, value) for name, value in (accuracy.get("byBreakpoint") or {}).items()]
    if not rows:
        return ""
    total = max(value["original"]["total"] for _, value in rows) or 1
    bar_h, gap, group_gap, label_w, plot_w = 12, 4, 22, 70, 330
    height = len(rows) * (2 * bar_h + gap + group_gap)
    out = [f'<svg class="bars" viewBox="0 0 {label_w + plot_w + 90} {height}" role="img" aria-labelledby="pb-t">'
           f'<title id="pb-t">Widths within tolerance, original and corrected measure, by breakpoint</title>']
    out.append(f'<line class="axis" x1="{label_w}" x2="{label_w}" y1="0" y2="{height - group_gap + 6}"/>')
    for i, (name, value) in enumerate(rows):
        y = i * (2 * bar_h + gap + group_gap)
        out.append(f'<text class="axis-l" x="{label_w - 12}" y="{y + bar_h + 5}" text-anchor="end">'
                   f'{BREAKPOINT_NAMES.get(name, name)}</text>')
        for j, metric in enumerate(("original", "corrected")):
            m = value.get(metric)
            if not m:
                continue
            w = max(2, m["pass"] / total * plot_w)
            by = y + j * (bar_h + gap)
            out.append(f'<g tabindex="0" data-tip="{BREAKPOINT_NAMES.get(name, name)}, {metric} measure: '
                       f'{m["pass"]} of {m["total"]} within tolerance">'
                       f'<path class="bar {metric}" d="{bar_path(label_w, by, w, bar_h)}"/>'
                       f'<text class="val" x="{label_w + w + 8}" y="{by + bar_h - 2}">{m["pass"]}'
                       f'<tspan class="of"> of {m["total"]}</tspan></text></g>')
    out.append("</svg>")
    return "".join(out)


def bar_path(x, y, w, h, r=4):
    r = min(r, w / 2, h / 2)
    return (f"M{x} {y}h{w - r}a{r} {r} 0 0 1 {r} {r}v{h - 2 * r}a{r} {r} 0 0 1 -{r} {r}h-{w - r}z")


def dot_histogram(values, *, edges, threshold_bins=None, title, fmt, rows=None) -> str:
    """Stacked dots in ordinal bins with printed edges: honest, compact, no smoothing."""
    labels = [f"≤{fmt(edges[0])}"] + [f"{fmt(a)}–{fmt(b)}" for a, b in zip(edges, edges[1:])] + [f">{fmt(edges[-1])}"]
    bins = [[] for _ in labels]
    for v in values:
        index = next((i for i, edge in enumerate(edges) if v <= edge), len(edges))
        bins[index].append(v)
    width, left, dot = 400, 2, 6
    col = (width - left * 2) / len(labels)
    cap = 9                     # taller stacks print "+n" rather than dominate the chart
    tallest = min(cap, max(1, rows or 0, max(len(b) for b in bins)))
    stack = tallest * (dot * 2 + 2)
    height = stack + 62
    base = stack + 22
    out = [f'<svg class="hist" viewBox="0 0 {width} {height}" role="img" aria-label="{esc(title)}: '
           + esc(", ".join(f"{len(b)} at {l}" for b, l in zip(bins, labels) if b)) + '">']
    if threshold_bins:
        out.append(f'<rect class="pass-zone" x="{left}" y="0" width="{threshold_bins * col}" height="{base}" rx="4"/>'
                   f'<text class="t-note" x="{left + 4}" y="14">within tolerance</text>')
    out.append(f'<line class="axis" x1="{left}" x2="{width - left}" y1="{base + 0.5}" y2="{base + 0.5}"/>')
    for i, items in enumerate(bins):
        cx = left + (i + 0.5) * col
        shown = sorted(items)[:cap - 1] if len(items) > cap else sorted(items)
        for k, v in enumerate(shown):
            cy = base - dot - 2 - k * (dot * 2 + 2)
            out.append(f'<circle class="dot" cx="{cx:.1f}" cy="{cy:.1f}" r="{dot - 0.5}" tabindex="0" '
                       f'data-tip="{esc(fmt(v, precise=True))}"/>')
        if len(items) > cap:
            cy = base - dot - 2 - (cap - 1) * (dot * 2 + 2)
            out.append(f'<text class="cnt" x="{cx:.1f}" y="{cy + 4:.1f}" text-anchor="middle">+{len(items) - cap + 1}</text>')
        out.append(f'<text class="tick" x="{cx:.1f}" y="{base + 18}" text-anchor="middle">{esc(labels[i])}</text>')
        if items:
            out.append(f'<text class="cnt" x="{cx:.1f}" y="{base + 36}" text-anchor="middle">{len(items)}</text>')
    out.append("</svg>")
    return "".join(out)


def bar_list(items, *, unit_fmt, title) -> str:
    if not items:
        return ""
    peak = max(v for _, v in items) or 1
    row, label_w, plot_w = 24, 150, 360
    height = len(items) * row
    out = [f'<svg class="bars" viewBox="0 0 {label_w + plot_w + 80} {height}" role="img" aria-label="{esc(title)}">']
    for i, (name, value) in enumerate(items):
        y = i * row
        w = max(2, value / peak * plot_w)
        out.append(f'<text class="axis-l" x="{label_w - 10}" y="{y + 15}" text-anchor="end">{esc(name)}</text>'
                   f'<path class="bar corrected" d="{bar_path(label_w, y + 5, w, 12)}"/>'
                   f'<text class="val" x="{label_w + w + 8}" y="{y + 15}">{esc(unit_fmt(value))}</text>')
    out.append("</svg>")
    return "".join(out)


# ------------------------------------------------------------------------------ sections

def hero(card: dict) -> str:
    s = card["sections"]
    head = card["headline"]
    identity = s["identity"].get("fields") or {}
    lib = s["library"]
    built = head["built"]
    acc = head["accuracy"]
    corr, orig = acc.get("corrected"), acc.get("original")
    effort = head["effort"]
    repeat = s["repeatability"]

    cov = s.get("coverage") or {}
    if cov.get("status") == "measured" and cov.get("eligible"):
        title = (f"Built {cov['built']} of {cov['eligible']} components it could have built "
                 f"({cov['ratio'] * 100:.0f}%).")
    elif built.get("components"):
        title = f"{num(built.get('components'))} components, rebuilt in Figma from the live site."
    else:
        title = "A design-lab run, scored."
    commit = (identity.get("repositoryCommit") or "")[:7]
    dek = (f"Built {day(identity.get('startedAt'))} with design-lab {esc(identity.get('pluginVersion'))}"
           + (f" from repository commit <code>{esc(commit)}</code>" if commit else "")
           + ". Every figure on this page is measured from the evidence the run left behind; "
             "anything that was not recorded says so.")

    yield_items = [("components", built.get("components")), ("variants", built.get("variants")),
                   ("variables", built.get("variables")), ("pages", built.get("pages")),
                   ("Figma nodes", built.get("nodes"))]
    yields = "".join(f'<div class="y"><dt>{esc(label)}</dt><dd>{num(value)}</dd></div>'
                     for label, value in yield_items if value) if built.get("components") else ""

    coverage_html = coverage_strip(cov)

    def verdict(label, figure, unit, caption, state="measured"):
        return (f'<div class="v v-{state}"><p class="v-l">{esc(label)}</p>'
                f'<p class="v-n">{figure}<span class="v-u">{unit}</span></p><p class="v-c">{caption}</p></div>')

    blocks = []
    if corr:
        median_match = 1 - corr["medianRatio"] if corr.get("medianRatio") is not None else None
        blocks.append(verdict(
            "Faithful to the live site", f'{corr["pass"]}', f' of {corr["total"]}',
            f"widths within {pct(s['accuracy'].get('threshold'))} of the live capture on the corrected measure; "
            f"{orig['pass']} of {orig['total']} on the original. The typical width matches "
            f"{pct(median_match)} of live pixels."))
    elif orig:
        blocks.append(verdict("Faithful to the live site", f'{orig["pass"]}', f' of {orig["total"]}',
                              "widths within tolerance on the original measure."))
    else:
        blocks.append(verdict("Faithful to the live site", "–", "", "not measured for this run", "none"))
    runner = s["cost"].get("runner") or {}
    working = s["cost"].get("working") or {}
    made = working.get("production") or {}
    build = (f"The Figma build itself took {duration(runner['activeSeconds'])} over {num(runner['steps'])} steps, "
             f"with no model in the loop." if runner.get("steps") else "No runner log for this run.")
    if made.get("status") == "measured":
        waits = [f"{duration(made[k])} waiting on {what}" for k, what in
                 (("waitingOnPersonSeconds", "the person"), ("waitingOnLimitsSeconds", "usage limits"),
                  ("waitingOnServiceSeconds", "the service")) if made.get(k)]
        bench = working.get("benchmark") or {}
        figure, unit = split_duration(made["workingSeconds"])
        blocks.append(verdict(
            "design-lab took", figure, unit,
            "of working time to produce the library, when Claude or its tools were working"
            + (f"; {', '.join(waits)} not counted" if waits else "")
            + (f". The benchmark took {duration(bench['workingSeconds'])} more" if bench.get("status") == "measured" else "")
            + ". " + build))
    elif runner.get("steps"):
        figure, unit = split_duration(runner["activeSeconds"])
        blocks.append(verdict("Figma build time", figure, unit,
                              f"{num(runner['steps'])} steps written by the runner, no model in the loop. "
                              "Working time was not measured for this run: score it with --session &lt;id&gt; "
                              "to measure when Claude or its tools were working."))
    else:
        blocks.append(verdict("Working time", "–", "", "not measured for this run; score with --session "
                              "&lt;id&gt; to measure when Claude or its tools were working", "none"))
    model = s["cost"].get("model") or {}
    production = (model.get("production") or {}).get("byModel") or []
    if model.get("status") == "measured" and production:
        top, others = production[0], production[1:]
        bench = model.get("benchmark") or {}
        added = ("; benchmarking added " + (", ".join(f"{num(r['total'])} {esc(r['name'])}" for r in bench["byModel"]) or "none")
                 if bench.get("status") == "measured" else "; benchmark tokens not separated")
        caption = (f"Used {num(top['total'])} {esc(top['name'])} tokens to produce the library, "
                   f"{num(top['output'])} of them output"
                   + ("; also " + ", ".join(f"{num(r['total'])} {esc(r['name'])}" for r in others) if others else "")
                   + added + ".")
        blocks.append(verdict(f"{top['name']} tokens", compact(top["total"]), "", caption))
    else:
        blocks.append(verdict("Model tokens", "–", "", "not measured for this run; score with --session "
                              "&lt;id&gt; to count them by model", "none"))
    if repeat.get("status") == "measured":
        scored = [row for row in repeat["comparisons"] if "score" in row]
        ident = min(row["identicalApartFromAddresses"] for row in scored)
        total = max(row["totalNodes"] for row in scored)
        blocks.append(verdict("Repeatable", f"{ident / total * 100:.2f}", "%",
                              f"of {num(total)} nodes identical across {len(scored) + 1} runs, apart from "
                              f"each file's own links."))
    else:
        blocks.append(verdict("Repeatable", "–", "", "one run only; score with --compare after a second run",
                              "none"))

    # The build-time highlight is already a verdict block above; do not say it twice.
    highs = "".join(f"<li>{esc(h)}</li>" for h in head.get("highlights") or []
                    if not h.startswith("The Figma build ran"))
    fld = ""
    if s["accuracy"].get("pairs"):
        fld = (f'<figure class="field"><figcaption><span class="mono">Every width, every component</span>'
               f'<span>Most widths within tolerance first, grouped by which widths pass, then by closeness. Hover or '
               f'focus a square for its numbers.</span></figcaption>{field(s["accuracy"])}</figure>')
    return (f'<section class="hero" aria-labelledby="hero-h"><p class="site">{esc(card["run"]["siteLabel"])}</p>'
            f'<h1 id="hero-h">{esc(title)}</h1>{coverage_html}<p class="dek">{dek}</p>'
            + (f'<dl class="yield">{yields}</dl>' if yields else "") + f'<div class="verdicts">{"".join(blocks)}</div>'
            + (f'<ul class="highlights" aria-label="Highlights">{highs}</ul>' if highs else "")
            + f"{fld}</section>")


def library_section(lib: dict, cov: dict) -> str:
    if lib.get("status") == "not-measured":
        return section("library", "What the run built", "not-measured", "Nothing to count.", absent("Library contents", lib))
    comp = lib["components"]
    labels = cov.get("reasonLabels") or {}
    if cov.get("status") == "measured":
        # The same split and wording as the coverage strip, every number from library_counts.
        plural = lambda k, n: f"{labels.get(k, k)}{'s' if n != 1 and k == 'retirement' else ''}"
        steps = [("", cov["found"], "found in the source")]
        steps += [("muted", n, f"{plural(k, n)} not counted") for k, n in cov["excluded"].items() if n]
        steps += [("", cov["eligible"], "it could have built"), ("", cov["built"], "built in Figma")]
        steps += [("muted", n, labels.get(k, k)) for k, n in cov["gap"].items() if n]
    else:
        steps = [("", comp.get("found"), "found in the source"), ("", comp.get("planned"), "planned to build"),
                 ("", comp.get("built"), "built in Figma"), ("muted", comp.get("refused"), "refused by the plan")]
    funnel = '<ol class="funnel">' + "".join(
        (f'<li class="{c}">' if c else "<li>") + f"<b>{num(n)}</b> {esc(text)}</li>" for c, n, text in steps) + "</ol>"
    rows = lib.get("tierTable") or []

    def holds(tiers):
        return "; ".join(f'{h["tier"]}: {h["built"]} of {h["found"]} built' for h in tiers)
    peak = max((r["found"] for r in rows), default=0) or 1
    tier_rows = "".join(
        ('<tr>' if r["counted"] else '<tr class="out">') + f'<th scope="row"><span class="t-sw" style="background:{r["color"]}"></span>'
        f'{esc(r["label"])}'
        + (f'<span class="t-note">{esc(holds(r["holds"]))}</span>' if r.get("holds") else "")
        + ('<span class="t-note">not counted</span>' if not r["counted"] else "")
        + f'</th><td class="n">{num(r["built"])}</td><td class="n">{num(r["found"])}</td>'
        f'<td><span class="t-bar" style="--v:{r["built"] / peak};--f:{r["found"] / peak};--c:{r["color"]}"></span></td></tr>'
        for r in rows)
    total = sum(r["built"] for r in rows if r["counted"])
    tier_table = (f'<div class="tier-panel" style="--ground:{library_counts.COVER_GROUND}"><table class="tbl tiers">'
                  f'<caption>By usage tier, as on the Cover</caption><thead><tr><th scope="col">Category</th>'
                  f'<th scope="col" class="n">Built</th><th scope="col" class="n">Found</th><th scope="col"><span class="sr">Built out of found</span></th></tr></thead>'
                  f'<tbody>{tier_rows}<tr class="sum"><th scope="row">Total</th><td class="n">{num(total)}</td><td class="n">'
                  f'{num(sum(r["found"] for r in rows))}</td><td></td></tr></tbody></table></div>') if tier_rows else ""
    pages = "".join(f"<li>{esc(p)}</li>" for p in lib.get("pageNames") or [])
    extras = []
    if lib.get("voicePage"):
        extras.append("a brand voice and language page")
    if lib.get("examplesPage"):
        extras.append("an examples page assembled from real compositions")
    if cov.get("status") == "measured":
        def why(item):
            return (f'<li><b>{esc(item["label"])}</b> — {esc(labels.get(item["reason"], item["reason"]))}'
                    + (f': {esc(item["detail"])}' if item.get("detail") else "") + "</li>")
        gap_items = [i for i in cov.get("items") or [] if i["reason"] in cov["gap"]]
        out_items = [i for i in cov.get("items") or [] if i["reason"] not in cov["gap"]]
        not_built = ((f'<h3>Not built, and why</h3><ul class="plain">{"".join(why(i) for i in gap_items)}</ul>' if gap_items else "")
                     + (f'<h3 class="h-gap">Not counted, and why</h3><ul class="plain">{"".join(why(i) for i in out_items)}</ul>'
                        if out_items else ""))
    else:
        items = "".join(f'<li><b>{esc(i["label"] or i["id"])}</b> — {esc(i["reason"])}</li>'
                        for i in lib.get("notBuiltReasons") or [])
        not_built = f'<h3>Not built, and why</h3><ul class="plain">{items}</ul>' if items else ""
    lead = ((f"{num(comp.get('built'))} components with " if comp.get("built") is not None else
             f"No build was recorded; the plan holds {num(comp.get('planned'))} components with ")
            + f"{num(lib.get('variants'))} variants and "
            f"{num(lib.get('properties'))} properties, bound to {num(lib.get('variables'))} variables"
            + (", plus " + " and ".join(extras) if extras else "") + ".")
    body = (f'<div class="two">{funnel}{tier_table}</div>'
            f'<div class="two"><div>' + (f'<h3>Pages in the file</h3><ul class="chips">{pages}</ul>' if pages else "") + '</div>'
            + (f'<div>{not_built}</div>' if not_built else "")
            + "</div>")
    return section("library", "What the run built", "measured", esc(lead), body)


def accuracy_section(acc: dict, thumbs: dict) -> str:
    if acc.get("status") == "not-measured":
        return section("accuracy", "Accuracy against the live site", "not-measured",
                       "No comparison evidence.", absent("Accuracy", acc))
    corrected = acc["overall"].get("corrected")
    orig = acc["overall"]["original"]
    lead = (f"Each component is compared with its live capture at every width. "
            + (f"{corrected['pass']} of {corrected['total']} widths are within tolerance on the corrected measure, "
               f"{orig['pass']} of {orig['total']} on the original one." if corrected else
               f"{orig['pass']} of {orig['total']} widths are within tolerance on the original measure."))
    metrics = acc.get("metrics") or {}
    explain = (f'<dl class="defs"><div><dt><span class="key-sw original"></span>Original measure</dt><dd>{esc(metrics.get("original"))}</dd></div>'
               f'<div><dt><span class="key-sw corrected"></span>Corrected measure</dt><dd>{esc(metrics.get("corrected"))} '
               f'A width passes when no more than {pct(acc.get("threshold"))} of its pixels differ by over '
               f'{esc(acc.get("tolerance"))} levels.</dd></div></dl>')
    chart = (f'<figure class="chart"><figcaption><h3>Widths within tolerance</h3>'
             f'<p>Out of {num(orig["total"] // max(1, len(acc["byBreakpoint"])))} components per breakpoint.</p>'
             f'</figcaption>{pass_bars(acc)}</figure>')
    metric = "corrected" if corrected else "original"
    multiples = []
    def ratio_fmt(v, precise=False):
        return pct(v, 1) if precise else f"{v * 100:g}"

    def height_fmt(v, precise=False):
        return f"{v:g} px" if precise else f"{v:g}"

    def tallest(values_by_bp, edges):
        peak = 1
        for values in values_by_bp:
            counts = {}
            for v in values:
                i = next((k for k, e in enumerate(edges) if v <= e), len(edges))
                counts[i] = counts.get(i, 0) + 1
            peak = max([peak, *counts.values()])
        return peak

    groups = [[p for p in acc["pairs"] if p["breakpoint"] == n] for n in acc["byBreakpoint"]]
    ratio_rows = tallest([[p[metric]["ratio"] for p in g] for g in groups], RATIO_EDGES)
    height_rows = tallest([[p["heightDelta"] or 0 for p in g] for g in groups], HEIGHT_EDGES)
    for name, value in acc["byBreakpoint"].items():
        subset = [p for p in acc["pairs"] if p["breakpoint"] == name]
        m = value[metric]
        h = value["heightDelta"]
        multiples.append(
            f'<div class="sm"><h4>{BREAKPOINT_NAMES.get(name, name)}</h4>'
            f'<p class="sm-stat">Pixels that differ, percent · median <b>{pct(m["medianRatio"], 1)}</b></p>'
            + dot_histogram([p[metric]["ratio"] for p in subset], edges=RATIO_EDGES,
                            threshold_bins=sum(1 for e in RATIO_EDGES if e <= (acc.get("threshold") or 0)),
                            title=f"{BREAKPOINT_NAMES.get(name, name)}: components by share of pixels that differ",
                            fmt=ratio_fmt, rows=ratio_rows)
            + f'<p class="sm-stat">Height difference, pixels · <b>{h["over10px"]}</b> off by more than 10</p>'
            + dot_histogram([p["heightDelta"] or 0 for p in subset], edges=HEIGHT_EDGES,
                            title=f"{BREAKPOINT_NAMES.get(name, name)}: components by height difference",
                            fmt=height_fmt, rows=height_rows)
            + "</div>")
    dist = (f'<figure class="chart"><figcaption><h3>How far off, at each breakpoint</h3><p>One dot per component. '
            f'Top: share of pixels that differ ({metric} measure); the shaded bins are within tolerance. '
            f'Bottom: height difference between the Figma component and the live element. The number under '
            f'each bin counts its components.</p></figcaption>'
            f'<div class="smalls">{"".join(multiples)}</div></figure>')
    table = accuracy_table(acc, metric)
    gallery = gallery_html(acc, thumbs, metric)
    return section("accuracy", "Accuracy against the live site", acc["status"], esc(lead),
                   f'<div class="acc-top">{explain}{chart}</div>' + dist + gallery + table)


def accuracy_table(acc, metric):
    comps = {}
    for p in acc["pairs"]:
        comps.setdefault((p["label"], p["component"]), {})[p["breakpoint"]] = p
    names = list(acc["byBreakpoint"].keys())
    head = "".join(f'<th scope="col" class="n">{BREAKPOINT_NAMES.get(n, n)}</th>' for n in names)
    rows = []
    for (label, _), by in sorted(comps.items()):
        cells = []
        for n in names:
            p = by.get(n)
            if not p:
                cells.append('<td class="n">–</td>')
                continue
            c = p.get("corrected")
            cells.append(f'<td class="n">{pct(p["original"]["ratio"], 1)} · '
                         + (f'<b>{pct(c["ratio"], 1)}</b> ' if c else "")
                         + ('<span class="ok" aria-label="within tolerance">✓</span>' if p[metric]["pass"] else
                            '<span class="no" aria-label="outside tolerance">✕</span>')
                         + f'<br><span class="sub">height {num(p.get("heightDelta"))} px</span></td>')
        rows.append(f'<tr><th scope="row">{esc(label)}</th>{"".join(cells)}</tr>')
    return (f'<details class="data"><summary>Every comparison as a table ({len(acc["pairs"])} widths)</summary>'
            f'<table class="tbl wide"><caption>Pixels that differ: original · <b>corrected</b>, with the verdict '
            f'on the {metric} measure</caption><thead><tr><th scope="col">Component</th>{head}</tr></thead>'
            f'<tbody>{"".join(rows)}</tbody></table></details>')


def gallery_html(acc, thumbs, metric):
    if not thumbs:
        return ""
    comps = {}
    for p in acc["pairs"]:
        comps.setdefault(p["component"], {})[p["breakpoint"]] = p
    order = sorted(thumbs, key=lambda c: (-sum(v[metric]["pass"] for v in comps[c].values()),
                                          sum(v[metric]["ratio"] for v in comps[c].values()) / len(comps[c])))

    def card(component):
        by = comps[component]
        shots = thumbs[component]
        label = next(iter(by.values()))["label"]
        chips = "".join(
            f'<li class="{"pass" if p[metric]["pass"] else "fail"}"><span>{BREAKPOINT_NAMES.get(n, n)[0]}</span>'
            f'{pct(p[metric]["ratio"], 0)}<span class="sr"> of pixels differ at {BREAKPOINT_NAMES.get(n, n)}'
            f'{", within tolerance" if p[metric]["pass"] else ""}</span></li>'
            for n, p in sorted(by.items(), key=lambda item: BP_ORDER.get(item[0], 9)))
        figma = shots.get("figma") or {}
        wide = figma.get("w", 1) / max(1, figma.get("h", 1)) > 3.5

        def img(side, text):
            shot = shots.get(side)
            if not shot:
                return ""
            return (f'<figure class="shot{" cut" if shot["cropped"] else ""}"><figcaption>{text}</figcaption>'
                    f'<img src="{shot["src"]}" width="{shot["w"]}" height="{shot["h"]}" decoding="async" '
                    f'alt="{esc(label)}, {text.lower()}, desktop width"></figure>')
        return (f'<article class="card{" wide" if wide else ""}"><div class="card-h"><h4>{esc(label)}</h4>'
                f'<ul class="chips-bp" aria-label="Pixels that differ by breakpoint">{chips}</ul></div>'
                f'<div class="pair">{img("figma", "Figma")}{img("live", "Live site")}</div></article>')

    best, worst = order[:6], order[-4:] if len(order) > 10 else []
    rest = [c for c in order if c not in best and c not in worst]
    parts = [f'<div class="gallery-head"><h3>Side by side, at desktop width</h3><p>Figma component and live '
             f'capture, cut from the same specimen screenshot the comparison measured. Chips give the share of '
             f'pixels that differ at each breakpoint (D desktop, T tablet, M mobile); filled chips are within '
             f'tolerance.</p></div>',
             f'<h4 class="g-sub">Closest to the live site</h4><div class="gallery">{"".join(card(c) for c in best)}</div>']
    if worst:
        parts.append(f'<h4 class="g-sub">Furthest from the live site</h4><div class="gallery">'
                     f'{"".join(card(c) for c in worst)}</div>')
    if rest:
        parts.append(f'<details class="data more"><summary>Show the other {len(rest)} components</summary>'
                     f'<div class="gallery">{"".join(card(c) for c in rest)}</div></details>')
    return "".join(parts)


def repeat_section(rep: dict) -> str:
    if rep.get("status") == "not-measured":
        return section("repeatability", "Repeatability", "not-measured",
                       "One run cannot show that a second would match.", absent("Repeatability", rep))
    rows = []
    for row in rep["comparisons"]:
        if "error" in row:
            rows.append(f'<tr><th scope="row">{esc(row["run"])}</th><td colspan="4">{esc(row["error"])}</td></tr>')
            continue
        diffs = ", ".join(f"{k} {v}" + (" (file links)" if k == "docs" else "")
                          for k, v in row["categoryCounts"].items() if v) or "none"
        agree = row.get("accuracyAgreement")
        rows.append(f'<tr><th scope="row">{esc(row["run"])}</th><td class="n">{row["score"]:.2f}</td>'
                    f'<td class="n">{num(row["identicalApartFromAddresses"])} of {num(row["totalNodes"])}</td>'
                    f'<td>{esc(diffs)}</td><td>'
                    + (f'{agree["sameVerdict"]} of {agree["pairs"]} same verdict; ratios within {pct(agree["maxRatioDifference"], 2)}'
                       if agree else "–") + "</td></tr>")
    counts = {}
    for row in rep["comparisons"]:
        for d in row.get("artifactDifferences") or []:
            counts.setdefault(d["artifact"], set()).add(d["path"])
    note = esc(rep.get("levelNote"))
    if counts:
        note += " Values that differ: " + "; ".join(
            f"<code>{esc(name)}</code> {len(paths)}" for name, paths in sorted(counts.items())) + "."
    scored = [row for row in rep["comparisons"] if "score" in row]
    lead = (f"Compared node by node with {len(scored)} other run{'s' if len(scored) != 1 else ''} of the same site."
            if scored else "The comparison could not run.")
    body = (f'<table class="tbl wide"><caption>This run against each other run</caption><thead><tr>'
            f'<th scope="col">Other run</th><th scope="col" class="n">Score / 100</th>'
            f'<th scope="col" class="n">Nodes identical, apart from file links</th><th scope="col">Nodes that differ, by category</th>'
            f'<th scope="col">Accuracy results</th></tr></thead><tbody>{"".join(rows)}</tbody></table>'
            f'<p class="note">{note} The score counts documentation links as differences because each file '
            f'links to itself; the identical-node column does not.</p>')
    return section("repeatability", "Repeatability", rep["status"], esc(lead), body)


def cost_section(cost: dict) -> str:
    runner = cost.get("runner") or {}
    parts = []
    if runner.get("status") != "not-measured" and runner.get("sessions"):
        sessions = "".join(f'<li><b>{duration(s["seconds"])}</b> · {num(s["steps"])} steps · from {stamp(s["start"])}</li>'
                           for s in runner["sessions"])
        kinds = [(k, v) for k, v in (runner.get("secondsByKind") or {}).items() if v >= 1]
        parts.append(f'<div class="two"><div><h3>Runner sessions</h3><ul class="plain">{sessions}</ul>'
                     f'<p class="note">{num(runner.get("errors"))} errors and {num(runner.get("skipped"))} skipped '
                     f'steps logged. Times are the build machine\'s clock.</p></div>'
                     f'<figure class="chart"><figcaption><h3>Where the build time went</h3><p>Seconds per kind of step.'
                     f'</p></figcaption>{bar_list(kinds, unit_fmt=lambda v: f"{v:.0f} s", title="Seconds of build time by kind of step")}</figure></div>')
    else:
        parts.append(absent("Runner timing", runner))
    timings = cost.get("timings") or {}
    if timings.get("phases"):
        rows = "".join(f'<tr><th scope="row">{esc(r["phase"])}</th><td>{stamp(r["start"])}</td><td>{stamp(r["end"])}</td>'
                       f'<td class="n">{duration(r["seconds"])}</td></tr>' for r in timings["phases"])
        parts.append(f'<table class="tbl"><caption>Time per phase</caption><thead><tr><th scope="col">Phase</th>'
                     f'<th scope="col">Start</th><th scope="col">End</th><th scope="col" class="n">Wall clock</th></tr></thead><tbody>{rows}</tbody></table>'
                     '<p class="note">Each phase runs from the previous phase\'s end to its own; waiting is included, so these '
                     'are not working time.</p>')
    elif timings.get("checkpoints"):
        rows = "".join(f'<li><span class="mono">{stamp(c["at"])}</span> {esc(c["phase"])} {esc(c["status"])}</li>'
                       for c in timings["checkpoints"])
        parts.append(f'<div><h3>Phase checkpoints</h3><ul class="plain cols">{rows}</ul><p class="note">{esc(timings.get("note"))}</p></div>')
    clock = cost.get("clock") or {}
    working = cost.get("working") or {}
    time_rows = []
    if working.get("status") == "measured":
        for caption, part in (("To produce the library", working.get("production") or {}),
                              ("The benchmark", working.get("benchmark") or {})):
            if part.get("status") != "measured":
                time_rows.append((caption, None, part.get("reason") or "not measured"))
                continue
            time_rows += [(f"{caption}: working", part["workingSeconds"], "Claude or its tools working"),
                          (f"{caption}: waiting on the person", part["waitingOnPersonSeconds"],
                           "the assistant had finished, or a tool was waiting for the person's answer"),
                          (f"{caption}: waiting on usage limits", part["waitingOnLimitsSeconds"],
                           "after a rate, session, usage or spend limit, until it reset"),
                          (f"{caption}: waiting on the service", part["waitingOnServiceSeconds"],
                           "the service was overloaded or unavailable")]
    else:
        time_rows.append(("Working time", None, working.get("reason") or "not measured"))
    if runner.get("steps"):
        time_rows.append(("Figma build", runner["activeSeconds"], f"{num(runner['steps'])} runner steps, no model in the loop"))
    time_rows += [("Wall time", clock.get("wallSeconds"),
                   "workflow.py init to the end of the benchmark" if clock.get("wallSeconds") is not None
                   else f"not shown: {clock.get('notShownBecause') or 'its ends were not recorded'}"),
                  ("Scoring script alone", clock.get("scorerSeconds"), "this report's own computation")]
    approval = ('<p class="note">This session did not run with full access throughout, so a tool span may '
                'include a wait for the person\'s approval, counted here as working time.</p>'
                if working.get("fullAccess") is False else "")
    how = "" if working.get("status") == "measured" else (
        f'<p class="note"><b>Working time was not measured for this run.</b> To measure it, '
        f'{esc(working.get("howToMeasure") or "score with --session <id>")}.</p>')
    parts.append('<div style="margin-bottom:32px"><h3>Time</h3><table class="tbl"><caption>Measured intervals</caption><tbody>'
                 + "".join(f'<tr><th scope="row">{esc(n)}</th><td class="n">{duration(v) if v is not None else "–"}</td>'
                           f'<td class="sub">{esc(d)}</td></tr>' for n, v, d in time_rows)
                 + f'</tbody></table>{how}{approval}<p class="note"><b>How time is measured.</b> {esc(cost.get("definition"))}</p></div>')
    attended = cost.get("unattended") or {}
    if attended.get("status") == "measured":
        items = "".join(
            f'<li><span class="mono">{stamp(i["at"])}</span> {esc("A question to the person" if i["kind"] == "question" else "The run stopped: " + i["kind"][9:] if i["kind"].startswith("stopped: ") else "A turn that ended and waited for a prompt")} '
            f'during {esc(i["phase"])}' + (" (the plan review chosen at preflight)" if i["planned"] else "") + "</li>"
            for i in attended["interruptions"])
        headline_ = ("Ran unattended after preflight: yes." if attended["ranUnattended"] else
                     f'{attended["count"]} interruption{"s" if attended["count"] != 1 else ""} after preflight.')
        parts.append(f'<div style="margin-bottom:32px"><h3>{esc(headline_)}</h3>'
                     + (f'<ul class="plain">{items}</ul>' if items else "")
                     + f'<p class="note">From the preflight go-ahead at {stamp(attended["goAheadAt"])} to the benchmark\'s start, '
                       'every question the run asked the person and every turn that waited for a prompt. Waits before '
                       'the go-ahead are setup.</p></div>')
    else:
        parts.append(absent("Unattended after preflight", attended))
    warning = (cost.get("developer") or {}).get("sessionWarning")
    if warning:
        parts.append(f'<p class="note"><b>Which session was scored.</b> {esc(warning)}.</p>')
    model = cost.get("model") or {}
    if model.get("status") == "measured":
        def token_table(caption, part):
            rows = part.get("byModel") or []
            if not rows:
                return f'<p class="note">{esc(caption)}: no model turns.</p>'
            t = part["tokens"]
            body = "".join(
                f'<tr><th scope="row">{esc(r["name"])}<span class="sub"> {esc(r["model"]) if r["model"] != r["name"] else ""}</span></th>'
                + "".join(f'<td class="n">{num(r[k])}</td>' for k in ("input", "output", "cacheWrite", "cacheRead", "total", "turns", "toolCalls"))
                + "</tr>" for r in rows)
            foot = ('<tr class="sum"><th scope="row">All models</th>'
                    + "".join(f'<td class="n">{num(t[k])}</td>' for k in ("input", "output", "cacheWrite", "cacheRead", "total"))
                    + f'<td class="n">{num(part["turns"])}</td><td class="n">{num(part["toolCalls"])}</td></tr>')
            return (f'<table class="tbl wide"><caption>{esc(caption)}</caption><thead><tr><th scope="col">Model</th>'
                    f'<th scope="col" class="n">Input</th><th scope="col" class="n">Output</th>'
                    f'<th scope="col" class="n">Cache write</th><th scope="col" class="n">Cache read</th>'
                    f'<th scope="col" class="n">Total</th><th scope="col" class="n">Turns</th>'
                    f'<th scope="col" class="n">Tool calls</th></tr></thead><tbody>{body}{foot}</tbody></table>')
        bench = model.get("benchmark") or {}
        tables = token_table("To produce the library", model.get("production") or {})
        tables += (token_table("Added by benchmarking", bench) if bench.get("status") == "measured"
                   else absent("Benchmark tokens", bench))
        accounts = ", ".join(model.get("configDirs") or []) or "not known"
        parts.append(f'<div><h3>Tokens by model</h3>{tables}<p class="note">From {esc(model.get("source"))}: '
                     f'{num(model["files"])} transcript file(s), main session and subagents together. Claude '
                     f'configuration folder (account): {esc(accounts)}. Cache reads are prompt tokens served from '
                     f'cache and cost far less than the other kinds. {esc(model.get("benchmarkNote"))} '
                     f'{esc(model.get("caveat"))}</p></div>')
    else:
        parts.append(absent("Model tokens and tool calls", model))
    made = (working.get("production") or {}) if working.get("status") == "measured" else {}
    lead = (f"design-lab took {duration(made['workingSeconds'])} of working time to produce the library."
            if made.get("status") == "measured" else
            f"The Figma build itself took {duration(runner['activeSeconds'])} across {num(runner['steps'])} steps; "
            f"working time was not measured for this run." if runner.get("steps") else
            "Timing evidence is incomplete for this run.")
    return section("cost", "Time and tokens", cost["status"], esc(lead), "".join(parts))


def conformance_section(conf: dict) -> str:
    if conf.get("status") == "not-measured":
        return section("conformance", "Conformance to the library standard", "not-measured",
                       "Whole-file verification was not run.", absent("Verification findings", conf))
    o = conf["open"]
    body = (f'<dl class="yield small">'
            + "".join(f'<div class="y"><dt>{k} open</dt><dd>{num(v)}</dd></div>' for k, v in o.items())
            + f'<div class="y"><dt>waived</dt><dd>{num(conf["waived"])}</dd></div>'
              f'<div class="y"><dt>checks passed</dt><dd>{num(conf["passed"])}</dd></div></dl>')
    if conf.get("findings"):
        body += "<ul class=\"plain\">" + "".join(
            f'<li><span class="cat">{esc(f["severity"])}</span> {esc(f["check"])}: {esc(f["message"])}</li>'
            for f in conf["findings"]) + "</ul>"
    return section("conformance", "Conformance to the library standard", "measured", esc(conf.get("summary")), body)


def churn_section(churn: dict) -> str:
    if churn.get("status") == "not-measured":
        return section("churn", "Schema churn", "not-measured",
                       "Whether this run needed a schema change was not recorded.", absent("Schema churn", churn))
    items = "".join(f'<li>{esc(c["text"])}</li>' for c in churn.get("changes") or [])
    return section("churn", "Schema churn", "measured", esc(churn.get("summary")),
                   f'<ul class="plain">{items}</ul>' if items else "")


def later_section(fv: dict, blind: dict, pages: list) -> str:
    scale = blind.get("scale") or {"min": 1, "max": 5}
    boxes = "".join(f"<span>{i}</span>" for i in range(scale["min"], scale["max"] + 1))
    criteria = "".join(f'<li><span>{esc(c["label"])}</span><span class="scale" aria-label="not yet scored">{boxes}</span></li>'
                       for c in blind.get("criteria") or [])
    foundation_pages = [p for p in pages if p.lower().startswith("foundations")]
    targets = "".join(f'<li><span>{esc(p.split("—")[-1].strip())}</span><span class="pending">awaiting rubric</span></li>'
                      for p in foundation_pages)
    body = (f'<div class="two"><div class="later"><h3>Foundations and voice</h3><p>{esc(fv.get("reason"))} '
            f'The scorecard already has a slot for the rubric and its scores.</p>'
            + (f'<ul class="rubric">{targets}</ul>' if targets else "") + '</div>'
            f'<div class="later"><h3>Blinded visual judgement</h3><p>{esc(blind.get("reason"))}</p>'
            f'<ul class="rubric">{criteria}</ul></div></div>')
    return section("later", "Judged by people", "scored-later",
                   "Two parts of the benchmark need human eyes and are added after the run.", body)


def identity_section(ident: dict) -> str:
    if ident.get("status") == "not-measured":
        return section("identity", "Run identity", "not-measured", "Nothing identifies this run.", absent("Run identity", ident))
    f = ident["fields"]
    rows = [("Site", f.get("siteLabel")), ("Public address", f.get("publicAddress")),
            ("Local site", f.get("siteUrl")), ("Operator", f.get("operator")),
            ("Started", day(f.get("startedAt")) if f.get("startedAt") else None),
            ("design-lab", " ".join(x for x in (f.get("pluginVersion"), (f.get("pluginCommit") or "")[:10]) if x)),
            ("Library standard", f.get("standardVersion")),
            ("Figma build", " · ".join(x for x in (f"standard {f['builtToStandard']}" if f.get("builtToStandard") else None,
                                                   f"renderer runtime {f['rendererRuntime']}" if f.get("rendererRuntime") else None) if x) or None),
            ("Repository commit", ((f.get("repositoryCommit") or "")[:12] + (" (uncommitted changes)" if f.get("repositoryDirty") else "")) if f.get("repositoryCommit") else None),
            ("Figma file", f.get("figmaUrl")), ("Claude configuration", f.get("claudeConfigDir")),
            # The report describes Claude's work, so it names the model when it is a Claude model.
            ("Model", f.get("model") if str(f.get("model") or "").startswith("claude-") else None),
            ("Strategies", ", ".join(f"{k.replace('Source', '')}: {v}" for k, v in (f.get("strategies") or {}).items() if v))]
    items = "".join(f'<div><dt>{esc(k)}</dt><dd>{esc(v) if v else "<span class=na>not recorded</span>"}</dd></div>'
                    for k, v in rows)
    return section("identity", "Run identity and provenance", ident["status"], esc(ident.get("summary")),
                   f'<dl class="sheet">{items}</dl><p class="note">This is the provenance the Figma Cover used to '
                   f'print. The file now keeps it as hidden plugin data (<code>designlab</code> / '
                   f'<code>provenance</code> on the document and the Cover) and no page shows it.</p>')


# ------------------------------------------------------------------------------ page

CSS = r"""
:root{color-scheme:light;
--paper:#f4f5f7;--surface:#ffffff;--ink:#14161b;--ink2:#474d59;--muted:#6b717d;--hair:#dadde3;--hair2:#e9ebef;
--accent:#2f3fb8;--orig:#7d828c;--corr:#2a78d6;--pass-zone:rgba(42,120,214,.08);
--q5:#0d366b;--q4:#1c5cab;--q3:#2a78d6;--q2:#5598e7;--q1:#86b6ef;--check:#ffffff;--none:#e9ebef;
--good:#0a7d0a;--bad:#c23434;--hatch:rgba(20,22,27,.05);
--display:"Avenir Next Condensed","Avenir Next","Helvetica Neue","Arial Narrow",system-ui,sans-serif;
--body:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
--mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;
--paper:#0e1014;--surface:#161a21;--ink:#eceef2;--ink2:#b4bac6;--muted:#8d93a0;--hair:#2b303a;--hair2:#20242c;
--accent:#9aa6ff;--orig:#7c828e;--corr:#3987e5;--pass-zone:rgba(57,135,229,.12);
--q5:#b7d3f6;--q4:#6da7ec;--q3:#3987e5;--q2:#256abf;--q1:#184f95;--check:#0e1014;--none:#20242c;
--good:#3fbf3f;--bad:#ef6b6b;--hatch:rgba(255,255,255,.04)}}
*{box-sizing:border-box}
html{background:var(--paper)}
body{margin:0;color:var(--ink);font:16px/1.55 var(--body);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.page{max-width:1180px;margin:0 auto;padding:28px 40px 80px}
code,.mono{font-family:var(--mono);font-size:.82em;letter-spacing:.01em}
a{color:var(--accent)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
/* masthead */
.mast{display:flex;justify-content:space-between;align-items:baseline;gap:24px;padding-bottom:14px;border-bottom:1px solid var(--ink)}
.mast p{margin:0;font:600 13px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase}
.mast dl{display:flex;gap:22px;margin:0;font:12px/1 var(--mono);color:var(--muted)}
.mast dl div{display:flex;gap:6px}.mast dd{margin:0;color:var(--ink2)}
/* hero */
.hero{padding:52px 0 8px}
.site{margin:0 0 10px;font:500 14px/1 var(--mono);color:var(--accent);letter-spacing:.04em}
h1{font:700 clamp(40px,5.6vw,68px)/.98 var(--display);letter-spacing:-.018em;margin:0;max-width:21ch;font-stretch:condensed}
.dek{max-width:64ch;color:var(--ink2);margin:20px 0 0;font-size:17px}
.yield{display:flex;flex-wrap:wrap;gap:0;margin:40px 0 0;border-top:1px solid var(--hair);border-bottom:1px solid var(--hair)}
.yield .y{flex:1 1 140px;padding:18px 20px 16px 0;margin-right:20px;border-right:1px solid var(--hair)}
.yield .y:last-child{border-right:0}
.yield dt{font:12px/1.2 var(--mono);color:var(--muted);order:2}
.yield dd{margin:0 0 4px;font:600 46px/1 var(--display);letter-spacing:-.01em;font-variant-numeric:lining-nums}
.yield .y{display:flex;flex-direction:column}
.yield.small dd{font-size:30px}.yield.small{margin-top:10px}
.verdicts{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin-top:34px}
.v{padding:0 22px 0 0;margin-right:22px;border-right:1px solid var(--hair)}
.v:last-child{border-right:0;margin-right:0}
.v-l{margin:0;font:600 12px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink2)}
.v-n{margin:10px 0 6px;font:700 64px/.9 var(--display);letter-spacing:-.02em;color:var(--ink)}
.v-u{font:600 28px/1 var(--display);color:var(--muted);margin-left:4px;letter-spacing:0}
.v-c{margin:0;color:var(--ink2);font-size:14.5px;max-width:34ch}
.v-none .v-n{color:var(--muted)}
/* The coverage strip is drawn on the Cover's navy in both modes, so its category colors match the Cover. */
.cov{margin:22px 0 0;padding:18px 20px 14px;border-radius:12px;background:var(--ground);display:inline-block;max-width:100%}
.cov-sq{display:flex;flex-wrap:wrap;gap:4px;max-width:720px}
.cov-sq span{width:16px;height:16px;border-radius:3px}
.c-gap{box-shadow:inset 0 0 0 1.5px #E6E8FF}
.c-out{background:repeating-linear-gradient(135deg,rgba(230,232,255,.7) 0 1.5px,transparent 1.5px 4px)}
.c-out.c-retire{background:repeating-linear-gradient(135deg,#B9003F 0 2px,transparent 2px 4px);box-shadow:inset 0 0 0 1px #B9003F}
.cov-k{margin:12px 0 0;font:13px/1.6 var(--mono);color:#E6E8FF}.cov-k b{color:#fff;font-weight:600}
.cov-k .key{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:var(--k);vertical-align:-1px}
.cov-k .key-gap{background:none;box-shadow:inset 0 0 0 1.5px #E6E8FF}
.cov-k .key-out{background:repeating-linear-gradient(135deg,rgba(230,232,255,.7) 0 1.5px,transparent 1.5px 4px)}
.cov-k .key-retire{background:repeating-linear-gradient(135deg,#B9003F 0 2px,transparent 2px 4px);box-shadow:inset 0 0 0 1px #B9003F}
.cov,.cov *,.tier-panel,.tier-panel *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
/* The tier table sits on the Cover's navy too, so its category colors read exactly as on the Cover. */
.tier-panel{background:var(--ground);border-radius:12px;padding:16px 20px 8px;align-self:start}
.tbl.tiers caption{color:#E6E8FF}.tbl.tiers thead th{color:#AEB6E6}
.tbl.tiers th,.tbl.tiers td{color:#fff;border-top-color:rgba(230,232,255,.16)}
.tbl.tiers tr.out th,.tbl.tiers tr.out td{color:#AEB6E6}
.tbl.tiers tr.sum th,.tbl.tiers tr.sum td{border-top:1px solid rgba(230,232,255,.5)}
.t-sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:8px}
tr.out .t-sw{background:repeating-linear-gradient(135deg,#B9003F 0 2px,transparent 2px 4px)!important;box-shadow:inset 0 0 0 1px #B9003F}
.t-note{display:block;margin:2px 0 0 18px;font:12px/1.4 var(--mono);color:#AEB6E6;font-weight:400}
.t-bar{display:block;height:8px;border-radius:4px;margin-top:6px;min-width:80px;position:relative;background:linear-gradient(90deg,rgba(230,232,255,.18) calc(var(--f)*100%),transparent 0)}
.t-bar::after{content:"";position:absolute;inset:0 auto 0 0;width:calc(var(--v)*100%);background:var(--c);border-radius:4px}
.h-gap{margin-top:20px}
.cov-w{margin:14px 0 0;font-size:16px;color:var(--ink2);max-width:72ch}.cov-w b{color:var(--ink)}
.tbl tr.sum th,.tbl tr.sum td{border-top:1px solid var(--ink2);font-weight:600}
.highlights{list-style:none;margin:40px 0 0;padding:0;columns:2;column-gap:36px}
.highlights li{break-inside:avoid;padding:12px 0 12px 26px;border-top:1px solid var(--hair);position:relative;font-size:15.5px}
.highlights li::before{content:"";position:absolute;left:0;top:19px;width:12px;height:2px;background:var(--ink)}
/* the field */
.field{margin:48px 0 0;padding:26px 28px 22px;background:var(--surface);border-radius:14px;box-shadow:0 0 0 1px var(--hair2)}
.field figcaption{display:flex;justify-content:space-between;gap:20px;align-items:baseline;margin-bottom:18px;color:var(--ink2);font-size:14px}
.field figcaption .mono{font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--ink)}
.field-svg{width:100%;height:auto;display:block;overflow:visible}
.f-row{font:12px var(--mono);fill:var(--ink2)}
.f-cell{cursor:default;outline:none}
.f-cell rect{transition:opacity .15s}
.f-cell:hover rect,.f-cell:focus rect{stroke:var(--ink);stroke-width:2}
.q5{fill:var(--q5)}.q4{fill:var(--q4)}.q3{fill:var(--q3)}.q2{fill:var(--q2)}.q1{fill:var(--q1)}.f-none{fill:var(--none)}
.f-check{fill:none;stroke:var(--check);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.f-check.key{stroke:var(--ink)}
.field-key{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center;margin-top:18px;color:var(--ink2);font-size:13px}
.field-key p{margin:0}
.bins{display:flex;gap:16px;list-style:none;margin:0;padding:0;font:12px var(--mono)}
.bins li{display:flex;align-items:center;gap:6px}
.sw{display:inline-block;width:14px;height:14px;border-radius:3px}
.sw.q5{background:var(--q5)}.sw.q4{background:var(--q4)}.sw.q3{background:var(--q3)}.sw.q2{background:var(--q2)}.sw.q1{background:var(--q1)}
.key-note{display:flex;align-items:center;gap:6px}
/* sections */
.toc{display:flex;flex-wrap:wrap;gap:6px 18px;margin:56px 0 0;padding:14px 0;border-top:1px solid var(--ink);border-bottom:1px solid var(--hair);font:13px var(--mono)}
.toc a{color:var(--ink2);text-decoration:none}.toc a:hover{color:var(--accent);text-decoration:underline}
.sec{padding:56px 0 8px;border-bottom:1px solid var(--hair)}
.sec-head{display:flex;justify-content:space-between;align-items:baseline;gap:20px}
h2{font:700 38px/1.05 var(--display);letter-spacing:-.01em;margin:0}
h3{font:600 17px/1.3 var(--body);margin:0 0 8px}
h4{font:600 12px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase;margin:0 0 6px;color:var(--ink2)}
.lead{font-size:19px;line-height:1.45;max-width:62ch;color:var(--ink);margin:14px 0 28px}
.tag{font:600 11.5px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;color:var(--ink2);padding:6px 10px;border-radius:99px;box-shadow:inset 0 0 0 1px var(--hair)}
.tag-measured{color:var(--ink)}
.tag-not-measured,.tag-scored-later{color:var(--muted)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin:0 0 32px}
.note{color:var(--muted);font-size:13.5px;max-width:70ch}
.absent{margin:0 0 24px;padding:18px 22px;border-radius:10px;background:repeating-linear-gradient(135deg,var(--hatch) 0 2px,transparent 2px 9px),var(--surface);box-shadow:inset 0 0 0 1px var(--hair)}
.absent p{margin:0;color:var(--ink2);font-size:14.5px}
.absent .absent-t{font:600 12px/1.2 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink);margin-bottom:6px}
.absent .how{margin-top:8px;font-size:13.5px}.absent .how span{font-family:var(--mono);color:var(--muted)}
/* lists and tables */
.funnel{list-style:none;margin:0;padding:0}
.funnel li{display:flex;align-items:baseline;gap:14px;padding:10px 0;border-top:1px solid var(--hair2);color:var(--ink2)}
.funnel b{font:700 34px/1 var(--display);color:var(--ink);min-width:2.2ch;text-align:right}
.funnel .muted b{color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:0}
.chips li{font:12.5px/1 var(--mono);padding:7px 10px;border-radius:6px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--hair)}
.plain{list-style:none;margin:0;padding:0}
.plain li{padding:7px 0;border-top:1px solid var(--hair2);font-size:14.5px;color:var(--ink2)}
.plain li b{color:var(--ink)}
.plain.cols{columns:2;column-gap:32px}
.cat{font:11.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-right:6px}
.tbl{border-collapse:collapse;width:100%;font-size:14px}
.tbl caption{text-align:left;font:600 12px/1.2 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);padding-bottom:8px}
.tbl th,.tbl td{text-align:left;padding:8px 10px 8px 0;border-top:1px solid var(--hair2);vertical-align:top}
.tbl thead th{font:12px var(--mono);color:var(--muted);border-top:0}
.tbl .n{text-align:right;font-variant-numeric:tabular-nums}
.tbl .sub{color:var(--muted);font-size:12px}
.tbl.wide{margin:6px 0 20px}
.meter{display:block;height:8px;border-radius:4px;background:var(--hair2);margin-top:6px;position:relative;min-width:80px}
.meter::after{content:"";position:absolute;inset:0 auto 0 0;width:calc(var(--v)*100%);background:var(--corr);border-radius:4px}
.ok{color:var(--good);font-weight:700}.no{color:var(--bad);font-weight:700}
details.data{margin:10px 0 32px}
details.data summary{cursor:pointer;font:13px var(--mono);color:var(--accent);padding:10px 0}
.defs{display:grid;grid-template-columns:1fr;gap:22px;margin:0 0 36px;align-content:start}
.acc-top{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:48px;align-items:start}
.defs dt{font-weight:600;display:flex;align-items:center;gap:8px}.defs dd{margin:4px 0 0;color:var(--ink2);font-size:14.5px}
.key-sw{width:18px;height:8px;border-radius:4px;display:inline-block}.key-sw.original{background:var(--orig)}.key-sw.corrected{background:var(--corr)}
/* charts */
.chart{margin:0 0 36px}
.chart figcaption p{margin:0 0 14px;color:var(--ink2);font-size:14px;max-width:70ch}
.bars{width:100%;max-width:700px;height:auto;display:block}
.bar.original{fill:var(--orig)}.bar.corrected{fill:var(--corr)}
.grid{stroke:var(--hair2);stroke-width:1}.axis{stroke:var(--hair);stroke-width:1}
.axis-l{font:12.5px var(--mono);fill:var(--ink2)}
.val{font:600 13px var(--body);fill:var(--ink)}.val .of{font-weight:400;fill:var(--muted)}
.smalls{display:grid;grid-template-columns:repeat(3,1fr);gap:30px}
.sm-stat{margin:0 0 4px;font-size:13px;color:var(--ink2)}
.hist{width:100%;height:auto;display:block;margin-bottom:12px}
.dot{fill:var(--corr);stroke:var(--surface);stroke-width:1.5}
.dot:hover,.dot:focus{stroke:var(--ink);outline:none}
.pass-zone{fill:var(--pass-zone)}.thresh{stroke:var(--ink2);stroke-width:1}
.t-note,.tick{font:12px var(--mono);fill:var(--muted)}.cnt{font:600 13px var(--mono);fill:var(--ink2)}.t-note{fill:var(--ink2)}
/* gallery */
.gallery-head p{color:var(--ink2);font-size:14px;margin:0 0 18px;max-width:72ch}
.gallery{display:grid;align-items:start;grid-template-columns:repeat(2,1fr);gap:18px;margin-bottom:28px}
.g-sub{margin:26px 0 12px}
.card{background:var(--surface);border-radius:12px;padding:14px 16px 16px;box-shadow:0 0 0 1px var(--hair2)}
.card-h{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}
.card h4{color:var(--ink);letter-spacing:.01em;text-transform:none;font:600 15px/1.3 var(--body);margin:0}
.chips-bp{display:flex;gap:5px;list-style:none;margin:0;padding:0;font:11.5px var(--mono);flex:none}
.chips-bp li{padding:4px 7px;border-radius:5px;background:var(--hair2);color:var(--ink2)}
.chips-bp li span:first-child{font-weight:700;margin-right:5px;color:var(--ink)}
.chips-bp li.pass{background:var(--corr);color:#fff}.chips-bp li.pass span:first-child{color:#fff}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
.card.wide .pair{grid-template-columns:1fr}
.shot{margin:0}.shot figcaption{font:10.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.shot img{display:block;width:100%;height:auto;border-radius:4px;box-shadow:0 0 0 1px var(--hair2);background:#fff}
.shot.cut{position:relative}.shot.cut::after{content:"";position:absolute;left:0;right:0;bottom:0;height:34px;background:linear-gradient(transparent,var(--surface))}
details.more summary{margin-bottom:14px}
/* later and identity */
.later{padding:20px 22px;border-radius:12px;background:var(--surface);box-shadow:0 0 0 1px var(--hair2)}
.later p{color:var(--ink2);font-size:14.5px}
.rubric{list-style:none;margin:12px 0 0;padding:0}
.rubric li{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-top:1px solid var(--hair2);font-size:14.5px}
.pending{font:11px var(--mono);color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
.scale{display:flex;gap:4px}.scale span{width:24px;height:24px;border-radius:5px;display:grid;place-items:center;font:11px var(--mono);color:var(--muted);box-shadow:inset 0 0 0 1px var(--hair)}
.sheet{display:grid;grid-template-columns:repeat(2,1fr);gap:0 40px;margin:0 0 32px}
.sheet div{display:grid;grid-template-columns:170px 1fr;gap:12px;padding:9px 0;border-top:1px solid var(--hair2);font-size:14px}
.sheet dt{font:12px/1.6 var(--mono);color:var(--muted)}.sheet dd{margin:0;overflow-wrap:anywhere}
.na{color:var(--muted);font-style:italic}
footer.colophon{padding:36px 0 0;color:var(--muted);font:12px/1.7 var(--mono)}
/* tooltip */
.tip{position:fixed;z-index:10;pointer-events:none;max-width:300px;padding:8px 10px;border-radius:8px;background:var(--ink);color:var(--paper);font:12.5px/1.4 var(--body);box-shadow:0 6px 24px rgba(0,0,0,.18);opacity:0;transition:opacity .12s}
.tip.on{opacity:1}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media (max-width:860px){.page{padding:20px}.highlights{columns:1}.acc-top,.verdicts,.two,.defs,.highlights,.smalls,.sheet{grid-template-columns:1fr}
.v{border-right:0;margin:0 0 24px;padding:0}.mast{flex-direction:column}.mast dl{flex-wrap:wrap}
.gallery,.pair{grid-template-columns:1fr}.card-h{flex-wrap:wrap}.tbl.wide{display:block;overflow-x:auto}
.sec-head{flex-wrap:wrap}.field{padding:18px 14px;overflow-x:auto}.field-svg{min-width:640px}.plain.cols{columns:1}
.sheet div{grid-template-columns:120px 1fr}.yield .y{flex-basis:40%;border-right:0}}
@page{margin:14mm}
@media print{:root{color-scheme:light;--paper:#fff;--surface:#fff;--ink:#000;--ink2:#333;--muted:#555;--hair:#bbb;--hair2:#ddd;
--q5:#0d366b;--q4:#1c5cab;--q3:#2a78d6;--q2:#5598e7;--q1:#86b6ef;--check:#fff;--corr:#2a78d6;--orig:#7d828c}
.page{max-width:none;padding:0}.sec,.field,.card,.chart,.v,table,.absent{break-inside:avoid}
.toc,.tip,details.data summary{display:none}details.data{display:block}details.data>*{display:block}
.gallery{grid-template-columns:repeat(2,1fr)}.hero{padding-top:20px}}
"""

JS = r"""
(function(){var t=document.createElement('div');t.className='tip';t.setAttribute('role','tooltip');document.body.appendChild(t);
function show(e){var el=e.target.closest('[data-tip]');if(!el){t.classList.remove('on');return}
t.textContent=el.getAttribute('data-tip');var r=el.getBoundingClientRect();var x=r.left+r.width/2,y=r.top;
t.style.left=Math.max(8,Math.min(window.innerWidth-310,x-150))+'px';t.style.top=Math.max(8,y-t.offsetHeight-10)+'px';t.classList.add('on')}
document.addEventListener('mouseover',show);document.addEventListener('focusin',show);
document.addEventListener('mouseout',function(e){if(e.target.closest('[data-tip]'))t.classList.remove('on')});
document.addEventListener('focusout',function(){t.classList.remove('on')});})();
"""


def render(card: dict, run_dir: Path) -> str:
    s = card["sections"]
    identity = s["identity"].get("fields") or {}
    thumbs = {}
    if s["accuracy"].get("pairs") and s["accuracy"]["pairs"][0].get("evidence"):
        thumbs = thumbnails(run_dir, s["accuracy"]["pairs"], "desktop")
    toc = [("library", "What the run built"), ("accuracy", "Accuracy"), ("repeatability", "Repeatability"),
           ("cost", "Time and tokens"), ("conformance", "Conformance"), ("churn", "Schema churn"),
           ("later", "Judged by people"), ("identity", "Identity and provenance")]
    body = [
        f'<header class="mast"><p>design-lab · run report</p><dl>'
        f'<div><dt>run</dt><dd>{esc(card["run"]["name"])}</dd></div>'
        f'<div><dt>built</dt><dd>{esc(day(identity.get("startedAt")))}</dd></div>'
        f'<div><dt>version</dt><dd>{esc(identity.get("pluginVersion") or "–")}</dd></div>'
        f'<div><dt>scored</dt><dd>{esc(day(card["generatedAt"]))}</dd></div></dl></header>',
        "<main>",
        hero(card),
        '<nav class="toc" aria-label="Sections">' + "".join(f'<a href="#{i}">{esc(t)}</a>' for i, t in toc) + "</nav>",
        library_section(s["library"], s.get("coverage") or {}),
        accuracy_section(s["accuracy"], thumbs),
        repeat_section(s["repeatability"]),
        cost_section(s["cost"]),
        conformance_section(s["conformance"]),
        churn_section(s["schemaChurn"]),
        later_section(s["foundationsVoice"], s["blindedJudgement"], s["library"].get("pageNames") or []),
        identity_section(s["identity"]),
        "</main>",
        f'<footer class="colophon">Generated by {esc(card["generator"])} (scripts/score_run.py) on '
        f'{esc(day(card["generatedAt"]))}. The numbers come from scorecard.json beside this file; re-run the '
        f'scorer to refresh them. Accuracy figures are recomputed from the run\'s specimen screenshots.</footer>',
    ]
    return ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<meta name=\"color-scheme\" content=\"light dark\">"
            f"<title>{esc(card['run']['siteLabel'])} · design-lab run report</title>"
            f"<style>{CSS}</style></head><body><div class=\"page\">{''.join(body)}</div>"
            f"<script>{JS}</script></body></html>\n")
