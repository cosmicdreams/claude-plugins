"""Shared helpers for the log parsers."""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
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

    Syslog timestamps have no year. We pick the year that puts the parsed
    date closest to day_hint, which matters at the December/January
    boundary: a "Dec 31 23:59:59" line inside the 2026-01-01 file belongs
    to 2025-12-31, not 2026-12-31. Falls back to the current UTC year when
    no hint is available.
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
    if day_hint is None:
        candidates = [datetime.now(timezone.utc).year]
    else:
        # Prefer day_hint's year, but allow the adjacent years so a
        # month-boundary spill lands nearest the day we asked for.
        candidates = [day_hint.year, day_hint.year - 1, day_hint.year + 1]

    best: Optional[datetime] = None
    best_distance: Optional[int] = None
    for year in candidates:
        try:
            dt = datetime(
                year, _SYSLOG_MONTHS[mon], d, h, m, s, tzinfo=timezone.utc,
            )
        except ValueError:
            continue  # e.g. Feb 29 in a non-leap candidate year
        if day_hint is None:
            return dt
        distance = abs((dt.date() - day_hint).days)
        if best_distance is None or distance < best_distance:
            best, best_distance = dt, distance
    return best


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


_NUMERIC_OFFSET_RE = re.compile(r"^([+-])(\d{2}):?(\d{2})$")


def _tzinfo_for(token: str) -> timezone:
    """Resolve a PHP error-log timezone token to a tzinfo.

    Discarding a numeric offset and stamping UTC moves boundary events
    across day and month lines: "31-Mar-2026 23:30:00 -0500" is actually
    2026-04-01T04:30Z and belongs in April's report, not March's.
    Named zones other than UTC are left as UTC — PHP writes whatever
    date.timezone says, and drover has no zone database dependency.
    """
    token = (token or "").strip()
    m = _NUMERIC_OFFSET_RE.match(token)
    if m:
        sign = 1 if m.group(1) == "+" else -1
        delta = timedelta(hours=int(m.group(2)), minutes=int(m.group(3)))
        return timezone(sign * delta)
    return timezone.utc


def parse_php_ts(raw: str) -> Optional[datetime]:
    """Parse PHP error log timestamps like '03-Apr-2026 00:00:33 UTC'."""
    # Strip optional surrounding brackets
    raw = raw.strip("[]")
    # PHP's default error-log timestamp drops the timezone token sometimes.
    try:
        # With timezone (UTC, America/New_York, +0000, -0500, ...)
        head, _, tz_token = raw.rpartition(" ")
        parsed = datetime.strptime(head, "%d-%b-%Y %H:%M:%S")
        # Normalize to UTC so month/day bucketing downstream is uniform.
        return parsed.replace(tzinfo=_tzinfo_for(tz_token)).astimezone(
            timezone.utc
        )
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
