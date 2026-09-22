"""Parser for Drupal's syslog-style watchdog log.

Each line is a single event. The default Drupal syslog format is:

  <syslog-ts> <hostname> <site>: <base_url>|<unix_ts>|<type>|<ip>|
      <request_uri>|<referer>|<uid>|<link>|<message>

Severity is NOT in the default format unless the operator enabled
syslog.severity. We infer severity from the channel/type ('php' channel
is typically warning+; 'access denied' is notice; the 'access denied'
prefix in the message is also a strong signal). Otherwise we mark
severity=unknown — the report layer can group on channel even without
severity.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Iterator

from .common import iter_nonempty_lines, parse_syslog_ts

# --- Optional Jev severity for events the log gives none -------------------
#
# The default syslog format carries no severity, and _infer_severity only
# knows a handful of channels. When parse() is given a jev_client module,
# events still marked `unknown` are classified by Jev — one Choice per
# distinct (channel, message), most frequent first, up to a cap — and a
# confident answer replaces `unknown`. Severity the log or channel table
# already gave is never overridden. Without Jev the parser is unchanged.
# Starting thresholds; tune against real watchdog logs.
SEVERITY_CONFIDENCE_THRESHOLD = 0.7
MAX_SEVERITY_LOOKUPS = 100
SEVERITY_CRITERIA = {
    "critical": "The site or the request failed outright: fatal errors, crashes, data loss",
    "error": "An operation failed or an exception was raised, but the site kept running",
    "warning": "Something unexpected that did not fail: deprecated usage, a recoverable problem, a retry",
    "notice": "A normal but significant event: access denied, a login, a configuration change",
    "info": "Routine informational logging: cron ran, a cache was cleared, a page was not found",
}
_MESSAGE_KEY_CHARS = 400


# "Apr  3 00:00:33 drupal-7fc4d489c7-98l2f pncb: <pipe-delimited message>"
_HEADER = re.compile(
    r"^(?P<ts>\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})"
    r"\s+(?P<host>\S+)"
    r"\s+(?P<program>[^:]+):\s*"
    r"(?P<body>.*)$"
)

# Channels whose presence implies a severity even without explicit level.
_HIGH_SEVERITY_CHANNELS: dict[str, str] = {
    "php": "error",
    "cron": "warning",
    "system": "warning",
    "page not found": "info",
    "access denied": "notice",
    "ban": "warning",
    "user_warning": "warning",
}


def _infer_severity(channel: str | None, message: str) -> str:
    if channel:
        ch = channel.lower()
        if ch in _HIGH_SEVERITY_CHANNELS:
            return _HIGH_SEVERITY_CHANNELS[ch]
    msg = (message or "").lower()
    if msg.startswith("emergency:") or "fatal error" in msg:
        return "critical"
    if msg.startswith("error:") or "exception" in msg:
        return "error"
    if msg.startswith("warning:") or msg.startswith("notice:"):
        return msg.split(":", 1)[0]
    return "unknown"


def _split_pipe_message(body: str) -> dict:
    """Split the 9-field pipe-delimited Drupal syslog body.

    base_url|unix_ts|type|ip|request_uri|referer|uid|link|message

    We split with maxsplit=8 so the message field can contain `|`
    legitimately without being chopped.
    """
    parts = body.split("|", 8)
    if len(parts) < 9:
        # Padding short rows preserves index access without IndexError.
        parts += [""] * (9 - len(parts))
    base_url, unix_ts, log_type, ip, req, ref, uid, link, message = parts
    return {
        "base_url": base_url,
        "unix_ts": unix_ts,
        "type": log_type,
        "ip": ip,
        "request_uri": req,
        "referer": ref,
        "uid": uid,
        "link": link,
        "message": message,
    }


def _parse_lines(text: str, *, day_hint: date | None = None) -> Iterator[dict]:
    """Yield one event per logical entry, folding continuation lines.

    Drupal logs embedded SQL queries and PHP stack traces with literal
    newlines in the watchdog message field. When written to a file
    those become multiple physical lines where only the first carries
    the syslog header. We attach those continuation lines to the
    preceding event's `raw` (and append them to `message`) rather
    than emitting a degraded event per line.
    """
    pending: dict | None = None

    for raw in iter_nonempty_lines(text):
        m = _HEADER.match(raw)
        if not m:
            if pending is not None:
                pending["raw"] += "\n" + raw
                pending["message"] = (
                    pending["message"] + " " + raw.strip()
                ).strip()
                pending.setdefault("fields", {}).setdefault(
                    "continuation_lines", 0,
                )
                pending["fields"]["continuation_lines"] += 1
                continue
            # Orphaned line before any header — degraded event.
            yield {
                "ts": None,
                "severity": "unknown",
                "channel": None,
                "message": raw,
                "raw": raw,
                "fields": {"parse_error": "no_header_match"},
            }
            continue

        if pending is not None:
            yield pending

        ts = parse_syslog_ts(m.group("ts"), day_hint=day_hint)
        body_fields = _split_pipe_message(m.group("body"))
        message = body_fields["message"].strip()
        channel = body_fields["type"] or None
        severity = _infer_severity(channel, message)

        pending = {
            "ts": ts,
            "severity": severity,
            "channel": channel,
            "message": message,
            "raw": raw,
            "fields": {
                "host": m.group("host"),
                "program": m.group("program"),
                "ip": body_fields["ip"] or None,
                "request_uri": body_fields["request_uri"] or None,
                "referer": body_fields["referer"] or None,
                "uid": body_fields["uid"] or None,
                "base_url": body_fields["base_url"] or None,
                "unix_ts": body_fields["unix_ts"] or None,
                "link": body_fields["link"] or None,
            },
        }

    if pending is not None:
        yield pending


def _classify_unknown_severities(events: list[dict], jev, jev_stats: dict | None) -> None:
    """Fill `unknown` severities in place with confident Jev answers."""
    by_key: dict[tuple, list[dict]] = {}
    for ev in events:
        if ev.get("severity") == "unknown" and ev.get("message"):
            key = (ev.get("channel"), ev["message"][:_MESSAGE_KEY_CHARS])
            by_key.setdefault(key, []).append(ev)
    if not by_key:
        return

    ranked = sorted(by_key.items(), key=lambda kv: len(kv[1]), reverse=True)
    asked = ranked[:MAX_SEVERITY_LOOKUPS]
    items = {
        str(n): {"channel": channel, "message": message}
        for n, ((channel, message), _) in enumerate(asked)
    }
    question = {
        "severity": {
            "type": "choice",
            "instructions": "Which severity would Drupal's logger have assigned "
                            "to this watchdog entry?",
            "criteria": dict(SEVERITY_CRITERIA),
        },
    }
    response = jev.ask_items(items, question)

    def tally(record: dict) -> None:
        if jev_stats is None:
            return
        jev_stats.setdefault("jev", 0)
        jev_stats.setdefault("fallback", 0)
        jev_stats[record["source"]] += 1
        if record.get("model"):
            jev_stats["model"] = record["model"]

    for n, (_, group) in enumerate(asked):
        result = response["results"].get(str(n)) or {"ok": False, "reason": response["reason"]}
        if result["ok"]:
            record = jev.choice_verdict(
                result["answers"]["severity"],
                threshold=SEVERITY_CONFIDENCE_THRESHOLD, model=response["model"],
            )
            if record["source"] == "jev" and not record["confident"]:
                record = {**record, "source": "fallback", "reason": "low_confidence"}
        else:
            record = jev.fallback(result["reason"])
        tally(record)
        for ev in group:
            if record["source"] == "jev":
                ev["severity"] = record["choice"]
            ev.setdefault("fields", {})["severity_source"] = record["source"]
            ev["fields"]["severity_jev"] = record
    for _, group in ranked[MAX_SEVERITY_LOOKUPS:]:
        tally(jev.fallback("lookup_cap"))
        for ev in group:
            ev.setdefault("fields", {})["severity_source"] = "fallback"


def parse(
    text: str, *, day_hint: date | None = None, jev=None, jev_stats: dict | None = None,
) -> Iterator[dict]:
    """Yield parsed events. With `jev` (a jev_client module) the stream is
    buffered so `unknown` severities can be classified in batches first;
    without it the parser streams exactly as before."""
    if jev is None:
        yield from _parse_lines(text, day_hint=day_hint)
        return
    events = list(_parse_lines(text, day_hint=day_hint))
    _classify_unknown_severities(events, jev, jev_stats)
    yield from events
