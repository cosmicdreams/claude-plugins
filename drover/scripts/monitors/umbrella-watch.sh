#!/usr/bin/env bash
# umbrella-watch.sh — one monitor entry that tails every registered
# drover project. Polls projects.json on an interval; starts a child
# ddev-watch.sh for new projects, kills children for removed ones.
#
# Users can add or remove projects (via add-project.sh or the
# dashboard) without /reload-plugins.
#
# Every child line is re-emitted on umbrella stdout prefixed with the
# project name so a chat notification identifies the source.
#
# Child tracking: one file per project in $TRACK_DIR containing the
# child PID. No associative arrays required — works under bash 3.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DDEV_WATCH="${DROVER_DDEV_WATCH:-${SCRIPT_DIR}/ddev-watch.py}"
PROJECTS_FILE="${DROVER_PROJECTS_FILE:-${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugins/data/drover-fallback}/projects.json}"
POLL_INTERVAL="${DROVER_UMBRELLA_POLL:-30}"
MAX_ITERATIONS="${DROVER_UMBRELLA_MAX_ITERATIONS:-0}"  # 0 = forever; tests set a small number

TRACK_DIR="$(mktemp -d -t drover-umbrella.XXXXXX)"

list_projects() {
  [ -f "$PROJECTS_FILE" ] || return 0
  python3 - "$PROJECTS_FILE" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
    for e in data:
        name = e.get("name") or e.get("ddev_project")
        if name:
            print(name)
except Exception:
    pass
PY
}

start_child() {
  local name="$1"
  (
    "$DDEV_WATCH" "$name" 2>&1 | while IFS= read -r line; do
      printf '[%s] %s\n' "$name" "$line"
    done
  ) &
  echo "$!" > "$TRACK_DIR/$name.pid"
  echo "umbrella: starting $name"
}

stop_child() {
  local name="$1"
  local pidfile="$TRACK_DIR/$name.pid"
  [ -f "$pidfile" ] || return 0
  local pid
  pid="$(cat "$pidfile")"
  kill "$pid" 2>/dev/null || true
  rm -f "$pidfile"
  echo "umbrella: stopping $name"
}

child_alive() {
  local pidfile="$1"
  [ -f "$pidfile" ] || return 1
  local pid
  pid="$(cat "$pidfile")"
  kill -0 "$pid" 2>/dev/null
}

cleanup() {
  for f in "$TRACK_DIR"/*.pid; do
    [ -e "$f" ] || continue
    local name
    name="$(basename "$f" .pid)"
    stop_child "$name"
  done
  rm -rf "$TRACK_DIR"
  exit 0
}
trap cleanup INT TERM

iteration=0
while :; do
  iteration=$((iteration + 1))

  wanted_file="$(mktemp -t drover-umbrella-wanted.XXXXXX)"
  list_projects > "$wanted_file"

  # Start children for newly-wanted projects.
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    if ! child_alive "$TRACK_DIR/$name.pid"; then
      [ -f "$TRACK_DIR/$name.pid" ] && rm -f "$TRACK_DIR/$name.pid"
      start_child "$name"
    fi
  done < "$wanted_file"

  # Stop children for projects no longer listed.
  for pidfile in "$TRACK_DIR"/*.pid; do
    [ -e "$pidfile" ] || continue
    name="$(basename "$pidfile" .pid)"
    if ! grep -qxF "$name" "$wanted_file"; then
      stop_child "$name"
    fi
  done

  rm -f "$wanted_file"

  if [ "$MAX_ITERATIONS" -gt 0 ] && [ "$iteration" -ge "$MAX_ITERATIONS" ]; then
    cleanup
  fi

  sleep "$POLL_INTERVAL"
done
