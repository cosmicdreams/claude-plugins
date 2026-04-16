#!/usr/bin/env bash
# Reproduces the umbrella respawn pathology seen in real usage: when the
# child watcher exits immediately (e.g. DDEV project is down), umbrella
# detects dead pid and respawns on every poll — flooding the log.
# Target: no more than 2 respawn attempts in 10s when child keeps failing
# (i.e. backoff is in effect).
set -u
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_ROOT="$(cd "$HARNESS_DIR/../.." && pwd)"
DURATION="${S05_DURATION:-10}"

tmp="$(mktemp -d)"
log="$tmp/umbrella.log"
stdout="$tmp/umbrella.stdout"
projects="$tmp/projects.json"
data_dir="$tmp/data"
shim_dir="$tmp/shim"
mkdir -p "$data_dir" "$shim_dir"
cp "$HARNESS_DIR/shims/ddev-exit-fast" "$shim_dir/ddev"
chmod +x "$shim_dir/ddev"

cat > "$projects" <<JSON
[{"name":"harness-proj","path":"$tmp/harness-proj"}]
JSON
mkdir -p "$tmp/harness-proj/.ddev"

export DROVER_PROJECTS_FILE="$projects"
export DROVER_UMBRELLA_POLL=1
export DROVER_UMBRELLA_LOG="$log"
export DROVER_STATE_DIR="$data_dir/ddev-state"
export CLAUDE_PLUGIN_DATA="$data_dir"
export PATH="$shim_dir:$PATH"

"$PLUGIN_ROOT/scripts/monitors/umbrella-watch.sh" > "$stdout" 2>/dev/null &
pid=$!
sleep "$DURATION"
kill -TERM "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true

# Respawns for the ddev:harness-proj key specifically.
ddev_respawns=$(grep -c "starting ddev:" "$log" 2>/dev/null; true); ddev_respawns=${ddev_respawns:-0}

python3 - <<PY
import json
print(json.dumps({"metric":"respawn_flood_count","value":$ddev_respawns,"notes":"ddev child always fails; duration=${DURATION}s, poll=1s; target <=2"}))
PY

rm -rf "$tmp"
