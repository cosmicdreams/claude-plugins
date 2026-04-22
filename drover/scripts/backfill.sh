#!/usr/bin/env bash
# backfill.sh <env-alias> [<log-types>]
#
# Pulls historical Acquia logs for one environment and feeds them
# through the shared fingerprint pipeline, updating the same state
# file that live monitoring writes (acquia-state/<alias>.json).
#
# Use after a monitor outage, for post-mortem analysis, or for a
# fresh environment that has never been streamed.
#
# Idempotent: fingerprint counts are incremented in the state file
# but the emission logic (NEW/THRESH) matches live behavior — a
# fingerprint already seen in live monitoring won't re-emit NEW.
#
# Arguments:
#   env-alias  e.g. "pncb.prod"
#   log-types  comma-separated, default "php-error,apache-error"
#              options: php-error, apache-error, drupal-watchdog
#
# Environment:
#   DROVER_ACLI, DROVER_STATE_DIR, DROVER_THRESHOLD,
#   DROVER_FINGERPRINT_SCRIPT, DROVER_DOWNLOAD_SCRIPT — test overrides
#   DROVER_JSONL_OUT — if set, append one JSON object per fingerprinted
#                     event to that file (with timestamp when available).
#                     Lets downstream tools (e.g. acquia-baseline.sh)
#                     reuse the same pipeline without re-parsing logs.
#
# Emits one line to stdout per ECA event, same format as live monitoring:
#   NEW     <fp> <severity> <source> <env> <message>
#   THRESH  <fp> count=<n>  <severity> <source> <env>
# Followed by a summary line:
#   BACKFILL done env=<env> types=<types> events=<n>

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALIAS="${1:-}"
TYPES="${2:-php-error,apache-error}"

if [ -z "$ALIAS" ]; then
  echo "Usage: backfill.sh <env-alias> [<log-types>]" >&2
  exit 2
fi

DOWNLOADER="${DROVER_DOWNLOAD_SCRIPT:-${SCRIPT_DIR}/acquia-download.sh}"
FINGERPRINT="${DROVER_FINGERPRINT_SCRIPT:-${SCRIPT_DIR}/fingerprint.py}"
THRESHOLD="${DROVER_THRESHOLD:-50}"
STATE_DIR="${DROVER_STATE_DIR:-${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugins/data/drover-fallback}/acquia-state}"
STATE_FILE="${STATE_DIR}/${ALIAS}.json"
PROJECTS_FILE="${DROVER_PROJECTS_FILE:-${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugins/data/drover-fallback}/projects.json}"
mkdir -p "$STATE_DIR"

# Resolve the user-facing alias (e.g. "pncb.prod") into the
# (app_uuid, env_name) pair that acquia-download.sh expects. The
# downloader switched to the 3-arg signature (app_uuid, env_name, log_type)
# in drover 1.11.0 when acli was dropped for direct Acquia API calls —
# backfill.sh was still passing (alias, log_type) which the downloader
# silently rejected. End result: the dashboard Backfill button reported
# "0 events" with no obvious error.
RESOLVED="$(ALIAS="$ALIAS" PROJECTS_FILE="$PROJECTS_FILE" python3 <<'PY'
import json, os, sys
alias = os.environ["ALIAS"]
path = os.environ["PROJECTS_FILE"]
try:
    data = json.load(open(path))
except Exception:
    sys.exit(0)
for entry in data:
    for env in (entry.get("acquia") or {}).get("environments", []) or []:
        if not isinstance(env, dict):
            continue
        if env.get("alias") == alias:
            app_uuid = env.get("app_uuid") or (entry.get("acquia") or {}).get("app_uuid", "")
            env_name = env.get("env") or env.get("name") or ""
            if app_uuid and env_name:
                print(f"{app_uuid}\t{env_name}")
                sys.exit(0)
PY
)"

APP_UUID="$(printf '%s' "$RESOLVED" | cut -f1)"
ENV_NAME="$(printf '%s' "$RESOLVED" | cut -f2)"

if [ -z "$APP_UUID" ] || [ -z "$ENV_NAME" ]; then
  echo "ERROR: could not resolve alias '$ALIAS' to (app_uuid, env_name) via $PROJECTS_FILE" >&2
  echo "       Re-run /drover:add-project for this project to populate the env config," >&2
  echo "       or set DROVER_PROJECTS_FILE to the correct path." >&2
  exit 3
fi

TMP_LOG="$(mktemp -t drover-backfill-XXXXXX)"
trap 'rm -f "$TMP_LOG"' EXIT

IFS=',' read -ra TYPE_ARR <<< "$TYPES"
for t in "${TYPE_ARR[@]}"; do
  t="$(echo "$t" | tr -d '[:space:]')"
  [ -z "$t" ] && continue
  "$DOWNLOADER" "$APP_UUID" "$ENV_NAME" "$t" >> "$TMP_LOG" 2>/dev/null || \
    echo "WARN: failed to download $t for $ALIAS" >&2
done

ALIAS="$ALIAS" TYPES="$TYPES" THRESHOLD="$THRESHOLD" STATE_FILE="$STATE_FILE" \
  FINGERPRINT="$FINGERPRINT" TMP_LOG="$TMP_LOG" \
  DROVER_JSONL_OUT="${DROVER_JSONL_OUT:-}" \
python3 <<'PY'
import importlib.util, json, os, pathlib, re

alias = os.environ["ALIAS"]
threshold = int(os.environ["THRESHOLD"])
state_file = pathlib.Path(os.environ["STATE_FILE"])
fp_script = os.environ["FINGERPRINT"]
tmp_log = os.environ["TMP_LOG"]
jsonl_out = os.environ.get("DROVER_JSONL_OUT") or ""

spec = importlib.util.spec_from_file_location("fingerprint", fp_script)
fp_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fp_mod)

try:
    state = json.loads(state_file.read_text()) if state_file.exists() else {}
except Exception:
    state = {}

jsonl_fh = open(jsonl_out, "a") if jsonl_out else None

# Rough timestamp extractor — matches common Acquia formats.
TS_RE = re.compile(
    r"\[(\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}:\d{2})"  # PHP error log
    r"|\[([A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2}[^\]]*\d{4})"  # Apache
)

def extract_ts(line):
    m = TS_RE.search(line)
    if not m:
        return None
    return m.group(1) or m.group(2)

processed = 0
try:
    # Acquia log archives are gzip-compressed; detect and decompress.
    import gzip as _gzip
    def _open_log(path):
        with open(path, "rb") as h:
            magic = h.read(2)
        if magic == b"\x1f\x8b":
            return _gzip.open(path, "rt", encoding="utf-8", errors="replace")
        return open(path, encoding="utf-8", errors="replace")
    with _open_log(tmp_log) as f:
        for line in f:
            ev = fp_mod.process(line)
            if ev is None:
                continue
            fp = ev["fingerprint"]
            sev = ev["severity"]
            src = ev["source"]
            msg = ev["message"]
            entry = state.get(fp, {"count": 0, "severity": sev, "source": src})
            is_new = entry["count"] == 0
            entry["count"] += 1
            state[fp] = entry
            if is_new:
                print(f"NEW {fp} {sev} {src} {alias} {msg}", flush=True)
            elif entry["count"] == threshold:
                print(f"THRESH {fp} count={threshold} {sev} {src} {alias}", flush=True)
            if jsonl_fh:
                rec = dict(ev)
                rec["env"] = alias
                ts = extract_ts(line)
                if ts:
                    rec["ts"] = ts
                jsonl_fh.write(json.dumps(rec) + "\n")
            processed += 1
finally:
    try:
        state_file.write_text(json.dumps(state))
    except Exception:
        pass
    if jsonl_fh:
        jsonl_fh.close()

print(f"BACKFILL done env={alias} types={os.environ.get('TYPES','')} events={processed}", flush=True)
PY
