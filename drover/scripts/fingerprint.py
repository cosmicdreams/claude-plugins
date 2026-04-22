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

# Apache-specific ephemeral tokens. Acquia apache error lines look like:
#   [Tue Apr 22 10:30:15.123 2026] [proxy_fcgi:error] [pid 12345]
#     1.2.3.4 "<referer>" "<user-agent-or-@@seq>" vhost=<host>
#     forwarded_for="ip, ip, ip" request_id="v-<reqid>"
#     hosting_site=<slug> ahNNN
# Stable signal: severity (from the `[module:error]` bracket), the `ahNNN`
# Apache status code when present, and the broad message shape after
# ephemera are scrubbed. Everything else (quoted referer, quoted UA,
# vhost, forwarded_for, request_id, stand-alone IPs, `@@xxxx` per-request
# sequence tokens, hosting_site slug) is per-request ephemera and MUST
# NOT influence the fingerprint — otherwise every apache line becomes its
# own "unique" fingerprint and the dashboard degenerates into a 50-row
# wall of singletons (see T4 of the Friday demo).
# Matches Apache's bracketed severity / module tag. Accepts both the Acquia
# simple form (`[error]`, `[warn]`, `[notice]`) and the multi-module form
# (`[proxy_fcgi:error]`, `[php:warn]`, ...).
APACHE_MODULE_TAG_RE = re.compile(
    r"\[(?:[a-z_]+:)?(?:error|warn|warning|notice|info|debug|crit|alert|emerg)\]",
    re.I,
)
APACHE_QUOTED_RE = re.compile(r'"[^"]*"')
APACHE_KV_DROP_RE = re.compile(
    r"\b(?:vhost|forwarded_for|request_id|client|referer|user_agent|hosting_site)=\S+",
    re.I,
)
APACHE_AT_SEQ_RE = re.compile(r"@@[A-Za-z0-9]+")
APACHE_STATUS_CODE_RE = re.compile(r"\b(ah\d{3,5})\b", re.I)

# Apache combined log format: ip - - [timestamp] "METHOD /path HTTP/x.x" status size ...
ACCESS_LOG_RE = re.compile(
    r'^\d{1,3}(?:\.\d{1,3}){3}\s+\S+\s+\S+\s+\[.+?\]\s+"(?:GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)\s+\S+\s+HTTP/\d',
    re.I,
)

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
    # Skip HTTP access-log lines — error-like words in URLs are not errors.
    if ACCESS_LOG_RE.match(line):
        return None
    lower = line.lower()
    for needle, sev in SEVERITY_MAP:
        if needle in lower:
            return sev
    return None


def source_of(line: str) -> str:
    lo = line.lower()
    if "drush" in lo or " | php " in line or " | cron " in line:
        return "watchdog"
    if "[php:" in lo or "php fatal" in lo or "php warning" in lo:
        return "php"
    if "[error]" in lo or "[:error]" in lo or "apache:" in lo:
        return "apache"
    # Acquia apache error log: `[<mod>:error]` tag plus a vhost= / hosting_site=
    # / forwarded_for= kv-pair is a strong apache-error signature.
    if APACHE_MODULE_TAG_RE.search(line) and (
        "vhost=" in lo or "hosting_site=" in lo or "forwarded_for=" in lo
    ):
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


def _normalize_apache(line: str) -> str:
    """Build a stable canonical form for an Acquia apache error line.

    When a line carries an Apache status code (`ahNNNN`, e.g. AH01276),
    the canonical key is ONLY `apache:<ahcode>`. That collapses the 600+
    variants of "AH01276: Cannot serve directory /some/varying/path/" — all
    genuinely the same error class — into a single fingerprint with a
    real occurrence count, which is the whole point of T4.

    When no AH code is present, we scrub per-request ephemera (quoted
    referer / UA strings, `@@seq` tokens, vhost/forwarded_for/request_id/
    client/hosting_site kv-pairs, IPs, timestamps, request-id UUIDs) and
    hash the remaining prose. Path tails are reduced to their parent
    directory so `cannot serve directory /var/www/html/foo/` and
    `cannot serve directory /var/www/html/bar/` collapse to the same key.
    """
    s = line
    # If an AH status code exists, that's the whole fingerprint. Every
    # message body with the same AH code is the same error class.
    m = APACHE_STATUS_CODE_RE.search(s)
    if m:
        return f"apache:{m.group(1).lower()}"
    # Otherwise, scrub aggressively and hash the residual shape.
    s = APACHE_QUOTED_RE.sub('""', s)
    s = APACHE_KV_DROP_RE.sub("", s)
    s = APACHE_AT_SEQ_RE.sub("", s)
    s = REQUEST_ID_RE.sub("", s)
    s = IP_RE.sub("", s)
    s = TIMESTAMP_RE.sub("", s)
    s = PID_RE.sub("", s)
    # Collapse long directory paths to a single `PATH` token so per-request
    # path variance (`/var/.../themes/custom/foo/` vs `.../bar/`) doesn't
    # create false-positive fingerprints.
    s = re.sub(r"/[^\s]{2,}", "PATH", s)
    s = NUM_RE.sub("", s)
    s = WS_RE.sub(" ", s).strip().lower()
    return f"apache:{s}"


def _is_apache_line(line: str) -> bool:
    """Detect Apache error-log shape. Accepts either the raw Acquia shape
    (has a `[module:error]` or `[module:warn]` tag plus a vhost=/hosting_site=
    kv-pair) or the drover-internal `[SEV] apache:` rendering.
    """
    lo = line.lower()
    if "apache:" in lo:
        return True
    if APACHE_MODULE_TAG_RE.search(line) and (
        "vhost=" in lo or "hosting_site=" in lo or "forwarded_for=" in lo
    ):
        return True
    return False


def fingerprint(line: str) -> str:
    if _is_apache_line(line):
        key = _normalize_apache(line)
    else:
        key = normalize(line)
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]


def fingerprint_structured(
    source: str,
    message: str,
    *,
    level: str | None = None,
    file: str | None = None,
    type_: str | None = None,
) -> str:
    """Fingerprint a pre-parsed log record.

    Used by drover:triage when fields are already split out (the
    streaming process() is for raw lines). Produces the same sha256[:12]
    hash space so triage-created tickets and monitor-created state share
    a single namespace.

    Source-specific key shape:
      watchdog -> "watchdog:{type}:{normalized[:120]}"
      php      -> "php:{level}:{normalized[:120]}:{module_relative_file}"
      nginx    -> "nginx:{level}:{normalized[:120]}"
      apache   -> "apache:{level}:{normalized[:120]}"
      other    -> "{source}:{normalized[:120]}"
    """
    norm = normalize(message)[:120]
    src = (source or "other").lower()

    if src == "watchdog":
        key = f"watchdog:{type_ or ''}:{norm}"
    elif src == "php":
        rel = _module_relative(file or "")
        key = f"php:{level or ''}:{norm}:{rel}"
    elif src in ("nginx", "apache"):
        stripped = re.sub(r"\[client [^\]]+\]", "", message)
        stripped = re.sub(r"\bclient: \S+", "", stripped)
        stripped = re.sub(r"\bpid \d+\b", "", stripped, flags=re.I)
        stripped = re.sub(r"\bAH\d+:\s*", "", stripped)
        key = f"{src}:{level or ''}:{normalize(stripped)[:120]}"
    else:
        key = f"{src}:{norm}"

    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]


def _module_relative(path: str) -> str:
    if not path:
        return ""
    m = re.search(r"(modules/|core/).*$", path)
    rel = m.group(0) if m else path
    return re.sub(r":\d+$", "", rel)


# Noise patterns for sprint-etd. When the umbrella spawns a watcher with
# DROVER_NOISE_FILTER=1 (derived from `noise_filter: true` in projects.json
# combined with `trust_level: low`), the watcher calls is_noise() on each
# raw line before fingerprinting. Matches are silently dropped — they never
# reach the NEW/THRESH emission path and therefore never become task
# notifications in the Claude Code harness.
#
# Patterns mirror the Drupal ones documented in triage-procedure.md Step 3,
# plus WordPress analogs for the Kellogg demo target. Keep this list tight —
# it's a hard silencer, not a ranking signal.
_NOISE_PATTERNS: list[re.Pattern] = [
    # Missing public-file 404s (Drupal + WordPress)
    re.compile(r"(GuzzleHttp|file_get_contents).*(sites/default/files|wp-content/uploads)", re.I),
    # Dev-environment cache-backend connection failures. Only the classic
    # trio of cache backends — random "Connection refused" elsewhere is a
    # real error that should pass through.
    re.compile(r"(memcache|redis|solr).*(connection refused|econnrefused|connect failed)", re.I),
    # Drupal core notices (not custom module code).
    re.compile(r"\bnotice[:\s].*core/lib/Drupal/", re.I),
]


def is_noise(line: str) -> bool:
    """Return True if the line matches a known noise pattern that low-trust
    DDEV environments should silence. See _NOISE_PATTERNS for the ruleset.

    Callers decide WHEN to apply this (watchers only consult it when the
    umbrella sets DROVER_NOISE_FILTER=1). Fingerprint.py itself has no
    knowledge of trust_level or per-project config — that gating lives at
    the umbrella/watcher boundary.
    """
    for pat in _NOISE_PATTERNS:
        if pat.search(line):
            return True
    return False


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
    try:
        for raw in sys.stdin:
            result = process(raw)
            if result is not None:
                print(json.dumps(result), flush=True)
    except BrokenPipeError:
        # Downstream consumer exited; silently stop.
        try:
            sys.stdout.close()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
