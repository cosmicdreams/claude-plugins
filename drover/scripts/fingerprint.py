#!/usr/bin/env python3
"""
Fingerprint a log line into a stable hash identifying the error class.

Reads log lines from stdin. For each line that matches an error shape,
emits one JSON object per line on stdout:
  {"fingerprint": "<12-char hash>", "severity": "error|warning|notice",
   "source": "<source>", "message": "<normalized>"}
Non-error lines produce no output.

Fingerprint rules (aligned with drover triage fingerprint-rules.md intent):
- Strip timestamps, request IDs, memory addresses, file paths beyond the
  last two segments, line numbers, and IP addresses.
- Lowercase, collapse whitespace.
- sha256 the remainder, take first 12 hex chars.

Two input shapes recognized:
- Drupal watchdog (drush watchdog:tail):
    "Sun, 2026/04/14 - 14:55  | php   | %type: @message in %function ..."
- Apache / PHP error log (ddev logs --service web):
    "[Sun Apr 14 14:55:00.123 2026] [php:error] [pid 123] Uncaught ..."
    "PHP Fatal error:  Uncaught ..."
"""
import hashlib
import json
import re
import sys

TIMESTAMP_RE = re.compile(
    r"\[[^\]]*\]|"                      # bracketed timestamps / tokens
    r"\b\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b|"
    r"\b\w{3}, \d{4}/\d{2}/\d{2} - \d{2}:\d{2}\b"
)
HEX_ADDR_RE = re.compile(r"0x[0-9a-fA-F]+")
NUM_RE = re.compile(r"\b\d+\b")
IP_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
PID_RE = re.compile(r"\bpid \d+\b", re.I)
REQUEST_ID_RE = re.compile(r"\b[0-9a-f]{8,}-[0-9a-f-]{8,}\b")
PATH_TAIL_RE = re.compile(r"(?:/[^\s/]+){3,}/([^\s/]+/[^\s/]+)")
WS_RE = re.compile(r"\s+")

ERROR_KEYWORDS = re.compile(
    r"\b(fatal|uncaught|exception|error|warning|notice|deprecated|emergency|alert|critical)\b",
    re.I,
)
SEVERITY_MAP = [
    ("emergency", "emergency"),
    ("alert", "alert"),
    ("critical", "critical"),
    ("fatal", "error"),
    ("uncaught", "error"),
    ("error", "error"),
    ("warning", "warning"),
    ("notice", "notice"),
    ("deprecated", "notice"),
]


def classify(line: str) -> str | None:
    lower = line.lower()
    for needle, sev in SEVERITY_MAP:
        if needle in lower:
            return sev
    return None


def source_of(line: str) -> str:
    if "drush" in line.lower() or " | php " in line or " | cron " in line:
        return "watchdog"
    if "[php:" in line.lower() or "php fatal" in line.lower() or "php warning" in line.lower():
        return "php"
    if "[error]" in line.lower() or "[:error]" in line.lower():
        return "apache"
    return "other"


def normalize(line: str) -> str:
    s = line
    s = REQUEST_ID_RE.sub("REQID", s)
    s = TIMESTAMP_RE.sub("TS", s)
    s = IP_RE.sub("IP", s)
    s = PID_RE.sub("pid", s)
    s = HEX_ADDR_RE.sub("ADDR", s)
    s = PATH_TAIL_RE.sub(r"PATH/\1", s)
    s = NUM_RE.sub("N", s)
    s = WS_RE.sub(" ", s).strip().lower()
    return s


def fingerprint(line: str) -> str:
    return hashlib.sha256(normalize(line).encode("utf-8")).hexdigest()[:12]


def process(line: str) -> dict | None:
    line = line.rstrip("\n")
    if not line:
        return None
    severity = classify(line)
    if not severity:
        return None
    return {
        "fingerprint": fingerprint(line),
        "severity": severity,
        "source": source_of(line),
        "message": normalize(line)[:200],
    }


def main() -> int:
    for raw in sys.stdin:
        result = process(raw)
        if result is not None:
            print(json.dumps(result), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
