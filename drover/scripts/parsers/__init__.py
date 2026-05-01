"""drover.parsers — deterministic parsers for Drupal/Acquia application logs.

Each parser exposes:

  parse(text: str, *, day_hint: date | None = None) -> Iterator[dict]

Yielding events of shape:

  {
    "ts":       datetime | None,    # parsed timestamp; None if unrecoverable
    "severity": str,                # critical|error|warning|notice|info|unknown
    "channel":  str | None,         # parser-specific category
    "message":  str,                # human-readable message text (no fields)
    "raw":      str,                # original line, exactly as on disk
    "fields":   dict,               # parser-specific extras (ip, uid, etc.)
  }

Three parsers ship in 2.0:

  apache-error      [parsers.apache_error]
  drupal-watchdog   [parsers.drupal_watchdog]
  php-error         [parsers.php_error]

Selection happens via parser_for(log_type) below. Slice 5 keeps the
parsers stand-alone; slice 6 (aggregation) and 8 (report) wrap them.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Callable, Iterator

from . import apache_error, drupal_watchdog, php_error


PARSERS: dict[str, Callable[..., Iterator[dict]]] = {
    "apache-error": apache_error.parse,
    "drupal-watchdog": drupal_watchdog.parse,
    "php-error": php_error.parse,
}


def parser_for(log_type: str) -> Callable[..., Iterator[dict]]:
    """Return the parser callable for `log_type`, or raise."""
    try:
        return PARSERS[log_type]
    except KeyError:
        raise ValueError(
            f"no parser for log_type={log_type!r}. "
            f"Known: {sorted(PARSERS)}"
        ) from None


def parse_file(
    path: Path | str,
    log_type: str,
    *,
    day_hint: date | None = None,
) -> Iterator[dict]:
    """Open a log file and yield parsed events. The day_hint helps
    parsers fill in years for syslog-style timestamps that omit them."""
    fn = parser_for(log_type)
    with open(path, "r", errors="replace") as fh:
        text = fh.read()
    yield from fn(text, day_hint=day_hint)
