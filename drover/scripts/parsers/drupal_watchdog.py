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


def parse(text: str, *, day_hint: date | None = None) -> Iterator[dict]:
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
