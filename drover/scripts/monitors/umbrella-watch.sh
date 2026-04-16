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
BD_READY_WATCH="${DROVER_BD_READY_WATCH:-${SCRIPT_DIR}/bd-ready-watch.py}"
PROJECTS_FILE="${DROVER_PROJECTS_FILE:-${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugins/data/drover-fallback}/projects.json}"
POLL_INTERVAL="${DROVER_UMBRELLA_POLL:-30}"
MAX_ITERATIONS="${DROVER_UMBRELLA_MAX_ITERATIONS:-0}"

LOG_FILE="${DROVER_UMBRELLA_LOG:-${HOME}/.claude/drover.umbrella.log}"

# Lifecycle messages go to a log file, not stdout. The Claude Code harness
# treats every stdout line from a Monitor as a user-facing notification, so
# stdout is reserved for actual signal (child-watcher error lines).
log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG_FILE" 2>/dev/null || true; }

# Gate: if projects.json is missing or holds an empty list, exit quietly.
# The harness re-registers the monitor on next session; once a project is
# added, the next session will pick it up.
if [ ! -f "$PROJECTS_FILE" ] || ! python3 -c "
import json, sys
try:
    d = json.load(open('$PROJECTS_FILE'))
    sys.exit(0 if isinstance(d, list) and d else 1)
except Exception:
    sys.exit(1)
"; then
  log "no projects registered; exiting"
  exit 0
fi

TRACK_DIR="$(mktemp -d -t drover-umbrella.XXXXXX)"
BACKOFF_DIR="$TRACK_DIR/backoff"
mkdir -p "$BACKOFF_DIR"
BACKOFF_MAX="${DROVER_UMBRELLA_BACKOFF_MAX:-300}"
BACKOFF_MIN="${DROVER_UMBRELLA_BACKOFF_MIN:-5}"
# A child that exits within this many seconds of start counts as "flapping".
FLAP_WINDOW="${DROVER_UMBRELLA_FLAP_WINDOW:-10}"

# Hash keys for pidfile names (keys may contain slashes for paths).
# Pidfile format: line 1 is the original key, line 2 is the pid.
pidfile_for() {
  local key="$1"
  local hash
  hash="$(printf %s "$key" | shasum | awk '{print $1}' | cut -c1-12)"
  echo "$TRACK_DIR/$hash.pid"
}

# Reverse pidfile_for: read the original key from the pidfile.
key_for_pidfile() {
  local f="$1"
  head -1 "$f" 2>/dev/null
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
        app_uuid = (e.get("acquia") or {}).get("app_uuid", "")
        for env in (e.get("acquia") or {}).get("environments", []) or []:
            if isinstance(env, dict):
                env_name = env.get("name") or env.get("env_slug", "")
                eid = env.get("alias") or env.get("id", "")
            else:
                env_name = env
                eid = env
            if app_uuid and env_name:
                print(f"acquia:{env_name}.{app_uuid}")
            elif eid:
                print(f"acquia:{eid}")
        # bd-ready watcher polls the project's local Beads board for
        # newly-ready tickets. One watcher per project path.
        path = e.get("path")
        if path:
            print(f"bd-ready:{path}")
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
    ddev)     cmd="$DDEV_WATCH" ;;
    acquia)   cmd="$ACQUIA_WATCH" ;;
    bd-ready) cmd="$BD_READY_WATCH" ;;
    *)
      log "unknown watcher kind '$kind' for '$key'"
      return
      ;;
  esac
  (
    "$cmd" "$id" 2>&1 | while IFS= read -r line; do
      printf '[%s] %s\n' "$key" "$line"
    done
  ) &
  local pid=$!
  local pidfile
  pidfile="$(pidfile_for "$key")"
  # Pidfile format: line 1 = key, line 2 = pid, line 3 = start epoch.
  printf '%s\n%s\n%s\n' "$key" "$pid" "$(date +%s)" > "$pidfile"
  log "starting $key"
}

pid_of_pidfile() {
  sed -n '2p' "$1" 2>/dev/null
}

stop_child() {
  local key="$1"
  local pidfile
  pidfile="$(pidfile_for "$key")"
  [ -f "$pidfile" ] || return 0
  local pid
  pid="$(pid_of_pidfile "$pidfile")"
  [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  rm -f "$pidfile"
  log "stopping $key"
}

child_alive() {
  local pidfile="$1"
  [ -f "$pidfile" ] || return 1
  local pid
  pid="$(pid_of_pidfile "$pidfile")"
  [ -z "$pid" ] && return 1
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
      # If the pidfile exists (child died this iteration), check lifespan.
      # Short-lived child ⇒ flapping ⇒ grow per-key backoff.
      hash="$(printf %s "$key" | shasum | awk '{print $1}' | cut -c1-12)"
      backoff_file="$BACKOFF_DIR/$hash.next"
      if [ -f "$pidfile" ]; then
        start_epoch="$(sed -n '3p' "$pidfile" 2>/dev/null || echo 0)"
        now="$(date +%s)"
        lived=$((now - start_epoch))
        if [ "$lived" -lt "$FLAP_WINDOW" ]; then
          prev="$(cat "$backoff_file" 2>/dev/null || echo 0)"
          next=$(( prev * 2 ))
          [ "$next" -lt "$BACKOFF_MIN" ] && next="$BACKOFF_MIN"
          [ "$next" -gt "$BACKOFF_MAX" ] && next="$BACKOFF_MAX"
          echo "$next" > "$backoff_file"
          echo "$(date +%s)" > "$backoff_file.until"
          log "child $key flapped (lived ${lived}s); backoff ${next}s"
        else
          # Healthy run; reset backoff.
          rm -f "$backoff_file" "$backoff_file.until" 2>/dev/null || true
        fi
        rm -f "$pidfile"
      fi
      # Respect backoff deadline.
      until_file="$backoff_file.until"
      if [ -f "$until_file" ] && [ -f "$backoff_file" ]; then
        last="$(cat "$until_file" 2>/dev/null || echo 0)"
        delay="$(cat "$backoff_file" 2>/dev/null || echo 0)"
        now="$(date +%s)"
        if [ "$((now - last))" -lt "$delay" ]; then
          continue
        fi
      fi
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
