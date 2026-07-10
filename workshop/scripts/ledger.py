#!/usr/bin/env python3
"""Work-event ledger: append-only JSON Lines store with dedupe, cursors, coverage.

Pure stdlib. The ledger holds FACTS only — no project, no bucket, no minutes.
Classification happens at read time (recap) from project_map rules in workshop.json.

Files (under --data-dir, default ~/.claude):
  workshop-ledger.jsonl        one event per line, append-only, last-write-wins on id
  workshop-sync-state.json     per-source cursors + coverage records

Event schema (validated on append):
  id           required  source-native identifier, e.g. "outlook:conversation:X:message:Y"
  source       required  outlook | slack | jira | zoom | calendar | git
  kind         required  email | message | comment | transition | meeting | meeting_summary | commit | meta
  occurred_at  required  ISO 8601 UTC
  observed_at  required  ISO 8601 UTC (stamped automatically if absent)
  actor        required  self | other
  provenance   required  self | untrusted
  summary      required  short text; envelope facts for untrusted events
  work_item    optional  canonical key once known (e.g. AHRIPS-412)
  ref          optional  deep link to the source

Subcommands:
  append   read events (JSON object or array) from stdin, skip-if-present by id
  query    --since ISO --until ISO [--source S] [--actor A] [--kind K] → JSON array
  cursor   get|set --source S [--value ISO]
  coverage report → per-source last-committed cursor + last sync outcome
  record-sync --source S --status ok|failed [--detail TEXT]  (coverage bookkeeping)
"""
import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone

REQUIRED = ("id", "source", "kind", "occurred_at", "actor", "provenance", "summary")
SOURCES = {"outlook", "slack", "jira", "zoom", "calendar", "git"}
ACTORS = {"self", "other"}
PROVENANCE = {"self", "untrusted"}


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def data_dir(args):
    d = os.path.expanduser(args.data_dir)
    os.makedirs(d, exist_ok=True)
    return d


def ledger_path(args):
    return os.path.join(data_dir(args), "workshop-ledger.jsonl")


def state_path(args):
    return os.path.join(data_dir(args), "workshop-sync-state.json")


def load_state(args):
    try:
        with open(state_path(args)) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"cursors": {}, "syncs": {}}


def save_state(args, state):
    # atomic replace so a concurrent reader never sees a torn file
    d = data_dir(args)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".state-")
    with os.fdopen(fd, "w") as f:
        json.dump(state, f, indent=1)
    os.replace(tmp, state_path(args))


def iter_events(args):
    try:
        with open(ledger_path(args)) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue  # tolerate a torn line rather than dying mid-week
    except FileNotFoundError:
        return


def existing_ids(args):
    return {e["id"] for e in iter_events(args) if "id" in e}


def validate(ev):
    missing = [k for k in REQUIRED if not ev.get(k)]
    if missing:
        return f"missing fields: {', '.join(missing)}"
    if ev["source"] not in SOURCES:
        return f"bad source: {ev['source']}"
    if ev["actor"] not in ACTORS:
        return f"bad actor: {ev['actor']}"
    if ev["provenance"] not in PROVENANCE:
        return f"bad provenance: {ev['provenance']}"
    return None


def cmd_append(args):
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"appended": 0, "skipped": 0, "rejected": 0}))
        return 0
    data = json.loads(raw)
    events = data if isinstance(data, list) else [data]
    seen = existing_ids(args)
    appended = skipped = 0
    rejected = []
    with open(ledger_path(args), "a") as f:
        for ev in events:
            err = validate(ev)
            if err:
                rejected.append({"id": ev.get("id", "?"), "error": err})
                continue
            if ev["id"] in seen:
                skipped += 1
                continue
            ev.setdefault("observed_at", now_iso())
            line = json.dumps(ev, ensure_ascii=False)
            f.write(line + "\n")
            f.flush()
            seen.add(ev["id"])
            appended += 1
    out = {"appended": appended, "skipped": skipped, "rejected": len(rejected)}
    if rejected:
        out["rejections"] = rejected
    print(json.dumps(out))
    return 1 if rejected else 0


def cmd_query(args):
    results = {}
    for ev in iter_events(args):  # later lines win: last-write-wins on id
        t = ev.get("occurred_at", "")
        if args.since and t < args.since:
            continue
        if args.until and t >= args.until:
            continue
        if args.source and ev.get("source") != args.source:
            continue
        if args.actor and ev.get("actor") != args.actor:
            continue
        if args.kind and ev.get("kind") != args.kind:
            continue
        results[ev["id"]] = ev
    ordered = sorted(results.values(), key=lambda e: e.get("occurred_at", ""))
    print(json.dumps(ordered, ensure_ascii=False, indent=1))
    return 0


def cmd_cursor(args):
    state = load_state(args)
    if args.action == "get":
        print(json.dumps({"source": args.source,
                          "cursor": state["cursors"].get(args.source)}))
        return 0
    if not args.value:
        print("cursor set requires --value", file=sys.stderr)
        return 2
    state["cursors"][args.source] = args.value
    save_state(args, state)
    print(json.dumps({"source": args.source, "cursor": args.value}))
    return 0


def cmd_record_sync(args):
    state = load_state(args)
    state["syncs"][args.source] = {
        "at": now_iso(), "status": args.status, "detail": args.detail or ""}
    save_state(args, state)
    print(json.dumps(state["syncs"][args.source]))
    return 0


def cmd_coverage(args):
    state = load_state(args)
    report = {}
    for src in sorted(SOURCES):
        report[src] = {
            "cursor": state["cursors"].get(src),
            "last_sync": state["syncs"].get(src),
        }
    print(json.dumps(report, indent=1))
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data-dir", default="~/.claude")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("append")

    q = sub.add_parser("query")
    q.add_argument("--since")
    q.add_argument("--until")
    q.add_argument("--source")
    q.add_argument("--actor")
    q.add_argument("--kind")

    c = sub.add_parser("cursor")
    c.add_argument("action", choices=["get", "set"])
    c.add_argument("--source", required=True)
    c.add_argument("--value")

    r = sub.add_parser("record-sync")
    r.add_argument("--source", required=True)
    r.add_argument("--status", required=True, choices=["ok", "failed"])
    r.add_argument("--detail")

    sub.add_parser("coverage")

    args = p.parse_args()
    return {"append": cmd_append, "query": cmd_query, "cursor": cmd_cursor,
            "record-sync": cmd_record_sync, "coverage": cmd_coverage}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
