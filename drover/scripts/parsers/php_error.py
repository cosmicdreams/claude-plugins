"""Parser for PHP error-log lines.

Default PHP error-log format:

  [03-Apr-2026 00:00:33 UTC] PHP Fatal error: <message> in <file> on line <N>
  [03-Apr-2026 00:01:01 UTC] PHP Warning:  <message> in <file> on line <N>
  [03-Apr-2026 00:01:01 UTC] PHP Stack trace:                       <-- followed
  [03-Apr-2026 00:01:01 UTC] PHP   1. {main}() <file>:0             <-- by indented
                                                                        continuation
                                                                        lines

Continuation lines (PHP Stack trace blocks) are folded into the
preceding event's `fields["stack_trace"]`. We do not emit a separate
event per stack frame.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Iterator

from .common import iter_nonempty_lines, normalize_severity, parse_php_ts


# [03-Apr-2026 00:00:33 UTC] PHP Fatal error:  <message>
_LEAD = re.compile(
    r"^\[(?P<ts>[^\]]+)\]"
    r"\s+PHP\s+(?P<level>Fatal\s+error|Parse\s+error|Notice|Warning|"
    r"Strict\s+Standards|Deprecated|User\s+(?:Notice|Warning|Error|Deprecated))"
    r"\s*:\s*(?P<message>.*)$"
)
_STACK_LEAD = re.compile(
    r"^\[(?P<ts>[^\]]+)\]\s+PHP\s+Stack\s+trace:?\s*$",
    re.IGNORECASE,
)
_STACK_FRAME = re.compile(
    r"^\[(?P<ts>[^\]]+)\]\s+PHP\s+(?P<frame>\s*\d+\..*)$"
)
# Some PHP setups use a flat format (no [ts]) — seen rarely on Acquia,
# but support it as a degraded fallback.
_FLAT = re.compile(
    r"^PHP\s+(?P<level>Fatal\s+error|Parse\s+error|Notice|Warning|"
    r"Deprecated)\s*:\s*(?P<message>.*)$"
)


def _normalize_php_level(token: str) -> str:
    """Collapse 'Fatal error', 'User Warning', etc. to a single token."""
    t = token.strip().lower().replace(" ", "_")
    # 'fatal_error' -> 'fatal'
    if t.endswith("_error"):
        t = t[: -len("_error")]
    return t


def parse(text: str, *, day_hint: date | None = None) -> Iterator[dict]:
    pending: dict | None = None

    def _flush():
        nonlocal pending
        if pending is not None:
            yield pending
            pending = None

    for raw in iter_nonempty_lines(text):
        # Stack-trace block continues a pending event.
        if pending is not None:
            ms = _STACK_LEAD.match(raw)
            if ms:
                pending.setdefault("fields", {})["stack_trace"] = []
                pending["raw"] += "\n" + raw
                continue
            mf = _STACK_FRAME.match(raw)
            if mf:
                pending["fields"]["stack_trace"].append(mf.group("frame"))
                pending["raw"] += "\n" + raw
                continue

        m = _LEAD.match(raw)
        if m:
            yield from _flush()
            level_token = m.group("level")
            normalized = _normalize_php_level(level_token)
            pending = {
                "ts": parse_php_ts(m.group("ts")),
                "severity": normalize_severity(normalized),
                "channel": "php",
                "message": m.group("message").strip(),
                "raw": raw,
                "fields": {
                    "php_level": level_token.strip(),
                },
            }
            continue

        m2 = _FLAT.match(raw)
        if m2:
            yield from _flush()
            level_token = m2.group("level")
            pending = {
                "ts": None,
                "severity": normalize_severity(
                    _normalize_php_level(level_token),
                ),
                "channel": "php",
                "message": m2.group("message").strip(),
                "raw": raw,
                "fields": {
                    "php_level": level_token.strip(),
                    "no_timestamp": True,
                },
            }
            continue

        # Unparsed line — flush any pending and emit degraded.
        yield from _flush()
        yield {
            "ts": None,
            "severity": "unknown",
            "channel": None,
            "message": raw,
            "raw": raw,
            "fields": {"parse_error": "no_lead_match"},
        }

    yield from _flush()
