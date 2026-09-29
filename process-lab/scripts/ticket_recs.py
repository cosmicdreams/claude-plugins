#!/usr/bin/env python3
"""Recommend Jira tickets from diagnosed drover evidence; never create them."""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
sys.dont_write_bytecode = True
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULTS = HERE.parent / "references" / "jira-strategy.json"
JEV_PATH = HERE / "jev_client.py"
WORTH_THRESHOLD = 0.6
WORTH_LEVELS = [
    "Routine instrumentation or noise; a ticket would be closed as not a bug",
    "A real but low-impact issue; a ticket is optional",
    "Worth a ticket: a recurring error with a plausible fix",
    "Urgent: users or the business are affected; file the ticket now",
]


def load_strategy(cwd: Path | None = None) -> dict:
    """Merge the project's optional Jira strategy into the shipped defaults."""
    strategy = json.loads(DEFAULTS.read_text())
    manifest = (cwd or Path.cwd()) / ".velir" / "project.json"
    if manifest.exists():
        overrides = json.loads(manifest.read_text()).get("jira_strategy") or {}
        if not isinstance(overrides, dict):
            raise ValueError("jira_strategy must be an object")
        for key, value in overrides.items():
            if key == "priority_thresholds":
                strategy[key] = {**strategy[key], **value}
            else:
                strategy[key] = value
    return strategy


def resolve_jev():
    """Use the same local import and availability check as drover."""
    if not JEV_PATH.exists():
        return None
    spec = importlib.util.spec_from_file_location("process_lab_jev_client", JEV_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module if module.availability()[0] else None


def _suggest_priority(severity: str, count: int, total_events: int,
                      thresholds: dict | None = None) -> str:
    t = thresholds or json.loads(DEFAULTS.read_text())["priority_thresholds"]
    pct = 100 * count / max(total_events, 1)
    sev = (severity or "unknown").lower()
    if sev in ("critical", "emergency", "alert"):
        return "P0"
    if sev == "error":
        return "P0" if pct >= t["error_p0_share_pct"] else "P1"
    if sev == "warning":
        return "P1" if pct >= t["warning_p1_share_pct"] else "P2"
    if pct >= t["other_p1_share_pct"]:
        return "P1"
    if pct >= t["other_p2_share_pct"]:
        return "P2"
    return "P3"


def _suggest_title(channel: str | None, summary: str) -> str:
    summary = re.sub(r"https?://\S+", "", (summary or "").strip())
    summary = re.sub(r'request_id="[^"]+"', "", summary)
    summary = re.sub(r"\s+", " ", summary).strip()
    if len(summary) > 100:
        summary = summary[:97].rstrip() + "…"
    return f"[{channel}] {summary}" if channel else summary or "Application error"


@dataclass
class TicketSpec:
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
    cause_pattern_id: str | None = None
    cause_confidence: str | None = None
    jev_ticket_worthiness: dict | None = None


def judge_worthiness(groups: list[dict], *, total_events: int, jev,
                     top_n: int = 5, min_count: int = 50) -> None:
    """Annotate eligible evidence only; never change eligibility or priority."""
    eligible = [g for g in groups if g.get("count", 0) >= min_count][:top_n]
    if not eligible:
        return
    items = {}
    for n, g in enumerate(eligible):
        cause = g.get("cause") or {}
        count = g.get("count", 0)
        items[str(n)] = {
            "channel": g.get("channel"),
            "severity": g.get("severity") or "unknown",
            "occurrences": count,
            "share_of_all_events_pct": round(100 * count / max(total_events, 1), 2),
            "summary": (g.get("summary") or "")[:600],
            "sample": str(g.get("sample") or "")[:400],
            "diagnosed_cause": cause.get("explanation") or "",
        }
    question = {"worth": {
        "type": "score",
        "instructions": "How much does this recurring log issue deserve a ticket in the site's issue tracker?",
        "criteria": list(WORTH_LEVELS),
    }}
    try:
        response = jev.ask_items(items, question)
        for n, g in enumerate(eligible):
            result = response["results"].get(str(n)) or {"ok": False, "reason": response["reason"]}
            if result["ok"]:
                record = jev.score_verdict(result["answers"]["worth"],
                    threshold=WORTH_THRESHOLD, model=response["model"])
                if record["source"] == "jev" and not record["confident"]:
                    record = {**record, "source": "fallback", "reason": "low_confidence"}
            else:
                record = jev.fallback(result["reason"])
            if record["source"] == "jev":
                record["legend"] = WORTH_LEVELS[min(record["level"], len(WORTH_LEVELS) - 1)]
            g["jev_ticket_worthiness"] = record
    except (KeyError, TypeError, ValueError):
        return


def from_evidence(evidence: dict, *, strategy: dict | None = None,
                  jev=None) -> list[TicketSpec]:
    if evidence.get("schema") != "drover-evidence/1":
        raise ValueError("unsupported evidence schema")
    strategy = strategy or load_strategy()
    groups = sorted(evidence.get("groups") or [], key=lambda g: g.get("count", 0), reverse=True)
    total = evidence.get("events_total", 0)
    min_count, top_n = strategy["min_count"], strategy["top_n"]
    if jev is not None:
        judge_worthiness(groups, total_events=total, jev=jev,
                         top_n=top_n, min_count=min_count)
    specs = []
    project, env, month = evidence["project"], evidence["env"], evidence["month"]
    year, mo = map(int, month.split("-"))
    month_label = date(year, mo, 1).strftime("%B %Y")
    for g in [g for g in groups if g.get("count", 0) >= min_count][:top_n]:
        ch, sev, count = g.get("channel"), g.get("severity") or "unknown", g["count"]
        cause = g.get("cause") or {}
        members = g.get("member_fingerprints") or [g.get("fingerprint", "")]
        channels = g.get("channels") or ([ch] if ch else [])
        sample = g.get("sample")
        pct = 100 * count / max(total, 1)
        lines = [f"**Reported by drover monthly report ({month_label}, {project}/{env}).**", ""]
        if len(members) > 1:
            lines += [f"This ticket combines **{len(members)} fingerprints** that drover diagnosed as the same root cause:", ""]
            lines += [f"  - `{fp}`" for fp in members]
            lines += ["", "- **Channels:** " + ", ".join(f"`{c}`" for c in channels)]
        else:
            lines += [f"- **Channel:** `{ch or '(none)'}`"]
        lines += [
            f"- **Severity (inferred):** `{sev}`",
            f"- **Total occurrences in {month_label}:** {count:,} ({pct:.1f}% of all events" +
                (f" across {len(members)} fingerprints" if len(members) > 1 else "") + ")",
            f"- **First seen:** {g.get('first_seen') or '?'}",
            f"- **Last seen:** {g.get('last_seen') or '?'}",
        ]
        if len(members) == 1:
            lines.append(f"- **Drover fingerprint:** `{g.get('fingerprint')}`")
        lines += ["", f"**Likely cause** ({cause.get('confidence') or 'low'} confidence):", 
                  cause.get("explanation") or "Cause undiagnosed.", "",
                  "**Suggested fix:** " + (cause.get("suggested_fix") or "Review the diagnosed cause."),
                  "", "**Representative message:**", "", "```", (g.get("summary") or "")[:600], "```"]
        if sample and sample != g.get("summary"):
            lines += ["", "**Sample raw line:**", "", "```", sample[:400], "```"]
        worth = g.get("jev_ticket_worthiness")
        if worth and worth.get("source") == "jev":
            lines += ["", f"**Jev ticket-worthiness:** {worth['legend']} (level {worth['level']} of {len(WORTH_LEVELS)-1}, confidence {worth['confidence']:.2f}, {worth['model']})"]
        labels = list(dict.fromkeys(["suggested", "drover", *strategy["labels"]]))
        labels += [f"drover-project-{project}", f"drover-env-{env}"]
        for c in channels:
            label = "drover-channel-" + re.sub(r"[^a-z0-9-]", "-", c.lower())
            if label not in labels:
                labels.append(label)
        labels.append(f"drover-severity-{sev}")
        if cause.get("pattern_id"):
            labels.append(f"drover-cause-{cause['pattern_id']}")
        if worth and worth.get("source") == "jev":
            labels.append(f"drover-jev-worth-{worth['level']}")
        title = _suggest_title(ch, g.get("summary") or "")
        if len(members) > 1:
            title = f"[{'+'.join(channels)}] {cause.get('title') or title} ({len(members)} fingerprints)"
        specs.append(TicketSpec(
            fingerprint=g.get("fingerprint", ""), title=title,
            description="\n".join(lines), priority=_suggest_priority(sev, count, total,
                strategy["priority_thresholds"]), labels=labels, channel=ch,
            severity=sev, count=count, first_seen=g.get("first_seen"),
            last_seen=g.get("last_seen"), sample=sample,
            cause_pattern_id=cause.get("pattern_id"),
            cause_confidence=cause.get("confidence"),
            jev_ticket_worthiness=worth,
        ))
    return specs


def to_json(specs: list[TicketSpec]) -> str:
    return json.dumps([{k: v for k, v in asdict(s).items()
                        if k != "jev_ticket_worthiness" or v is not None}
                       for s in specs], indent=2, sort_keys=True)


def render_markdown(specs: list[TicketSpec]) -> str:
    if not specs:
        return "## Recommended JIRA tickets\n\n_No tickets recommended for this evidence._\n"
    lines = ["## Recommended JIRA tickets", "",
             f"_{len(specs)} ticket(s) suggested. Review titles and priorities before creating._", "",
             "| # | Priority | Title | Count | Severity | Channel |",
             "| ---: | :---: | --- | ---: | :---: | --- |"]
    for i, s in enumerate(specs, 1):
        lines.append(f"| {i} | **{s.priority}** | {s.title.replace('|', chr(92)+'|')} | {s.count:,} | `{s.severity}` | `{s.channel or '(none)'}` |")
    lines += ["", "### Ticket details", ""]
    for i, s in enumerate(specs, 1):
        lines += [f"#### {i}. {s.title}", "", f"- **Suggested priority:** {s.priority}",
                  "- **Suggested labels:** " + ", ".join(f"`{l}`" for l in s.labels),
                  "", s.description, ""]
    return "\n".join(lines) + "\n"


def cli_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--cwd", type=Path, default=Path.cwd())
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    args = parser.parse_args(argv)
    try:
        evidence = json.loads(args.evidence.read_text())
        specs = from_evidence(evidence, strategy=load_strategy(args.cwd), jev=resolve_jev())
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.error(str(exc))
    print(to_json(specs) if args.format == "json" else render_markdown(specs), end="\n" if args.format == "json" else "")
    return 0


if __name__ == "__main__":
    sys.exit(cli_main())
