"""Parser for Apache 2.4 error log lines.

Default Apache error-log format on most Acquia/Drupal hosts:

  [Tue Apr 03 00:00:33.123456 2026] [php:error] [pid 12345] [client 1.2.3.4]
      PHP Fatal error: <message>

Two relevant flavors mix here:
  - Genuine Apache/server errors (segfault, child process died)
  - PHP fatals/warnings that bubble up through the SAPI

Both are valuable. The parser tags `is_php_error` in fields when the
module/category is `php:*` (or the message starts with "PHP "),
letting downstream code distinguish.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Iterator

from .common import (
    iter_nonempty_lines, normalize_severity, parse_apache_ts,
)


# [Tue Apr 03 00:00:33.123456 2026] [php:error] [pid 12345] [client 1.2.3.4]
# message...
# Each [...] block is an attribute. We capture:
#   1: timestamp inside the first [...]
#   2: module:level inside [..]
#   3..N: optional remaining [...] (we only sniff `pid`, `client`)
#   message: everything after the final ]
_LEAD = re.compile(
    r"^\[(?P<ts>[^\]]+)\]"
    r"\s+\[(?P<modlevel>[^\]]+)\]"
    r"(?P<rest>(?:\s+\[[^\]]*\])*)"
    r"\s*(?P<message>.*)$"
)
_BRACKET_TOK = re.compile(r"\[([^\]]+)\]")


def _split_modlevel(modlevel: str) -> tuple[str | None, str]:
    """Split 'php:error' into ('php', 'error'); returns (None, level) for
    bare levels."""
    if ":" in modlevel:
        mod, _, level = modlevel.partition(":")
        return mod.strip(), level.strip()
    return None, modlevel.strip()


def _parse_rest(rest: str) -> dict:
    """Extract well-known optional attributes (pid, client) from the
    middle bracketed tokens."""
    out: dict[str, str] = {}
    for match in _BRACKET_TOK.finditer(rest or ""):
        tok = match.group(1).strip()
        if tok.startswith("pid "):
            out["pid"] = tok[4:].strip()
        elif tok.startswith("client "):
            out["client"] = tok[7:].strip()
        elif tok.startswith("remote "):
            out["client"] = tok[7:].strip()
    return out


def parse(text: str, *, day_hint: date | None = None) -> Iterator[dict]:
    for raw in iter_nonempty_lines(text):
        m = _LEAD.match(raw)
        if not m:
            yield {
                "ts": None,
                "severity": "unknown",
                "channel": None,
                "message": raw,
                "raw": raw,
                "fields": {"parse_error": "no_lead_match"},
            }
            continue

        ts = parse_apache_ts(m.group("ts"))
        module, level = _split_modlevel(m.group("modlevel"))
        attrs = _parse_rest(m.group("rest") or "")
        message = m.group("message").strip()

        is_php = bool(
            (module and module.lower().startswith("php"))
            or message.lower().startswith("php ")
        )

        yield {
            "ts": ts,
            "severity": normalize_severity(level),
            "channel": module,
            "message": message,
            "raw": raw,
            "fields": {
                "module": module,
                "level": level,
                "is_php_error": is_php,
                **attrs,
            },
        }
