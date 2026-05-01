"""Shared helpers for the log parsers."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional


# Drupal/syslog/PSR-3 severity levels normalized to a small set.
SEVERITY_MAP: dict[str, str] = {
    "emergency": "critical",
    "alert": "critical",
    "crit": "critical",
    "critical": "critical",
    "err": "error",
    "error": "error",
    "warn": "warning",
    "warning": "warning",
    "notice": "notice",
    "info": "info",
    "debug": "info",
    # PHP error-log severities
    "fatal": "critical",
    "parse": "critical",
    "deprecated": "info",
    "strict": "info",
    "user_error": "error",
    "user_warning": "warning",
    "user_notice": "notice",
    "user_deprecated": "info",
}

KNOWN_SEVERITIES: tuple[str, ...] = (
    "critical", "error", "warning", "notice", "info", "unknown",
)


def normalize_severity(token: str | None) -> str:
    if not token:
        return "unknown"
    t = token.strip().lower()
    return SEVERITY_MAP.get(t, "unknown")


# --- Timestamp parsing ----------------------------------------------------

_SYSLOG_MONTHS = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}


def parse_syslog_ts(
    raw: str,
    *,
    day_hint: date | None = None,
) -> Optional[datetime]:
    """Parse a syslog-style 'Mon DD HH:MM:SS' header.

    Syslog timestamps have no year, so we fall back to day_hint's year
    (typical pull case) and finally to the current UTC year.
    """
    parts = raw.split()
    if len(parts) < 3:
        return None
    mon, day, tm = parts[0], parts[1], parts[2]
    if mon not in _SYSLOG_MONTHS:
        return None
    try:
        d = int(day)
        h, m, s = tm.split(":")
        h, m, s = int(h), int(m), int(s)
    except ValueError:
        return None
    if day_hint is not None:
        year = day_hint.year
    else:
        year = datetime.now(timezone.utc).year
    try:
        return datetime(
            year, _SYSLOG_MONTHS[mon], d, h, m, s, tzinfo=timezone.utc,
        )
    except ValueError:
        return None


def parse_apache_ts(raw: str) -> Optional[datetime]:
    """Parse Apache error log timestamps like 'Tue Apr 03 00:00:33.123456 2026'."""
    # Apache 2.4 default error-log format. Drop microseconds for simplicity.
    try:
        return datetime.strptime(
            raw, "%a %b %d %H:%M:%S.%f %Y",
        ).replace(tzinfo=timezone.utc)
    except ValueError:
        try:
            return datetime.strptime(
                raw, "%a %b %d %H:%M:%S %Y",
            ).replace(tzinfo=timezone.utc)
        except ValueError:
            return None


def parse_php_ts(raw: str) -> Optional[datetime]:
    """Parse PHP error log timestamps like '03-Apr-2026 00:00:33 UTC'."""
    # Strip optional surrounding brackets
    raw = raw.strip("[]")
    # PHP's default error-log timestamp drops the timezone token sometimes.
    try:
        # With timezone (UTC, etc.)
        head, _, _tz = raw.rpartition(" ")
        return datetime.strptime(
            head, "%d-%b-%Y %H:%M:%S",
        ).replace(tzinfo=timezone.utc)
    except ValueError:
        try:
            return datetime.strptime(
                raw, "%d-%b-%Y %H:%M:%S",
            ).replace(tzinfo=timezone.utc)
        except ValueError:
            return None


# --- Line iteration -------------------------------------------------------

def iter_nonempty_lines(text: str):
    """Yield non-empty stripped-trailing-whitespace lines from text.

    Skips blank lines but preserves the original line content otherwise.
    """
    for line in text.splitlines():
        if line.strip():
            yield line
