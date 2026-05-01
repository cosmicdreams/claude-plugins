"""drover.aggregate — fingerprint + group + count parsed log events.

Bridges slice-5 parsers and slice-8 reports. Reuses v1's
`fingerprint.fingerprint_structured` so v1 and v2 issue keys share the
same hash space — anything triaged historically remains addressable.

Public surface:

  aggregate(events, log_type) -> Aggregation
  aggregate_files(project_root, env, types, from_date, to_date) -> Aggregation
  delta(current, prior) -> Aggregation  (annotates current with MoM deltas)
  load_coverage(project_root) -> dict

Aggregation shape — see docstring on aggregate() below.
"""
from __future__ import annotations

import collections
import importlib.util
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

# Reuse v1 fingerprint engine — single source of truth across versions.
_HERE = Path(__file__).resolve().parent
_FP_PATH = _HERE / "fingerprint.py"
_spec = importlib.util.spec_from_file_location(
    "drover_fingerprint", _FP_PATH,
)
_fp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fp)

# Reuse parsers (slice 5).
sys.path.insert(0, str(_HERE))
import parsers  # noqa: E402
from pull import find_log_file  # noqa: E402


SAMPLE_LINES_PER_GROUP = 3
SUMMARY_LEN = 240


# log_type (Acquia naming) -> v1 fingerprint source key
LOG_TYPE_TO_SOURCE: dict[str, str] = {
    "drupal-watchdog": "watchdog",
    "apache-error": "apache",
    "php-error": "php",
}


def _fingerprint_event(ev: dict, log_type: str) -> str:
    """Compute the v1-compatible fingerprint for a parsed event."""
    src = LOG_TYPE_TO_SOURCE.get(log_type, "other")
    fields = ev.get("fields") or {}

    if src == "watchdog":
        return _fp.fingerprint_structured(
            "watchdog",
            ev.get("message", ""),
            type_=ev.get("channel"),
            level=ev.get("severity"),
        )
    if src == "php":
        # Pull the file:line out of the message tail for fingerprint
        # stability across runs that touch the same file/line.
        msg = ev.get("message", "")
        file_marker = ""
        idx = msg.rfind(" in /")
        if idx >= 0:
            file_marker = msg[idx + 4:].split(" ")[0]
        return _fp.fingerprint_structured(
            "php",
            msg,
            level=fields.get("php_level") or ev.get("severity"),
            file=file_marker,
        )
    if src == "apache":
        return _fp.fingerprint_structured(
            "apache",
            ev.get("message", ""),
            level=ev.get("severity"),
        )
    return _fp.fingerprint_structured(
        src, ev.get("message", ""), level=ev.get("severity"),
    )


# --- Single-pass aggregator -----------------------------------------------

def aggregate(events: Iterable[dict], log_type: str) -> dict:
    """Group events by fingerprint and return a report-ready dict.

    Returns:
      {
        "groups": {fp: {fingerprint, source, channel, count, severities,
                        first_seen, last_seen, samples, summary,
                        days: {date_iso: count}}},
        "by_severity": {sev: count},
        "by_channel":  {channel: count},
        "by_day":      {date_iso: {total, severity_counts}},
        "events_total": int,
        "log_type": log_type,
      }
    """
    src = LOG_TYPE_TO_SOURCE.get(log_type, "other")
    groups: dict[str, dict] = {}
    by_severity: collections.Counter = collections.Counter()
    by_channel: collections.Counter = collections.Counter()
    by_day: dict[str, dict] = {}
    total = 0

    for ev in events:
        total += 1
        fp = _fingerprint_event(ev, log_type)
        sev = ev.get("severity") or "unknown"
        ch = ev.get("channel") or "(none)"
        ts = ev.get("ts")
        date_iso = ts.date().isoformat() if ts else "unknown"

        by_severity[sev] += 1
        by_channel[ch] += 1
        bucket = by_day.setdefault(
            date_iso, {"total": 0, "severities": collections.Counter()},
        )
        bucket["total"] += 1
        bucket["severities"][sev] += 1

        g = groups.get(fp)
        if g is None:
            g = {
                "fingerprint": fp,
                "source": src,
                "channel": ev.get("channel"),
                "count": 0,
                "severities": collections.Counter(),
                "first_seen": ts,
                "last_seen": ts,
                "samples": [],
                "summary": (ev.get("message") or "")[:SUMMARY_LEN],
                "days": collections.Counter(),
            }
            groups[fp] = g

        g["count"] += 1
        g["severities"][sev] += 1
        g["days"][date_iso] += 1
        if ts is not None:
            if g["first_seen"] is None or ts < g["first_seen"]:
                g["first_seen"] = ts
            if g["last_seen"] is None or ts > g["last_seen"]:
                g["last_seen"] = ts
        if len(g["samples"]) < SAMPLE_LINES_PER_GROUP:
            g["samples"].append(ev.get("raw") or "")

    # Finalize: pick majority severity for each group, freeze counters.
    out_groups: list[dict] = []
    for g in groups.values():
        majority_sev = g["severities"].most_common(1)[0][0]
        out_groups.append({
            "fingerprint": g["fingerprint"],
            "source": g["source"],
            "channel": g["channel"],
            "severity": majority_sev,
            "severities": dict(g["severities"]),
            "count": g["count"],
            "first_seen": (
                g["first_seen"].isoformat() if g["first_seen"] else None
            ),
            "last_seen": (
                g["last_seen"].isoformat() if g["last_seen"] else None
            ),
            "samples": g["samples"],
            "summary": g["summary"],
            "days": dict(g["days"]),
        })
    out_groups.sort(key=lambda x: x["count"], reverse=True)

    return {
        "log_type": log_type,
        "events_total": total,
        "groups": out_groups,
        "by_severity": dict(by_severity),
        "by_channel": dict(by_channel),
        "by_day": {
            d: {
                "total": v["total"],
                "severities": dict(v["severities"]),
            }
            for d, v in by_day.items()
        },
    }


# --- File walker ----------------------------------------------------------

def _date_range_inclusive(from_d: date, to_d: date) -> list[date]:
    out, cur = [], from_d
    while cur <= to_d:
        out.append(cur)
        cur += timedelta(days=1)
    return out


def aggregate_files(
    project_root: Path,
    *,
    env: str,
    types: list[str] | None = None,
    from_date: date,
    to_date: date,
) -> dict:
    """Walk every <project>/<year>/<month>/<date>.<env>.<type>.log
    across (types x days), parse, and emit a single combined aggregate.

    Each log_type produces its own fingerprint namespace, but groups
    from all types are merged into one `groups` list — fingerprints
    are unique across types (the source prefix prevents collisions),
    so this is safe.
    """
    types = types or list(LOG_TYPE_TO_SOURCE.keys())
    days = _date_range_inclusive(from_date, to_date)

    combined_groups: dict[str, dict] = {}
    by_severity: collections.Counter = collections.Counter()
    by_channel: collections.Counter = collections.Counter()
    by_day: dict[str, dict] = {}
    files_read = 0
    files_missing = 0
    events_total = 0

    for log_type in types:
        for day in days:
            local = find_log_file(project_root, day, env, log_type)
            if local is None:
                files_missing += 1
                continue
            files_read += 1
            agg = aggregate(
                parsers.parse_file(local, log_type, day_hint=day),
                log_type,
            )
            events_total += agg["events_total"]
            by_severity.update(agg["by_severity"])
            by_channel.update(agg["by_channel"])
            for d_iso, db in agg["by_day"].items():
                bucket = by_day.setdefault(
                    d_iso,
                    {"total": 0, "severities": collections.Counter()},
                )
                bucket["total"] += db["total"]
                bucket["severities"].update(db["severities"])

            # Merge groups
            for g in agg["groups"]:
                fp = g["fingerprint"]
                if fp not in combined_groups:
                    combined_groups[fp] = {
                        **g,
                        "severities": collections.Counter(g["severities"]),
                        "days": collections.Counter(g["days"]),
                    }
                    continue
                cg = combined_groups[fp]
                cg["count"] += g["count"]
                cg["severities"].update(g["severities"])
                cg["days"].update(g["days"])
                if g["first_seen"] and (
                    not cg["first_seen"] or g["first_seen"] < cg["first_seen"]
                ):
                    cg["first_seen"] = g["first_seen"]
                if g["last_seen"] and (
                    not cg["last_seen"] or g["last_seen"] > cg["last_seen"]
                ):
                    cg["last_seen"] = g["last_seen"]
                # Keep up to SAMPLE_LINES_PER_GROUP samples total.
                room = SAMPLE_LINES_PER_GROUP - len(cg["samples"])
                if room > 0:
                    cg["samples"].extend(g["samples"][:room])

    out_groups: list[dict] = []
    for g in combined_groups.values():
        majority_sev = max(g["severities"].items(), key=lambda kv: kv[1])[0]
        out_groups.append({
            "fingerprint": g["fingerprint"],
            "source": g["source"],
            "channel": g["channel"],
            "severity": majority_sev,
            "severities": dict(g["severities"]),
            "count": g["count"],
            "first_seen": g["first_seen"],
            "last_seen": g["last_seen"],
            "samples": g["samples"],
            "summary": g["summary"],
            "days": dict(g["days"]),
        })
    out_groups.sort(key=lambda x: x["count"], reverse=True)

    return {
        "metadata": {
            "project_root": str(project_root),
            "env": env,
            "types": types,
            "from": from_date.isoformat(),
            "to": to_date.isoformat(),
            "files_read": files_read,
            "files_missing": files_missing,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        "events_total": events_total,
        "groups": out_groups,
        "by_severity": dict(by_severity),
        "by_channel": dict(by_channel),
        "by_day": {
            d: {
                "total": v["total"],
                "severities": dict(v["severities"]),
            }
            for d, v in by_day.items()
        },
    }


# --- Month-over-month delta -----------------------------------------------

def delta(current: dict, prior: dict | None) -> dict:
    """Annotate `current` with per-group MoM deltas.

    A copy is returned so callers can compare side-by-side. Groups
    present only in current (new) carry delta with prior_count=0;
    groups present only in prior surface as a "disappeared" list.
    """
    if prior is None:
        return current

    prior_by_fp = {g["fingerprint"]: g for g in prior.get("groups", [])}
    enriched_groups: list[dict] = []
    for g in current.get("groups", []):
        prior_g = prior_by_fp.get(g["fingerprint"])
        prior_count = prior_g["count"] if prior_g else 0
        delta_count = g["count"] - prior_count
        delta_pct = (
            None
            if prior_count == 0
            else round(delta_count / prior_count * 100, 1)
        )
        enriched_groups.append({
            **g,
            "delta": {
                "prior_count": prior_count,
                "delta_count": delta_count,
                "delta_pct": delta_pct,
                "is_new": prior_g is None,
            },
        })

    seen_fps = {g["fingerprint"] for g in current.get("groups", [])}
    disappeared = [
        {
            "fingerprint": g["fingerprint"],
            "source": g.get("source"),
            "channel": g.get("channel"),
            "summary": g.get("summary"),
            "prior_count": g["count"],
        }
        for g in prior.get("groups", [])
        if g["fingerprint"] not in seen_fps
    ]

    return {
        **current,
        "groups": enriched_groups,
        "disappeared_from_prior": disappeared,
        "prior_metadata": prior.get("metadata", {}),
    }


# --- Coverage helper ------------------------------------------------------

def load_coverage(project_root: Path) -> dict:
    p = project_root / ".drover" / "coverage.json"
    if not p.exists():
        return {}
    import json
    return json.loads(p.read_text())
