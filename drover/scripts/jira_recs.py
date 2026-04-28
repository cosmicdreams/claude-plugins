"""JIRA ticket-recommendation block generator.

Stakeholder reports end with a "Recommended JIRA Tickets" section
listing one ticket per top fingerprint. Each ticket carries enough
structured metadata that the user (or a future
/drover:report-create-jira-tickets skill) can paste or programmatically
create them in the right project.

Output formats:
  - render_markdown(specs) → markdown block embedded in the report
  - to_json(specs)         → JSON sidecar for programmatic creation
                             (saved next to the report at
                             reports/<month>-<template>.tickets.json)

JIRA integration itself (auth, project/field mapping, real API call)
is deferred to a follow-up skill — see drover-2.0 plan v2.1. This
module produces the *spec*, not the side-effect.
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

# Sibling import — same pattern report.py uses for cross-module loads
# inside the scripts/ tree.
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
import causes  # noqa: E402


# Minimum count for a fingerprint to merit a ticket recommendation.
# Below this we treat the issue as "background noise not worth a
# ticket on its own" — but tunable per-template.
DEFAULT_MIN_COUNT = 50


# Heuristic priority assignment based on severity + count percentile.
# These are SUGGESTIONS — the real priority decision belongs to the
# stakeholder. Tickets always carry "drover-suggested" as a label so
# downstream review can see they were machine-proposed.
def _suggest_priority(severity: str, count: int, total_events: int) -> str:
    pct = 100 * count / max(total_events, 1)
    sev = (severity or "unknown").lower()

    if sev in ("critical", "emergency", "alert"):
        return "P0"
    if sev == "error":
        return "P0" if pct >= 5 else "P1"
    if sev == "warning":
        return "P1" if pct >= 10 else "P2"
    # notice / info / unknown — only escalate on sheer volume
    if pct >= 20:
        return "P1"
    if pct >= 5:
        return "P2"
    return "P3"


# Heuristic title cleanup: turn the truncated technical summary into
# something a stakeholder can read. Keeps it brief — humans will edit.
def _suggest_title(channel: str | None, summary: str) -> str:
    summary = (summary or "").strip()
    # Strip URLs and request_ids that pollute Drupal watchdog messages
    summary = re.sub(r"https?://\S+", "", summary)
    summary = re.sub(r'request_id="[^"]+"', "", summary)
    summary = re.sub(r"\s+", " ", summary).strip()
    # Cap length
    if len(summary) > 100:
        summary = summary[:97].rstrip() + "…"
    if channel:
        return f"[{channel}] {summary}"
    return summary or "Application error"


@dataclass
class TicketSpec:
    """A single recommended JIRA ticket. All fields are SUGGESTIONS —
    the user (or downstream creator) is expected to review."""

    fingerprint: str
    title: str
    description: str
    priority: str
    labels: list[str] = field(default_factory=list)
    channel: str | None = None
    severity: str | None = None
    count: int = 0
    first_seen: str | None = None
    last_seen: str | None = None
    sample: str | None = None
    # Diagnosed cause from drover/scripts/causes.py — exposed for
    # programmatic consumers (downstream filters, dashboards). The
    # human-readable description always includes the same info.
    cause_pattern_id: str | None = None
    cause_confidence: str | None = None


# --- Builder --------------------------------------------------------------

def from_groups(
    groups: list[dict],
    *,
    project_slug: str,
    env: str,
    month_label: str,
    total_events: int,
    top_n: int = 5,
    min_count: int = DEFAULT_MIN_COUNT,
    extra_labels: list[str] | None = None,
) -> list[TicketSpec]:
    """Build a list of TicketSpec from an aggregation's groups list.

    Filters out fingerprints below min_count, takes top_n by count.
    Each spec gets standard drover-suggested labels plus any extras.
    """
    specs: list[TicketSpec] = []
    base_labels = [
        "drover-suggested",
        f"drover-project-{project_slug}",
        f"drover-env-{env}",
    ]
    if extra_labels:
        base_labels.extend(extra_labels)

    eligible = [g for g in groups if g.get("count", 0) >= min_count]
    eligible = eligible[:top_n]

    for g in eligible:
        ch = g.get("channel")
        sev = g.get("severity") or "unknown"
        count = g.get("count", 0)
        pct = 100 * count / max(total_events, 1)
        sample = (g.get("samples") or [None])[0]
        cause = causes.diagnose(g)

        description_lines = [
            f"**Reported by drover monthly report ({month_label}, "
            f"{project_slug}/{env}).**",
            "",
            f"- **Channel:** `{ch or '(none)'}`",
            f"- **Severity (inferred):** `{sev}`",
            f"- **Occurrences in {month_label}:** {count:,} "
            f"({pct:.1f}% of all events)",
            f"- **First seen:** {g.get('first_seen') or '?'}",
            f"- **Last seen:** {g.get('last_seen') or '?'}",
            f"- **Drover fingerprint:** `{g.get('fingerprint')}`",
            "",
            f"**Likely cause** ({cause.confidence} confidence): "
            f"{cause.title}",
            "",
            cause.explanation,
            "",
            f"**Suggested fix:** {cause.suggested_fix}",
            "",
            "**Representative message:**",
            "",
            "```",
            (g.get("summary") or "")[:600],
            "```",
        ]
        if sample and sample != g.get("summary"):
            description_lines.extend([
                "",
                "**Sample raw line:**",
                "",
                "```",
                sample[:400],
                "```",
            ])

        labels = list(base_labels)
        if ch:
            slug = re.sub(r"[^a-z0-9-]", "-", ch.lower())
            labels.append(f"drover-channel-{slug}")
        labels.append(f"drover-severity-{sev}")

        # Add pattern-id label so downstream filters / dashboards can
        # group tickets by diagnosed cause.
        if cause.pattern_id:
            labels.append(f"drover-cause-{cause.pattern_id}")

        specs.append(TicketSpec(
            fingerprint=g.get("fingerprint", ""),
            title=_suggest_title(ch, g.get("summary") or ""),
            description="\n".join(description_lines),
            priority=_suggest_priority(sev, count, total_events),
            labels=labels,
            channel=ch,
            severity=sev,
            count=count,
            first_seen=g.get("first_seen"),
            last_seen=g.get("last_seen"),
            sample=sample,
            cause_pattern_id=cause.pattern_id,
            cause_confidence=cause.confidence,
        ))

    return specs


# --- Renderers ------------------------------------------------------------

def render_markdown(
    specs: list[TicketSpec],
    *,
    section_title: str = "Recommended JIRA tickets",
) -> str:
    """Markdown block listing each recommended ticket with priority
    badge and a collapsible description."""
    if not specs:
        return (
            f"## {section_title}\n\n"
            "_No tickets recommended for this report._\n"
        )

    out = [f"## {section_title}", ""]
    out.append(
        f"_{len(specs)} ticket(s) suggested. Review titles and priorities "
        f"before creating._"
    )
    out.append("")
    out.append("| # | Priority | Title | Count | Severity | Channel |")
    out.append("| ---: | :---: | --- | ---: | :---: | --- |")
    for i, spec in enumerate(specs, start=1):
        title = spec.title.replace("|", "\\|")
        ch = (spec.channel or "(none)").replace("|", "\\|")
        out.append(
            f"| {i} | **{spec.priority}** | {title} | "
            f"{spec.count:,} | `{spec.severity}` | `{ch}` |"
        )
    out.append("")

    out.append("### Ticket details")
    out.append("")
    for i, spec in enumerate(specs, start=1):
        out.append(f"#### {i}. {spec.title}")
        out.append("")
        out.append(f"- **Suggested priority:** {spec.priority}")
        out.append(
            "- **Suggested labels:** "
            + ", ".join(f"`{l}`" for l in spec.labels)
        )
        out.append("")
        out.append(spec.description)
        out.append("")
    return "\n".join(out) + "\n"


def to_json(specs: list[TicketSpec]) -> str:
    """JSON sidecar — what a future export-jira skill consumes."""
    return json.dumps(
        [asdict(s) for s in specs], indent=2, sort_keys=True,
    )


def write_sidecar(
    specs: list[TicketSpec], report_path: Path,
) -> Path:
    """Write the JSON sidecar next to the report file.

    Path: <report_path>.tickets.json (e.g.
    reports/2026-04-root-cause-summary.md.tickets.json).

    Returns the sidecar path.
    """
    sidecar = report_path.with_suffix(report_path.suffix + ".tickets.json")
    sidecar.write_text(to_json(specs))
    return sidecar
