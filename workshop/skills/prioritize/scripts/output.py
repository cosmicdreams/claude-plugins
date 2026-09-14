#!/usr/bin/env python3
"""Offline canonical ranking and output for workshop:prioritize (stdlib only)."""

import argparse
from collections import Counter
from datetime import date, datetime, timedelta
from html import escape
import json
import math
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit

BASE = {"RESPOND": 100, "DUE": 90, "UNBLOCK": 80, "REVIEW": 40, "FYI": 10}
SCOPE = {"sprint": 30, "release": 20, "backlog": -30, None: 0}
STATUSES = {"connected", "partial", "unavailable", "not_configured", "not_connected", "unknown"}


def validate(data):
    """Check the collection contract before ranking or touching saved artifacts."""
    def require(condition, field):
        if not condition:
            raise ValueError("Invalid or missing " + field)

    def string(value, field):
        require(isinstance(value, str), field)

    def mapping(value, field):
        require(isinstance(value, dict), field)

    def number(value, field):
        require(type(value) in (int, float), field)
        require(math.isfinite(value), field)

    def count(value, field):
        require(type(value) is int and value >= 0, field)

    def timestamp(value, field, utc=False):
        string(value, field)
        require("T" in value, field)
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(parsed.utcoffset() is not None, field)
        if utc:
            require(parsed.utcoffset() == timedelta(0), field)

    def day(value, field):
        string(value, field)
        require(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is not None, field)
        date.fromisoformat(value)

    mapping(data, "input")
    day(data.get("today"), "today")
    timestamp(data.get("generated_at"), "generated_at", utc=True)
    require(data.get("mode") in ("on-demand", "ambient"), "mode")
    require(isinstance(data.get("items"), list), "items")
    for item in data["items"]:
        mapping(item, "item")
        for key in ("id", "action", "source", "summary"):
            string(item.get(key), "item." + key)
        require(item["action"] in BASE, "item.action")
        require(item.get("scope") in ("sprint", "release", "backlog", None), "item.scope")
        for key in ("project", "server_name", "url"):
            if item.get(key) is not None:
                string(item[key], "item." + key)
        for key in ("stale", "overdue"):
            if key in item:
                require(type(item[key]) is bool, "item." + key)
        for key in ("detail", "excerpt"):
            if key in item:
                string(item[key], "item." + key)
        if item.get("due_date") is not None:
            day(item["due_date"], "item.due_date")
    for key in ("why", "next_id"):
        if key in data:
            string(data[key], key)
    counts = data.get("counts")
    mapping(counts, "counts")
    for key in ("committed_sprint", "committed_release", "unplanned_backlog"):
        count(counts.get(key), "counts." + key)
    projects = counts.get("unplanned_backlog_by_project")
    mapping(projects, "counts.unplanned_backlog_by_project")
    for key, value in projects.items():
        string(key, "project count key")
        require(len(key.split(":")) == 2 and all(key.split(":")), "server:project count key")
        count(value, "project count")
    require(sum(projects.values()) == counts["unplanned_backlog"], "backlog count total")
    for key in ("quiet_sources", "no_attention_sources", "errors"):
        require(isinstance(data.get(key, []), list), key)
        for value in data.get(key, []):
            string(value, key)
    coverage = data.get("coverage")
    mapping(coverage, "coverage")
    for key in ("slack", "jira", "calendar", "work_calendar", "work_email"):
        require(key in coverage, "coverage." + key)
    for key, value in coverage.items():
        string(value, "coverage." + key)
        require(value in STATUSES, "coverage." + key)
    weights = data.get("weights", {})
    mapping(weights, "weights")
    for key, value in weights.items():
        require(key in (*BASE, "scope"), "weights." + key)
        if key == "scope":
            mapping(value, "weights.scope")
            for scope, weight in value.items():
                require(scope in ("sprint", "release", "backlog"), "weights.scope key")
                number(weight, "weights.scope." + scope)
        else:
            number(value, "weights." + key)
    availability = data.get("availability")
    if availability is None or availability == "unknown":
        availability = {}
    mapping(availability, "availability")
    if availability.get("free_hours_today") is not None:
        number(availability["free_hours_today"], "free_hours_today")
        require(availability["free_hours_today"] >= 0, "free_hours_today")
    for key in ("next_meeting", "next_free_block"):
        value = availability.get(key)
        if value is not None:
            mapping(value, key)
            timestamp(value.get("start"), key + ".start")
            if key == "next_meeting":
                string(value.get("title"), key + ".title")
            else:
                count(value.get("minutes"), key + ".minutes")
    require(availability.get("work_calendar", "not_connected") in
            ("connected", "not_connected"), "availability.work_calendar")
    return {"free_hours_today": None, "next_meeting": None, "next_free_block": None,
            "work_calendar": "not_connected", **availability}


def canonical(data):
    """Rank every collected candidate; quotas select views, never remove data."""
    availability = validate(data)
    today = date.fromisoformat(data["today"])
    weights = data.get("weights", {})
    base = {**BASE, **{k: v for k, v in weights.items() if k in BASE}}
    scope = {**SCOPE, **weights.get("scope", {})}
    items = []
    seen = set()
    for raw in data["items"]:
        item = {key: raw[key] for key in ("id", "action", "source", "summary")}
        for key in ("scope", "project", "server_name", "due_date", "url"):
            item[key] = raw.get(key)
        item["stale"] = raw.get("stale", False)
        item["detail"] = raw.get("detail", raw.get("excerpt", ""))
        if item["id"] in seen:
            raise ValueError("Merge duplicate id before ranking: " + item["id"])
        seen.add(item["id"])
        due = date.fromisoformat(item["due_date"]) if item["due_date"] else None
        item["overdue"] = bool(due and due < today)
        item["mandatory"] = item["action"] in ("RESPOND", "UNBLOCK") or bool(due and due <= today)
        item["score"] = (base[item["action"]] + scope[item["scope"]]
                         + (5 if item["stale"] else 0)
                         + (15 if item["action"] == "DUE" and item["overdue"] else 0))
        if not math.isfinite(item["score"]):
            raise ValueError("Non-finite score")
        items.append(item)
    items.sort(key=lambda i: -i["score"])  # Stable ties preserve collection order.
    for rank, item in enumerate(items, 1):
        item["rank"] = rank

    # Scope-first project slots for ordinary items. Urgent obligations are additional.
    eligible = {i["id"] for i in items if i["mandatory"]}
    slots = Counter()
    for item in sorted(items, key=lambda i: i["scope"] == "backlog"):
        if item["mandatory"]:
            continue
        group = (item["server_name"], item["project"])
        if item["project"] is None or slots[group] < 5:
            eligible.add(item["id"])
            slots[group] += 1
    display = [i for i in items if i["id"] in eligible][:15]
    selected = {i["id"] for i in display}
    display = [i for i in items if i["id"] in selected or i["mandatory"]]
    next_id = data.get("next_id")
    next_item = next((i for i in items if i["id"] == next_id), None) if next_id is not None else (items[0] if items else None)
    if next_id is not None and next_item is None:
        raise ValueError("next_id must refer to a ranked candidate")
    if next_item and next_item not in display:
        display = sorted(display + [next_item], key=lambda i: i["rank"])
    selected = {i["id"] for i in display}
    suppressed = Counter()
    for item in items:
        if item["scope"] == "backlog" and item["id"] not in selected:
            suppressed[f'{item["server_name"]}:{item["project"]}'] += 1
    return {
        "schema_version": 1, "generated_at": data["generated_at"], "mode": data["mode"],
        "next": {**next_item, "why": data.get("why", "highest score")} if next_item else None,
        "items": items, "omitted_count": 0,
        "display": {"item_ids": [i["id"] for i in display],
                    "omitted_count": len(items) - len(display),
                    "backlog_suppressed": dict(suppressed)},
        "counts": data["counts"], "quiet_sources": data.get("quiet_sources", []),
        "no_attention_sources": data.get("no_attention_sources", []),
        "errors": data.get("errors", []), "coverage": data["coverage"],
        "availability": availability,
    }


def notes(result):
    counts = result["counts"]
    return [
        f'Committed: {counts["committed_sprint"]} in sprint · {counts["committed_release"]} in unreleased version',
        f'Unplanned backlog: {counts["unplanned_backlog"]} assigned; by project: {json.dumps(counts["unplanned_backlog_by_project"], sort_keys=True)}',
        "Quiet: " + ", ".join(result["quiet_sources"]),
        "No items needing attention: " + ", ".join(result["no_attention_sources"]),
        "(work email/calendar: not connected)",
        "Coverage: " + json.dumps(result["coverage"], sort_keys=True),
        f'{result["display"]["omitted_count"]} more items omitted from view (snapshot is uncapped)',
        *["⚠ " + error for error in result["errors"]],
    ]


def rows(result):
    selected = set(result["display"]["item_ids"])
    return [i for i in result["items"] if i["id"] in selected]


def terminal(result):
    item = result["next"]
    lead = (f'NEXT → [{item["action"]}] {item["source"]}: {item["summary"]}\n'
            f'       why: {item["why"]}') if item else (
                "Nothing needs your attention across successfully checked sources."
                if result["errors"] else "Nothing needs your attention. Clean slate.")
    lines = [lead, "Availability: " + json.dumps(result["availability"]), "",
             "#   Action   Scope    Source                 Summary"]
    for item in rows(result):
        lines.append(f'{item["rank"]:<3} {item["action"]:<8} {item["scope"] or "":<8} '
                     f'{item["source"][:22]:<22} {item["summary"]}')
    return "\n".join(lines + [""] + notes(result))


def html(result):
    text = lambda value: escape(str(value), quote=True)
    item = result["next"]
    hero = (f'<h2>{text(item["action"])} · {text(item["source"])}</h2>'
            f'<p>{text(item["summary"])}</p><p>Why: {text(item["why"])}</p>') if item else "<h2>No next action identified</h2>"
    rendered_rows = []
    for item in rows(result):
        summary = text(item["summary"])
        url = item["url"]
        if url and urlsplit(url).scheme in ("http", "https") and urlsplit(url).netloc:
            summary = f'<a href="{text(url)}" rel="noreferrer">{summary}</a>'
        rendered_rows.append(f'<tr><td>{item["rank"]}</td><td>{text(item["action"])}</td>'
                             f'<td>{text(item["scope"] or "")}</td><td>{summary}'
                             f'<p>{text(item["source"])}</p><p>{text(item["detail"])}</p></td></tr>')
    template = (Path(__file__).parent.parent / "assets" / "brief.template.html").read_text()
    # One substitution pass: untrusted text containing template markers stays literal.
    values = {"GENERATED_AT": text(result["generated_at"]), "HERO": hero,
              "AVAILABILITY": text(json.dumps(result["availability"])),
              "QUEUE_ROWS": "".join(rendered_rows),
              "COVERAGE_NOTES": "".join(f"<li>{text(n)}</li>" for n in notes(result))}
    return re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: values[m[1]], template)


def atomic_write(path, content):
    """Keep the prior complete file intact until its replacement is ready."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
        temp = Path(stream.name)
        try:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            temp.unlink(missing_ok=True)
            raise
    try:
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def publish(result, data_path):
    if result["mode"] != "on-demand":
        return json.dumps(result, allow_nan=False)  # Ambient never writes artifacts.
    snapshot = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    brief = html(result)
    rendered_terminal = terminal(result)
    atomic_write(Path(data_path) / "workshop-prioritize.snapshot.json", snapshot)
    atomic_write(Path(data_path) / "workshop-prioritize.brief.html", brief)
    return rendered_terminal


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--data-path", required=True, type=Path)
    args = parser.parse_args()
    data = json.loads(args.input.read_text())
    result = canonical(data)
    # Ambient state comparison/notification remains step 6's responsibility.
    print(publish(result, args.data_path.expanduser()))


if __name__ == "__main__":
    main()
