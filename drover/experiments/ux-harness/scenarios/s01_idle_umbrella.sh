#!/usr/bin/env bash
# Run umbrella-watch with one dormant registered project for N seconds;
# count stdout lines (should be 0) and count "starting" entries in the
# umbrella log (should be 1: start once, stay up).
set -u
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_ROOT="$(cd "$HARNESS_DIR/../.." && pwd)"
DURATION="${S01_DURATION:-10}"

tmp="$(mktemp -d)"
log="$tmp/umbrella.log"
stdout="$tmp/umbrella.stdout"
projects="$tmp/projects.json"
data_dir="$tmp/data"
mkdir -p "$data_dir"

# Register one project pointing at a fake DDEV project that the shim
# answers for.
cat > "$projects" <<JSON
[{"name":"harness-proj","path":"$tmp/harness-proj"}]
JSON
mkdir -p "$tmp/harness-proj/.ddev"

# Empty fixture → no error lines from the watcher.
export DROVER_HARNESS_WATCHDOG_FIXTURE=/dev/null
export DROVER_HARNESS_WEBLOG_FIXTURE=/dev/null
export DROVER_HARNESS_SHIM_LINGER=99
export DROVER_PROJECTS_FILE="$projects"
export DROVER_UMBRELLA_POLL=2
export DROVER_UMBRELLA_LOG="$log"
export DROVER_STATE_DIR="$data_dir/ddev-state"
export CLAUDE_PLUGIN_DATA="$data_dir"
export PATH="$HARNESS_DIR/shims:$PATH"

"$PLUGIN_ROOT/scripts/monitors/umbrella-watch.sh" > "$stdout" 2>/dev/null &
pid=$!
sleep "$DURATION"
kill -TERM "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true

stdout_lines=$(awk 'END{print NR}' "$stdout")
starting_lines=$(grep -c "starting " "$log" 2>/dev/null; true)
starting_lines=${starting_lines:-0}
unique_keys=$(grep -oE "starting [^ ]+" "$log" 2>/dev/null | sort -u | awk 'END{print NR}')
# Respawn = starting events minus unique children (each child should start exactly once).
respawns=$((starting_lines - unique_keys))
[ "$respawns" -lt 0 ] && respawns=0

python3 - <<PY
import json
print(json.dumps({"metric":"idle_stdout_lines","value":$stdout_lines,"notes":"duration=${DURATION}s, 1 project registered"}))
print(json.dumps({"metric":"umbrella_unique_children","value":$unique_keys,"notes":"distinct child keys spawned (ddev + bd-ready = 2 per project)"}))
print(json.dumps({"metric":"umbrella_child_respawns","value":$respawns,"notes":"starting events beyond first per child; target 0"}))
PY

rm -rf "$tmp"
