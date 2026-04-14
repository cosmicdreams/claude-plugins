#!/usr/bin/env bash
# umbrella-watch.sh — one monitor entry that tails every registered
# drover project. Polls projects.json on an interval; starts a child
# watcher for new keys, kills children for removed ones.
#
# Each wanted key has a prefix selecting the watcher:
#   ddev:<project-name>    — scripts/monitors/ddev-watch.py
#   acquia:<env-id>        — scripts/monitors/acquia-watch.py
#
# Users can add or remove projects (via add-project.sh or the
# dashboard) without /reload-plugins.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DDEV_WATCH="${DROVER_DDEV_WATCH:-${SCRIPT_DIR}/ddev-watch.py}"
ACQUIA_WATCH="${DROVER_ACQUIA_WATCH:-${SCRIPT_DIR}/acquia-watch.py}"
PROJECTS_FILE="${DROVER_PROJECTS_FILE:-${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugins/data/drover-fallback}/projects.json}"
POLL_INTERVAL="${DROVER_UMBRELLA_POLL:-30}"
MAX_ITERATIONS="${DROVER_UMBRELLA_MAX_ITERATIONS:-0}"

TRACK_DIR="$(mktemp -d -t drover-umbrella.XXXXXX)"

# Map a "kind:id" key to a filesystem-safe pidfile name.
pidfile_for() {
  local key="$1"
  local safe="${key//:/__}"
  echo "$TRACK_DIR/$safe.pid"
}

# Reverse pidfile_for: derive key from a pidfile path.
key_for_pidfile() {
  local f="$1"
  local base
  base="$(basename "$f" .pid)"
  echo "${base/__/:}"
}

list_projects() {
  [ -f "$PROJECTS_FILE" ] || return 0
  python3 - "$PROJECTS_FILE" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1]))
    for e in data:
        name = e.get("name") or e.get("ddev_project")
        if name:
            print(f"ddev:{name}")
        for env in (e.get("acquia") or {}).get("environments", []) or []:
            # Prefer alias ("site.env" — works with acli), fall back to id or raw string.
            if isinstance(env, dict):
                key = env.get("alias") or env.get("id")
            else:
                key = env
            if key:
                print(f"acquia:{key}")
except Exception:
    pass
PY
}

start_child() {
  local key="$1"
  local kind="${key%%:*}"
  local id="${key#*:}"
  local cmd
  case "$kind" in
    ddev)   cmd="$DDEV_WATCH" ;;
    acquia) cmd="$ACQUIA_WATCH" ;;
    *)
      echo "umbrella: unknown watcher kind '$kind' for '$key'"
      return
      ;;
  esac
  (
    "$cmd" "$id" 2>&1 | while IFS= read -r line; do
      printf '[%s] %s\n' "$key" "$line"
    done
  ) &
  echo "$!" > "$(pidfile_for "$key")"
  echo "umbrella: starting $key"
}

stop_child() {
  local key="$1"
  local pidfile
  pidfile="$(pidfile_for "$key")"
  [ -f "$pidfile" ] || return 0
  local pid
  pid="$(cat "$pidfile")"
  kill "$pid" 2>/dev/null || true
  rm -f "$pidfile"
  echo "umbrella: stopping $key"
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
    stop_child "$(key_for_pidfile "$f")"
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

  while IFS= read -r key; do
    [ -z "$key" ] && continue
    pidfile="$(pidfile_for "$key")"
    if ! child_alive "$pidfile"; then
      [ -f "$pidfile" ] && rm -f "$pidfile"
      start_child "$key"
    fi
  done < "$wanted_file"

  for pidfile in "$TRACK_DIR"/*.pid; do
    [ -e "$pidfile" ] || continue
    key="$(key_for_pidfile "$pidfile")"
    if ! grep -qxF "$key" "$wanted_file"; then
      stop_child "$key"
    fi
  done

  rm -f "$wanted_file"

  if [ "$MAX_ITERATIONS" -gt 0 ] && [ "$iteration" -ge "$MAX_ITERATIONS" ]; then
    cleanup
  fi

  sleep "$POLL_INTERVAL"
done
