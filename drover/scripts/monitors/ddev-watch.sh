#!/usr/bin/env bash
# ddev-watch.sh — monitor a single DDEV project for Drupal errors.
#
# Usage: ddev-watch.sh <ddev-project-name>
#
# Tails both `ddev drush watchdog:tail` (Drupal-level) and
# `ddev logs -f --service web` (container PHP/Apache errors),
# fingerprints each line via fingerprint.py, and emits one line per
# ECA-significant event:
#   NEW     <fingerprint> <severity> <source> <project> <message>
#   THRESH  <fingerprint> count=<n> <severity> <source> <project>
#
# ECA-emit condition: new fingerprint OR occurrence count hits 50
# (Drupal's watchdog batch size).
#
# State: ${CLAUDE_PLUGIN_DATA}/ddev-state/<project>.json — persists
# across plugin versions via the persistent data dir. Created on demand.

set -uo pipefail

PROJECT="${1:-}"
if [ -z "$PROJECT" ]; then
  echo "ddev-watch: missing project name" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FINGERPRINT="${DROVER_FINGERPRINT_SCRIPT:-${SCRIPT_DIR}/../fingerprint.py}"
STATE_DIR="${DROVER_STATE_DIR:-${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugins/data/drover-fallback}/ddev-state}"
STATE_FILE="${STATE_DIR}/${PROJECT}.json"
THRESHOLD="${DROVER_THRESHOLD:-50}"

mkdir -p "$STATE_DIR"
[ -f "$STATE_FILE" ] || echo "{}" > "$STATE_FILE"

emit_and_update() {
  # stdin: one JSON object per line from fingerprint.py
  python3 -c '
import json, os, sys
state_file = os.environ["STATE_FILE"]
project = os.environ["PROJECT"]
threshold = int(os.environ["THRESHOLD"])
try:
    state = json.load(open(state_file))
except Exception:
    state = {}
for line in sys.stdin:
    try:
        ev = json.loads(line)
    except Exception:
        continue
    fp = ev["fingerprint"]
    entry = state.get(fp, {"count": 0, "severity": ev["severity"], "source": ev["source"]})
    is_new = entry["count"] == 0
    entry["count"] += 1
    state[fp] = entry
    if is_new:
        print(f"NEW {fp} {ev[\"severity\"]} {ev[\"source\"]} {project} {ev[\"message\"]}", flush=True)
    elif entry["count"] == threshold:
        print(f"THRESH {fp} count={threshold} {ev[\"severity\"]} {ev[\"source\"]} {project}", flush=True)
with open(state_file, "w") as f:
    json.dump(state, f)
'
}

export STATE_FILE PROJECT THRESHOLD

# Merge both log streams. Each stream tolerates transient failures (ddev
# restarts, drush unavailable) without killing the monitor.
{
  while true; do
    ddev --project "$PROJECT" drush watchdog:tail 2>/dev/null || true
    sleep 5
  done &
  while true; do
    ddev --project "$PROJECT" logs -f --service web 2>/dev/null || true
    sleep 5
  done &
  wait
} | python3 "$FINGERPRINT" | emit_and_update
