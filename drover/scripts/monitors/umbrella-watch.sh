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
WP_WATCH="${DROVER_WP_WATCH:-${SCRIPT_DIR}/wp-watch.py}"
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

# Registration-time DDEV reachability gate.
# Run `ddev list -A --json-output` ONCE at startup (not per-tick) to discover
# which DDEV projects are actually active. ddev:<name> watchers for stopped
# projects are silently excluded for the session — no spawn/fail/retry loop,
# no stderr flood. If the user runs `ddev start <name>` mid-session, the
# watcher won't auto-attach; they either restart the session or run a future
# /drover:refresh. Accepted tradeoff: eliminates the main spam source.
#
# Overridable via DROVER_REACHABLE_DDEV (newline-separated list) — tests
# use this to assert behavior without invoking real ddev.
REACHABLE_DDEV_FILE="$TRACK_DIR/reachable-ddev"
if [ -n "${DROVER_REACHABLE_DDEV:-}" ]; then
  printf '%s\n' "$DROVER_REACHABLE_DDEV" > "$REACHABLE_DDEV_FILE"
elif command -v ddev >/dev/null 2>&1; then
  # ddev list output can be noisy on stderr; we only care about the JSON.
  # Use python3 -c (not a heredoc) so the pipe stays wired to python's stdin —
  # a `<<'PY'` heredoc would redirect stdin to the script body and silently
  # swallow the ddev output.
  ddev list -A --json-output 2>/dev/null \
    | python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
    names = [p.get("name", "") for p in data.get("raw", []) if p.get("name")]
    open(sys.argv[1], "w").write("\n".join(names) + "\n")
except Exception:
    open(sys.argv[1], "w").write("")
' "$REACHABLE_DDEV_FILE" 2>/dev/null || : > "$REACHABLE_DDEV_FILE"
  count="$(grep -c . "$REACHABLE_DDEV_FILE" 2>/dev/null || echo 0)"
  log "reachability gate: $count active DDEV project(s)"
else
  # ddev not installed — be permissive, let child watcher report the error
  # (once, thanks to the quiet-monitor stderr routing).
  : > "$REACHABLE_DDEV_FILE"
  log "reachability gate: ddev not found on PATH; skipping filter"
fi

ddev_reachable() {
  local name="$1"
  # Empty file means "no filter applied" (ddev missing or override empty).
  [ -s "$REACHABLE_DDEV_FILE" ] || return 0
  grep -qx "$name" "$REACHABLE_DDEV_FILE"
}

# Platform dispatch. projects.json entries may carry a `platform` field
# ("drupal" | "wordpress" | …). At session start we build a sidecar
# {ddev_project_name} -> {platform} map so start_child() can route a
# ddev:* key to the correct watcher (ddev-watch.py for drupal,
# wp-watch.py for wordpress). Unknown platforms fall back to drupal
# with a log warning.
PLATFORM_MAP_FILE="$TRACK_DIR/platform-map"
if [ -f "$PROJECTS_FILE" ]; then
  python3 - "$PROJECTS_FILE" "$PLATFORM_MAP_FILE" <<'PY' 2>/dev/null || : > "$PLATFORM_MAP_FILE"
import json, sys
try:
    data = json.load(open(sys.argv[1]))
    lines = []
    for e in data:
        name = e.get("ddev_project") or e.get("name")
        if not name:
            continue
        platform = (e.get("platform") or "drupal").lower()
        lines.append(f"{name}\t{platform}")
    open(sys.argv[2], "w").write("\n".join(lines) + "\n")
except Exception:
    open(sys.argv[2], "w").write("")
PY
fi

platform_for_ddev() {
  local name="$1"
  # Default drupal when no entry found — matches legacy behavior before
  # the platform field existed.
  awk -F'\t' -v n="$name" '$1==n {print $2; exit}' "$PLATFORM_MAP_FILE" 2>/dev/null || :
}

# Resolve a ddev:<name> key to the watcher command that should handle it.
# Unknown platforms warn once and fall back to ddev-watch (drupal).
watcher_for_ddev() {
  local name="$1"
  local platform
  platform="$(platform_for_ddev "$name")"
  case "$platform" in
    ""|drupal) echo "$DDEV_WATCH" ;;
    wordpress) echo "$WP_WATCH" ;;
    *)
      # Warn once per unknown platform by using a marker file.
      local marker="$TRACK_DIR/unknown-platform.$(printf %s "$platform:$name" | shasum | awk '{print $1}' | cut -c1-12)"
      if [ ! -f "$marker" ]; then
        log "unknown platform '$platform' for ddev:$name; falling back to drupal"
        : > "$marker"
      fi
      echo "$DDEV_WATCH"
      ;;
  esac
}
BACKOFF_MAX="${DROVER_UMBRELLA_BACKOFF_MAX:-300}"
BACKOFF_MIN="${DROVER_UMBRELLA_BACKOFF_MIN:-5}"
# Envs that exit with permanent-failure status (IP allowlist, revoked creds)
# are quarantined for this long — they won't recover without human action,
# so respawning every 30s just floods notifications.
QUARANTINE_SECS="${DROVER_UMBRELLA_QUARANTINE:-3600}"
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
    ddev)     cmd="$(watcher_for_ddev "$id")" ;;
    acquia)   cmd="$ACQUIA_WATCH" ;;
    bd-ready) cmd="$BD_READY_WATCH" ;;
    *)
      log "unknown watcher kind '$kind' for '$key'"
      return
      ;;
  esac
  local pidfile
  pidfile="$(pidfile_for "$key")"
  local exitfile="${pidfile}.exit"
  rm -f "$exitfile"
  # Child stdout carries user-facing signal (NEW / THRESH / TRAFFIC events);
  # it's piped so each line is prefixed with the watcher key, then reaches
  # the harness as a task-notification. Child stderr is watcher lifecycle
  # (TRANSIENT retries, PERMANENT auth failures, init errors) — routed to
  # the umbrella log with a matching prefix so it doesn't spam the terminal
  # but is still scannable for debugging. Dashboard reads per-env status
  # from watcher state files, not from harness stream.
  (
    set -o pipefail
    "$cmd" "$id" \
      2> >(while IFS= read -r err; do
             printf '[%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$key" "$err" >> "$LOG_FILE"
           done) \
      | while IFS= read -r line; do
          printf '[%s] %s\n' "$key" "$line"
        done
    echo "${PIPESTATUS[0]}" > "$exitfile"
  ) &
  local pid=$!
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
    # Reachability gate (computed once at startup): silently skip ddev:*
    # keys for projects that are not currently active. Other watcher kinds
    # (acquia, bd-ready) are gated by their own preflight mechanisms.
    case "$key" in
      ddev:*)
        name="${key#ddev:}"
        if ! ddev_reachable "$name"; then
          # Log once per iteration is noisy; log once per session is enough.
          marker="$TRACK_DIR/skipped.$(printf %s "$key" | shasum | awk '{print $1}' | cut -c1-12)"
          if [ ! -f "$marker" ]; then
            log "skip $key (not in active DDEV set; ddev project stopped or unknown)"
            : > "$marker"
          fi
          continue
        fi
        ;;
    esac
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
        exit_code="$(cat "$pidfile.exit" 2>/dev/null || echo 0)"
        rm -f "$pidfile.exit"
        # Exit code 3 = permanent failure (forbidden_ip, invalid_grant, etc.)
        # Quarantine for QUARANTINE_SECS — these need human intervention.
        if [ "$exit_code" = "3" ]; then
          echo "$QUARANTINE_SECS" > "$backoff_file"
          echo "$(date +%s)" > "$backoff_file.until"
          log "child $key quarantined (permanent failure); backoff ${QUARANTINE_SECS}s"
          rm -f "$pidfile"
          continue
        fi
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
