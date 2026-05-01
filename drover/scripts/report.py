#!/usr/bin/env python3
"""drover.report — render a markdown report from a parsed aggregation.

Produces deterministic, fact-only reports today. The slice-7
report-writer agent can layer prose on top later; that integration is
optional and lives behind a future flag. Stakeholders care most about
the facts, so the no-AI path is the supported path for 2.0.

Templates that ship:

  monthly-client       stakeholder-facing — totals, top issues, MoM
                       trend, coverage caveats. Plain language.
  root-cause-summary   stakeholder-facing — top 5 fingerprints driving
                       the bulk of volume, share-of-volume bar chart,
                       JIRA ticket recommendations.
  calendar-boundary    stakeholder-facing — calendar/campaign window
                       analysis with bar chart by channel + JIRA recs.
  triage-brief         dev-facing — fingerprint-by-fingerprint detail
                       with sample lines and severity histograms.
  jira-ready           structured paste-blocks for JIRA's create-issue
                       dialog (one self-contained block per fingerprint).

Stakeholder templates (monthly-client, root-cause-summary,
calendar-boundary) embed a Velir logo header + brand colors and end
with a structured "Recommended JIRA tickets" section plus a JSON
sidecar (.tickets.json) for downstream programmatic creation.

CLI:
  python3 report.py [--project ROOT] [--env NAME] --month YYYY-MM
                    [--template NAME] [--out PATH]
                    [--types csv] [--prior-month YYYY-MM]
                    [--no-tickets]   skip the JIRA recommendation block
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# Lazy-load aggregate as a registered module so its dataclasses work.
_spec = importlib.util.spec_from_file_location(
    "drover_aggregate", HERE / "aggregate.py",
)
_aggregate = importlib.util.module_from_spec(_spec)
sys.modules["drover_aggregate"] = _aggregate
_spec.loader.exec_module(_aggregate)

# Same for report_writer (used here only for coverage_summary helper).
_spec2 = importlib.util.spec_from_file_location(
    "drover_report_writer", HERE / "report_writer.py",
)
_report_writer = importlib.util.module_from_spec(_spec2)
sys.modules["drover_report_writer"] = _report_writer
_spec2.loader.exec_module(_report_writer)

# Branding, charts, JIRA recommendations, and cause diagnosis —
# siblings of report.py.
import branding  # noqa: E402
import causes  # noqa: E402
import charts  # noqa: E402
import jira_recs  # noqa: E402


KNOWN_TEMPLATES = (
    "monthly-client",
    "root-cause-summary",
    "calendar-boundary",
    "triage-brief",
    "jira-ready",
)
STAKEHOLDER_TEMPLATES = (
    "monthly-client",
    "root-cause-summary",
    "calendar-boundary",
)
SEVERITY_RANK = {
    "critical": 0, "error": 1, "warning": 2, "notice": 3,
    "info": 4, "unknown": 5,
}


# --- Date / month helpers -------------------------------------------------

def parse_month(s: str) -> tuple[date, date]:
    """Parse YYYY-MM into (first_day, last_day) of that calendar month."""
    y, m = s.split("-")
    y, m = int(y), int(m)
    first = date(y, m, 1)
    if m == 12:
        last = date(y, 12, 31)
    else:
        last = date(y, m + 1, 1) - timedelta(days=1)
    return first, last


def prior_month(year: int, month: int) -> tuple[int, int]:
    if month == 1:
        return year - 1, 12
    return year, month - 1


def month_label(year: int, month: int) -> str:
    return date(year, month, 1).strftime("%B %Y")


# --- Manifest helper ------------------------------------------------------

def load_manifest(project_root: Path) -> dict:
    p = project_root / ".drover" / "manifest.json"
    if not p.exists():
        raise FileNotFoundError(
            f"No manifest at {p}. Run /drover:init first."
        )
    return json.loads(p.read_text())


# --- Branding header ------------------------------------------------------

def velir_header(project: str, env: str, month_str: str,
                 subtitle: str | None = None) -> list[str]:
    """Markdown lines for the Velir-branded report header.

    Embeds the logo as a base64 data: URI so the rendered .md is
    self-contained. Falls back to a plain text title bar when the
    asset is missing.
    """
    lines: list[str] = []
    logo = branding.logo_markdown(alt="Velir")
    if logo:
        lines.append(logo)
        lines.append("")
    lines.append(f"# {project} — {subtitle or 'Application Error Report'}")
    lines.append(f"### {month_str} · `{env}` environment")
    lines.append("")
    return lines


# --- Format helpers -------------------------------------------------------

def _fmt_int(n: int) -> str:
    return f"{n:,}"


def _fmt_pct(n: float | None) -> str:
    if n is None:
        return "—"
    sign = "+" if n > 0 else ""
    return f"{sign}{n:.1f}%"


def _trend_arrow(delta: dict | None) -> str:
    if not delta:
        return ""
    if delta.get("is_new"):
        return "🆕"
    dc = delta.get("delta_count", 0)
    if dc > 0:
        return "↑"
    if dc < 0:
        return "↓"
    return "·"


def _severity_chip(sev: str) -> str:
    return f"`{sev}`"


def _truncate(text: str, n: int) -> str:
    if len(text) <= n:
        return text
    return text[: n - 1].rstrip() + "…"


# --- Templates ------------------------------------------------------------

def render_monthly_client(
    agg: dict,
    *,
    project: str,
    env: str,
    month_str: str,
    coverage: dict,
    has_prior: bool,
) -> str:
    """Stakeholder-facing report. Plain language, deterministic."""
    lines: list[str] = []
    lines.append(f"# {project} — Application Error Report")
    lines.append(f"## {month_str} · {env} environment\n")

    total = agg.get("events_total", 0)
    by_sev = agg.get("by_severity", {}) or {}
    crit = by_sev.get("critical", 0)
    err = by_sev.get("error", 0)
    warn = by_sev.get("warning", 0)
    groups = agg.get("groups", []) or []

    # Coverage banner — must be visible before any totals
    cov_pct = (
        100.0 * coverage["present_days"] / coverage["expected_days"]
        if coverage["expected_days"] else 100.0
    )
    if cov_pct < 100:
        lines.append(
            f"> ⚠ **Coverage: {cov_pct:.1f}%** "
            f"({coverage['present_days']} of {coverage['expected_days']} "
            f"expected log files present). "
            f"This report reflects only the data we were able to retrieve.\n"
        )
    else:
        lines.append(
            f"> ✅ Coverage: 100% — analysis covers every expected log "
            f"file for the period.\n"
        )

    # Executive summary (deterministic — no LLM)
    lines.append("## Summary")
    lines.append("")
    if total == 0:
        lines.append(
            f"No application errors were recorded in {project} "
            f"`{env}` during {month_str}."
        )
    else:
        top = groups[0]
        top_pct = 100.0 * top["count"] / max(total, 1)
        lines.append(
            f"Across {month_str}, the {project} `{env}` environment "
            f"logged **{_fmt_int(total)}** application events "
            f"({_fmt_int(crit)} critical, {_fmt_int(err)} error-level, "
            f"{_fmt_int(warn)} warning-level)."
        )
        lines.append("")
        lines.append(
            f"The largest single source was the **{top.get('channel') or 'unspecified'}** "
            f"channel ({_fmt_int(top['count'])} events, "
            f"{top_pct:.1f}% of total volume)."
        )
        if has_prior:
            mom_total = sum(
                (g.get("delta") or {}).get("delta_count", 0)
                for g in groups
                if (g.get("delta") or {}).get("delta_count") is not None
            )
            if mom_total:
                direction = "rose" if mom_total > 0 else "fell"
                lines.append("")
                lines.append(
                    f"Versus the prior month, total volume "
                    f"{direction} by **{_fmt_int(abs(mom_total))}** "
                    f"events across recurring issues."
                )
    lines.append("")

    # Top issues
    if groups:
        lines.append("## Top issues")
        lines.append("")
        lines.append("| Rank | Channel | Severity | Count | Trend | Description |")
        lines.append("| ---: | --- | --- | ---: | :---: | --- |")
        for i, g in enumerate(groups[:10], start=1):
            arrow = _trend_arrow(g.get("delta"))
            delta_text = ""
            d = g.get("delta") or {}
            if d.get("delta_pct") is not None:
                delta_text = f" ({_fmt_pct(d['delta_pct'])})"
            elif d.get("is_new"):
                delta_text = " (new)"
            ch = g.get("channel") or "(none)"
            sev = g.get("severity") or "unknown"
            summary = _truncate(g.get("summary") or "", 70)
            # escape | so it doesn't break the table
            summary = summary.replace("|", "\\|")
            lines.append(
                f"| {i} | `{ch}` | {_severity_chip(sev)} | "
                f"{_fmt_int(g['count'])} | {arrow}{delta_text} | "
                f"{summary} |"
            )
        lines.append("")

    # Severity rollup
    if by_sev:
        lines.append("## Severity distribution")
        lines.append("")
        lines.append("| Severity | Count | Share |")
        lines.append("| --- | ---: | ---: |")
        for sev in sorted(
            by_sev.keys(), key=lambda s: SEVERITY_RANK.get(s, 99),
        ):
            count = by_sev[sev]
            share = 100.0 * count / max(total, 1)
            lines.append(
                f"| {_severity_chip(sev)} | {_fmt_int(count)} | {share:.1f}% |"
            )
        lines.append("")

    # Coverage caveats detail (only when imperfect)
    if coverage.get("missing_or_failed"):
        lines.append("## Days affected by retrieval gaps")
        lines.append("")
        for m in coverage["missing_or_failed"][:30]:
            reason = m.get("reason") or ""
            lines.append(
                f"- **{m['date']}** {m['log_type']} "
                f"({m['state']}{(': ' + reason) if reason else ''})"
            )
        if len(coverage["missing_or_failed"]) > 30:
            lines.append(
                f"- ...and {len(coverage['missing_or_failed']) - 30} more."
            )
        lines.append("")

    # Disappeared issues (only with prior comparison)
    disappeared = agg.get("disappeared_from_prior") or []
    if disappeared:
        lines.append("## Issues from prior month no longer present")
        lines.append("")
        for d in disappeared[:5]:
            lines.append(
                f"- **{d.get('channel') or 'unspecified'}** "
                f"({_fmt_int(d['prior_count'])} events last month): "
                f"{_truncate(d.get('summary') or '', 80)}"
            )
        lines.append("")

    lines.append("---")
    lines.append(
        f"*Generated by drover at "
        f"{datetime.now(timezone.utc).isoformat(timespec='seconds')}.*"
    )
    return "\n".join(lines) + "\n"


# --- Stakeholder template: root-cause-summary ----------------------------

def render_root_cause_summary(
    agg: dict,
    *,
    project: str,
    env: str,
    month_str: str,
    coverage: dict,
    has_prior: bool,
    include_tickets: bool = True,
    project_slug: str | None = None,
) -> str:
    """Top-N fingerprints driving the bulk of volume. Concentration
    lens — answers "what 5 things should we fix to silence most of
    this month's noise."
    """
    lines: list[str] = []
    lines.extend(velir_header(
        project, env, month_str,
        subtitle="Root-Cause Summary",
    ))

    total = agg.get("events_total", 0)
    groups = agg.get("groups", []) or []
    by_sev = agg.get("by_severity", {}) or {}
    by_ch = agg.get("by_channel", {}) or {}

    # Coverage banner first — credibility before claims.
    cov_pct = (
        100.0 * coverage["present_days"] / coverage["expected_days"]
        if coverage["expected_days"] else 100.0
    )
    if cov_pct < 100:
        lines.append(branding.banner(
            f"Coverage: {cov_pct:.1f}% — "
            f"{coverage['present_days']} of "
            f"{coverage['expected_days']} expected log files present.",
            kind="warning",
        ))
    else:
        lines.append(branding.banner(
            f"Coverage: 100% — analysis covers every expected log file.",
            kind="success",
        ))
    lines.append("")

    if total == 0:
        lines.append(
            f"_No application errors recorded in {project} `{env}` "
            f"during {month_str}._"
        )
        lines.append("")
        return "\n".join(lines) + "\n"

    # The headline: how many fingerprints account for what share of
    # total volume? Pareto cut at 80%.
    sorted_groups = sorted(
        groups, key=lambda g: g.get("count", 0), reverse=True,
    )
    cumulative = 0
    pareto_n = 0
    pareto_pct = 0.0
    for g in sorted_groups:
        cumulative += g.get("count", 0)
        pareto_n += 1
        pareto_pct = 100.0 * cumulative / max(total, 1)
        if pareto_pct >= 80.0 or pareto_n >= 10:
            break

    top_n = min(5, len(sorted_groups))
    top_share = sum(g.get("count", 0) for g in sorted_groups[:top_n])
    top_share_pct = 100.0 * top_share / max(total, 1)

    lines.append("## Headline")
    lines.append("")
    lines.append(
        f"**The top {top_n} issues account for "
        f"{top_share_pct:.1f}% of all {_fmt_int(total)} application "
        f"events in {month_str}.**"
    )
    lines.append("")
    lines.append(
        f"Pareto cut: **{pareto_n}** fingerprints make up "
        f"{pareto_pct:.0f}% of total volume. The rest of this report "
        f"focuses on those — fix them first to silence most of the "
        f"noise."
    )
    lines.append("")

    # Volume share chart — the top groups. Labels:
    #   multi-channel collapse → "ch1+ch2"
    #   single-channel collapse with N>1 fingerprints → "channel ×N"
    #   single fingerprint → "channel · <fp prefix>"
    chart_items: list[tuple[str, int]] = []
    for g in sorted_groups[: max(top_n, pareto_n)]:
        chans = g.get("channels") or (
            [g["channel"]] if g.get("channel") else ["(none)"]
        )
        member_count = g.get("member_count", 1)
        if len(chans) > 1:
            label = "+".join(chans)
        elif member_count > 1:
            label = f"{chans[0]} ×{member_count}"
        else:
            label = f"{chans[0]} · {g['fingerprint'][:6]}"
        chart_items.append((label, g.get("count", 0)))
    lines.append(charts.horizontal_bar_chart(
        chart_items,
        title="Top issues by share of volume",
        top_n=max(top_n, pareto_n),
    ))
    lines.append("")

    # Per-issue detail
    lines.append("## What each top issue is")
    lines.append("")
    for i, g in enumerate(sorted_groups[:top_n], start=1):
        sev = g.get("severity") or "unknown"
        count = g.get("count", 0)
        share = 100.0 * count / max(total, 1)
        first = g.get("first_seen") or "?"
        last = g.get("last_seen") or "?"
        delta = g.get("delta") or {}
        trend = ""
        if delta.get("delta_pct") is not None:
            trend = (
                f" {_trend_arrow(delta)} "
                f"{_fmt_pct(delta['delta_pct'])} vs prior month"
            )
        elif delta.get("is_new"):
            trend = " 🆕 new this month"

        # Collapsed-by-cause groups carry channels (plural) +
        # member_count. Single-fingerprint groups have one channel.
        channels = g.get("channels") or (
            [g["channel"]] if g.get("channel") else []
        )
        member_count = g.get("member_count", 1)
        if member_count > 1:
            chan_str = " + ".join(f"`{c}`" for c in channels)
            heading = f"### {i}. {chan_str} — {_severity_chip(sev)}"
        else:
            ch = g.get("channel") or "(none)"
            heading = f"### {i}. `{ch}` — {_severity_chip(sev)}"

        lines.append(heading)
        lines.append("")
        if member_count > 1:
            lines.append(
                f"_Combined from {member_count} fingerprints sharing "
                f"the same root cause._"
            )
            lines.append("")

        if member_count > 1:
            lines.append(
                f"- **Volume:** {_fmt_int(count)} events across "
                f"{member_count} fingerprints ({share:.1f}% of total)"
                f"{trend}"
            )
        else:
            lines.append(
                f"- **Volume:** {_fmt_int(count)} events ({share:.1f}% "
                f"of total){trend}"
            )
        lines.append(f"- **First seen:** {first}")
        lines.append(f"- **Last seen:** {last}")
        if member_count > 1:
            fp_list = ", ".join(
                f"`{fp}`" for fp in g.get("member_fingerprints", [])
            )
            lines.append(f"- **Fingerprints:** {fp_list}")
        else:
            lines.append(f"- **Fingerprint:** `{g['fingerprint']}`")
        lines.append("")
        # Cause diagnosis — when groups were collapsed by cause, the
        # collapsed group already carries the Cause object in g["cause"].
        cause_obj = g.get("cause") or causes.diagnose(g)
        lines.append(cause_obj.to_markdown())
        lines.append("")
        lines.append("**Representative message:**")
        lines.append("")
        lines.append("```")
        lines.append(_truncate(g.get("summary") or "", 400))
        lines.append("```")
        lines.append("")

    # Coverage caveats (compact form for stakeholder template)
    if coverage.get("missing_or_failed"):
        lines.append("## Days with retrieval gaps")
        lines.append("")
        for m in coverage["missing_or_failed"][:10]:
            reason = m.get("reason") or ""
            lines.append(
                f"- **{m['date']}** {m['log_type']} "
                f"({m['state']}{(': ' + reason) if reason else ''})"
            )
        if len(coverage["missing_or_failed"]) > 10:
            lines.append(
                f"- ...and {len(coverage['missing_or_failed']) - 10} more."
            )
        lines.append("")

    # JIRA recommendations
    if include_tickets:
        specs = jira_recs.from_groups(
            sorted_groups,
            project_slug=project_slug or project,
            env=env,
            month_label=month_str,
            total_events=total,
            top_n=top_n,
        )
        lines.append(jira_recs.render_markdown(
            specs,
            section_title="Recommended JIRA tickets",
        ))

    lines.append("---")
    lines.append(
        f"*Generated by drover at "
        f"{datetime.now(timezone.utc).isoformat(timespec='seconds')}.*"
    )
    return "\n".join(lines) + "\n"


# --- Stakeholder template: calendar-boundary -----------------------------

def render_calendar_boundary(
    agg: dict,
    *,
    project: str,
    env: str,
    month_str: str,
    coverage: dict,
    has_prior: bool,
    include_tickets: bool = True,
    project_slug: str | None = None,
) -> str:
    """Calendar/campaign window analysis. The bar chart by channel is
    the centerpiece — answers "what kinds of issues are happening
    during this window."
    """
    lines: list[str] = []
    lines.extend(velir_header(
        project, env, month_str,
        subtitle="Calendar Window Report",
    ))

    total = agg.get("events_total", 0)
    by_ch = agg.get("by_channel", {}) or {}
    by_sev = agg.get("by_severity", {}) or {}
    by_day = agg.get("by_day", {}) or {}
    groups = agg.get("groups", []) or []

    cov_pct = (
        100.0 * coverage["present_days"] / coverage["expected_days"]
        if coverage["expected_days"] else 100.0
    )
    if cov_pct < 100:
        lines.append(branding.banner(
            f"Coverage: {cov_pct:.1f}% — "
            f"{coverage['present_days']} of "
            f"{coverage['expected_days']} expected log files present.",
            kind="warning",
        ))
    else:
        lines.append(branding.banner(
            "Coverage: 100% — analysis covers every expected log file.",
            kind="success",
        ))
    lines.append("")

    lines.append("## At a glance")
    lines.append("")
    if total == 0:
        lines.append(
            f"_No application errors recorded in {project} `{env}` "
            f"during {month_str}._"
        )
        lines.append("")
        return "\n".join(lines) + "\n"

    crit = by_sev.get("critical", 0)
    err = by_sev.get("error", 0)
    warn = by_sev.get("warning", 0)
    lines.append(
        f"During **{month_str}**, the {project} `{env}` environment "
        f"logged **{_fmt_int(total)}** application events — "
        f"{_fmt_int(crit)} critical, {_fmt_int(err)} error-level, "
        f"{_fmt_int(warn)} warning-level."
    )
    lines.append("")

    # CHART: events by channel (the centerpiece for this template)
    lines.append("## Events by channel")
    lines.append("")
    lines.append(
        "Drupal's watchdog logs each event under a category called a "
        "*channel*. The chart below shows volume by channel for the "
        "window — concentrated channels are usually one or two issues "
        "in disguise; spread channels mean broader configuration "
        "drift."
    )
    lines.append("")
    lines.append(charts.channel_bar_chart(by_ch, top_n=15))
    lines.append("")

    # Severity chart for the same window
    lines.append("## Events by severity")
    lines.append("")
    lines.append(charts.severity_bar_chart(by_sev))
    lines.append("")

    # Per-day volume — useful for spotting spike days inside the window
    if by_day:
        lines.append("## Daily volume")
        lines.append("")
        ordered_days = sorted(by_day.keys())
        day_items = [
            (d, by_day[d].get("total", 0)) for d in ordered_days
        ]
        lines.append(charts.horizontal_bar_chart(
            day_items,
            title=None,
            top_n=len(day_items),
            show_pct=False,
            label_width=12,
        ))
        lines.append("")

    # Top channels in detail
    lines.append("## Top channels — what's inside")
    lines.append("")
    sorted_channels = sorted(
        by_ch.items(), key=lambda kv: kv[1], reverse=True,
    )[:5]
    for ch, ch_count in sorted_channels:
        share = 100.0 * ch_count / max(total, 1)
        # Pull the first (highest-count) group for this channel
        ch_groups = [g for g in groups if (g.get("channel") or "(none)") == ch]
        ch_groups.sort(key=lambda g: g.get("count", 0), reverse=True)
        top_summary = (
            ch_groups[0].get("summary", "") if ch_groups else ""
        )
        lines.append(
            f"### `{ch}` — {_fmt_int(ch_count)} events ({share:.1f}%)"
        )
        if ch_groups:
            lines.append("")
            lines.append(
                f"- Distinct fingerprints in this channel: "
                f"{len(ch_groups)}"
            )
            lines.append(
                f"- Top issue: {_truncate(top_summary, 200)}"
            )
        lines.append("")

    # Coverage detail (compact)
    if coverage.get("missing_or_failed"):
        lines.append("## Days with retrieval gaps")
        lines.append("")
        for m in coverage["missing_or_failed"][:10]:
            reason = m.get("reason") or ""
            lines.append(
                f"- **{m['date']}** {m['log_type']} "
                f"({m['state']}{(': ' + reason) if reason else ''})"
            )
        if len(coverage["missing_or_failed"]) > 10:
            lines.append(
                f"- ...and {len(coverage['missing_or_failed']) - 10} more."
            )
        lines.append("")

    # JIRA recommendations: top issues across all channels
    if include_tickets:
        sorted_groups = sorted(
            groups, key=lambda g: g.get("count", 0), reverse=True,
        )
        specs = jira_recs.from_groups(
            sorted_groups,
            project_slug=project_slug or project,
            env=env,
            month_label=month_str,
            total_events=total,
            top_n=5,
        )
        lines.append(jira_recs.render_markdown(
            specs,
            section_title="Recommended JIRA tickets",
        ))

    lines.append("---")
    lines.append(
        f"*Generated by drover at "
        f"{datetime.now(timezone.utc).isoformat(timespec='seconds')}.*"
    )
    return "\n".join(lines) + "\n"


def render_triage_brief(
    agg: dict,
    *,
    project: str,
    env: str,
    month_str: str,
    coverage: dict,
    has_prior: bool,
) -> str:
    """Dev-facing report — fingerprint detail with sample lines."""
    lines: list[str] = []
    lines.append(f"# {project} — Triage Brief")
    lines.append(f"## {month_str} · {env} environment\n")
    lines.append(
        f"**Coverage:** {coverage['present_days']} / "
        f"{coverage['expected_days']} log files present.\n"
    )
    lines.append(f"**Total events:** {_fmt_int(agg.get('events_total', 0))}\n")
    lines.append("---\n")

    for i, g in enumerate(agg.get("groups", [])[:25], start=1):
        ch = g.get("channel") or "(none)"
        sev = g.get("severity") or "unknown"
        delta = g.get("delta") or {}
        lines.append(f"### {i}. `{ch}` · {_severity_chip(sev)} · {g['fingerprint']}")
        lines.append("")
        lines.append(
            f"- **Count:** {_fmt_int(g['count'])} "
            f"({_trend_arrow(delta)} {_fmt_pct(delta.get('delta_pct')) if delta else 'no prior'})"
        )
        if g.get("first_seen"):
            lines.append(f"- **First seen:** {g['first_seen']}")
        if g.get("last_seen"):
            lines.append(f"- **Last seen:** {g['last_seen']}")
        sevs = g.get("severities") or {}
        if sevs:
            lines.append(
                "- **Severities:** "
                + ", ".join(
                    f"{k}={v}" for k, v in sorted(
                        sevs.items(),
                        key=lambda kv: SEVERITY_RANK.get(kv[0], 99),
                    )
                )
            )
        lines.append("")
        lines.append("**Summary:**")
        lines.append("")
        lines.append("```")
        lines.append(_truncate(g.get("summary") or "", 500))
        lines.append("```")
        lines.append("")
        samples = g.get("samples") or []
        if samples:
            lines.append("**Sample lines:**")
            lines.append("")
            lines.append("```")
            for s in samples[:3]:
                lines.append(_truncate(s, 400))
            lines.append("```")
            lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines) + "\n"


def render_jira_ready(
    agg: dict,
    *,
    project: str,
    env: str,
    month_str: str,
    coverage: dict,
    has_prior: bool,
) -> str:
    """One self-contained block per top fingerprint, paste-ready for JIRA."""
    lines: list[str] = []
    lines.append(f"# {project} — JIRA-Ready Issues — {month_str} ({env})\n")
    lines.append(
        f"Coverage: {coverage['present_days']} / "
        f"{coverage['expected_days']}\n"
    )
    lines.append("---\n")

    for i, g in enumerate(agg.get("groups", [])[:15], start=1):
        ch = g.get("channel") or "(none)"
        sev = g.get("severity") or "unknown"
        title = (
            f"[{project}/{env}] {ch}: "
            f"{_truncate(g.get('summary') or '', 80)}"
        )
        lines.append(f"## Issue {i}")
        lines.append("")
        lines.append(f"**Title:** {title}")
        lines.append("")
        lines.append("**Description:**")
        lines.append("")
        lines.append("```")
        lines.append(f"Project: {project}")
        lines.append(f"Environment: {env}")
        lines.append(f"Month: {month_str}")
        lines.append(f"Channel: {ch}")
        lines.append(f"Severity: {sev}")
        lines.append(f"Occurrences: {_fmt_int(g['count'])}")
        if g.get("first_seen"):
            lines.append(f"First seen: {g['first_seen']}")
        if g.get("last_seen"):
            lines.append(f"Last seen: {g['last_seen']}")
        lines.append(f"Drover fingerprint: {g['fingerprint']}")
        lines.append("")
        lines.append("Summary:")
        lines.append(_truncate(g.get("summary") or "", 800))
        if g.get("samples"):
            lines.append("")
            lines.append("Sample log lines:")
            for s in g["samples"][:2]:
                lines.append(f"  {_truncate(s, 400)}")
        lines.append("```")
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines) + "\n"


RENDERERS = {
    "monthly-client": render_monthly_client,
    "root-cause-summary": render_root_cause_summary,
    "calendar-boundary": render_calendar_boundary,
    "triage-brief": render_triage_brief,
    "jira-ready": render_jira_ready,
}


# --- Orchestrator ---------------------------------------------------------

def generate_report(
    project_root: Path,
    *,
    env: str,
    month: str,
    template: str = "monthly-client",
    types: list[str] | None = None,
    prior_month_str: str | None = None,
    include_tickets: bool = True,
) -> tuple[str, dict, list]:
    """Returns (markdown_text, summary_dict, ticket_specs).

    `ticket_specs` is a list of jira_recs.TicketSpec when the chosen
    template supports JIRA recommendations and include_tickets is
    True; an empty list otherwise. The CLI layer writes a sidecar
    JSON file with these specs alongside the report.
    """
    if template not in RENDERERS:
        raise ValueError(
            f"unknown template {template!r}; known: {sorted(RENDERERS)}"
        )

    manifest = load_manifest(project_root)
    project = manifest.get("project") or project_root.name

    if types is None:
        env_entry = next(
            (e for e in manifest["acquia"]["envs"] if e["name"] == env),
            None,
        )
        if env_entry is None:
            raise ValueError(
                f"env '{env}' not in manifest. "
                f"Available: {[e['name'] for e in manifest['acquia']['envs']]}"
            )
        types = env_entry.get("types") or ["drupal-watchdog"]

    from_d, to_d = parse_month(month)
    agg = _aggregate.aggregate_files(
        project_root, env=env, types=types,
        from_date=from_d, to_date=to_d,
    )

    coverage_ledger = _aggregate.load_coverage(project_root)
    coverage = _report_writer.coverage_summary(
        coverage_ledger, env=env, types=types,
        from_date=from_d, to_date=to_d,
    )

    has_prior = False
    if prior_month_str:
        pf, pt = parse_month(prior_month_str)
        prior_agg = _aggregate.aggregate_files(
            project_root, env=env, types=types,
            from_date=pf, to_date=pt,
        )
        if prior_agg["events_total"] > 0:
            agg = _aggregate.delta(agg, prior_agg)
            has_prior = True

    # Stakeholder templates collapse fingerprints that share the same
    # diagnosed cause — so a Solr flood that surfaces in both
    # `acquia_search` and `search_api` channels appears as ONE issue,
    # not two, and produces one JIRA ticket, not two.
    if template in ("root-cause-summary", "calendar-boundary"):
        agg_for_render = {
            **agg,
            "groups": causes.collapse_by_cause(agg.get("groups", []) or []),
        }
    else:
        agg_for_render = agg

    # Templates that surface JIRA recommendations also accept the
    # include_tickets / project_slug kwargs. The shared signature
    # supports both shapes.
    extra_kwargs: dict = {}
    if template in ("root-cause-summary", "calendar-boundary"):
        extra_kwargs["include_tickets"] = include_tickets
        extra_kwargs["project_slug"] = manifest.get("project") or project

    md = RENDERERS[template](
        agg_for_render,
        project=project,
        env=env,
        month_str=month_label(from_d.year, from_d.month),
        coverage=coverage,
        has_prior=has_prior,
        **extra_kwargs,
    )

    # Build the ticket specs separately for sidecar emission. The
    # collapsed groups feed jira_recs so duplicate-cause fingerprints
    # produce a single combined ticket.
    ticket_specs: list = []
    if include_tickets and template in ("root-cause-summary",
                                        "calendar-boundary"):
        ticket_specs = jira_recs.from_groups(
            agg_for_render["groups"],
            project_slug=manifest.get("project") or project,
            env=env,
            month_label=month_label(from_d.year, from_d.month),
            total_events=agg.get("events_total", 0),
            top_n=5,
        )

    summary = {
        "events_total": agg["events_total"],
        "groups_total": len(agg.get("groups", [])),
        "coverage_pct": (
            100.0 * coverage["present_days"] / coverage["expected_days"]
            if coverage["expected_days"] else 100.0
        ),
        "template": template,
        "ticket_count": len(ticket_specs),
    }
    return md, summary, ticket_specs


# --- CLI ------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="drover-report",
        description="Render a markdown report from local logs + ledger.",
    )
    p.add_argument("--project", type=Path, default=Path.cwd())
    p.add_argument(
        "--env", default="prod",
        help="env name from manifest (default: prod — override when "
             "rendering against another env)",
    )
    p.add_argument(
        "--month", required=True,
        help="report month, YYYY-MM (default range: that calendar month)",
    )
    p.add_argument(
        "--template", default="monthly-client",
        choices=KNOWN_TEMPLATES,
    )
    p.add_argument("--types", default=None,
                   help="comma-separated log types (default: from manifest)")
    p.add_argument(
        "--prior-month", default=None,
        help="auto-derived if omitted; pass YYYY-MM to override",
    )
    p.add_argument("--out", type=Path, default=None,
                   help="output file (default: reports/<month>-<template>.md)")
    p.add_argument(
        "--no-prior", action="store_true",
        help="skip MoM comparison even when prior data exists",
    )
    p.add_argument(
        "--no-tickets", action="store_true",
        help="skip the JIRA recommendation block + sidecar emission "
             "(stakeholder templates only)",
    )
    return p.parse_args(argv)


def cli_main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    project_root = args.project.resolve()

    types_override = (
        [t.strip() for t in args.types.split(",") if t.strip()]
        if args.types else None
    )

    prior = None
    if not args.no_prior:
        if args.prior_month:
            prior = args.prior_month
        else:
            y, m = (int(x) for x in args.month.split("-"))
            py, pm = prior_month(y, m)
            prior = f"{py:04d}-{pm:02d}"

    try:
        md, summary, ticket_specs = generate_report(
            project_root,
            env=args.env,
            month=args.month,
            template=args.template,
            types=types_override,
            prior_month_str=prior,
            include_tickets=not args.no_tickets,
        )
    except (FileNotFoundError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    out = args.out or (
        project_root / "reports"
        / f"{args.month}-{args.template}.md"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(md)

    sidecar_path = None
    if ticket_specs:
        sidecar_path = jira_recs.write_sidecar(ticket_specs, out)

    print(f"wrote {out}")
    print(f"  events:    {_fmt_int(summary['events_total'])}")
    print(f"  groups:    {summary['groups_total']}")
    print(f"  coverage:  {summary['coverage_pct']:.1f}%")
    if sidecar_path:
        print(f"  tickets:   {len(ticket_specs)} suggested -> {sidecar_path}")
    return 0


if __name__ == "__main__":
    sys.exit(cli_main())
