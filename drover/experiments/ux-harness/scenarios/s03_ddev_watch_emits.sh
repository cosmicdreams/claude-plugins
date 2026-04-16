#!/usr/bin/env bash
# Run ddev-watch.py against the 50-line 3-error fixture via the ddev shim.
# Measure: number of NEW emits, time-to-first-emit (ms).
set -u
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_ROOT="$(cd "$HARNESS_DIR/../.." && pwd)"

tmp="$(mktemp -d)"
state="$tmp/state"; mkdir -p "$state"

export DROVER_HARNESS_WATCHDOG_FIXTURE="$HARNESS_DIR/fixtures/watchdog-3errors-50lines.txt"
export DROVER_HARNESS_WEBLOG_FIXTURE=/dev/null
export DROVER_HARNESS_SHIM_LINGER=1
export DROVER_STATE_DIR="$state"
export DROVER_MAX_EVENTS=60
export DROVER_THRESHOLD=50
export PATH="$HARNESS_DIR/shims:$PATH"

out="$tmp/out"
# Prefix each line with ms-since-start.
start_ms=$(python3 -c "import time; print(int(time.time()*1000))")
python3 "$PLUGIN_ROOT/scripts/monitors/ddev-watch.py" harness-proj 2>/dev/null \
  | while IFS= read -r line; do
      now_ms=$(python3 -c "import time; print(int(time.time()*1000))")
      echo "$((now_ms - start_ms)) $line" >> "$out"
    done &
pid=$!
# Shim has a 1s linger, then exits. ddev-watch exits when both pipes close.
wait "$pid" 2>/dev/null || true

new_count=$(grep -c " NEW " "$out" 2>/dev/null; true); new_count=${new_count:-0}
thresh_count=$(grep -c " THRESH " "$out" 2>/dev/null; true); thresh_count=${thresh_count:-0}
first_ms=$(awk '/ NEW /{print $1; exit}' "$out" 2>/dev/null); first_ms=${first_ms:--1}

python3 - <<PY
import json
print(json.dumps({"metric":"new_emits_per_fixture","value":$new_count,"notes":"50-line 3-error fixture; target 3"}))
print(json.dumps({"metric":"thresh_emits_per_fixture","value":$thresh_count,"notes":"threshold=50; target 0 (fixture hits 25 for top error)"}))
print(json.dumps({"metric":"time_to_first_emit_ms","value":$first_ms,"notes":"ms from ddev-watch start to first NEW"}))
PY

rm -rf "$tmp"
