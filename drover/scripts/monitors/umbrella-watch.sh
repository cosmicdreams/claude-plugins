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
BUDGET_FILTER="${DROVER_BUDGET_FILTER:-${SCRIPT_DIR}/budget_filter.py}"
PROJECTS_FILE="${DROVER_PROJECTS_FILE:-${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugins/data/drover-fallback}/projects.json}"
POLL_INTERVAL="${DROVER_UMBRELLA_POLL:-30}"
MAX_ITERATIONS="${DROVER_UMBRELLA_MAX_ITERATIONS:-0}"

LOG_FILE="${DROVER_UMBRELLA_LOG:-${HOME}/.claude/drover.umbrella.log}"

# sprint-89h: route all umbrella stdout through a rolling-window budget
# filter so a deploy burst of 20 unique errors cannot produce 20
# per-event harness notifications in under a minute. NEW events exceeding
# DROVER_NOTIFY_MAX (default 10) per DROVER_NOTIFY_WINDOW seconds
# (default 300) are dropped; a summary line ("N NEW events suppressed")
# is emitted every DROVER_NOTIFY_SUMMARY_EVERY drops (default 5).
# Setting DROVER_NOTIFY_DISABLE=1 bypasses the filter (tests use this).
if [ -z "${DROVER_NOTIFY_DISABLE:-}" ] && [ -f "$BUDGET_FILTER" ]; then
  exec > >(python3 "$BUDGET_FILTER")
fi

# Lifecycle messages go to a log file, not stdout. The Claude Code harness
# treats every stdout line from a Monitor as a user-facing notification, so
# stdout is reserved for actual signal (child-watcher error lines).
log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG_FILE" 2>/dev/null || true; }

# Gate: if projects.json is missing or holds an empty list, exit quietly.
# The harness re-registers the monitor on next session; once a project is
# added, the next session will pick it up.
if [ ! -f "$PROJECTS_FILE" ] || ! python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    sys.exit(0 if isinstance(d, list) and d else 1)
except Exception:
    sys.exit(1)
' "$PROJECTS_FILE"; then
  log "no projects registered; exiting"
  exit 0
fi

# T3: TRACK_DIR is overridable via DROVER_UMBRELLA_TRACK_DIR so the
# dashboard can locate per-key pidfiles and signal a surgical child
# restart when Stream-tab subscriptions change. Falls back to mktemp
# for standalone umbrella runs (no dashboard).
if [ -n "${DROVER_UMBRELLA_TRACK_DIR:-}" ]; then
  TRACK_DIR="$DROVER_UMBRELLA_TRACK_DIR"
  mkdir -p "$TRACK_DIR"
else
  TRACK_DIR="$(mktemp -d -t drover-umbrella.XXXXXX)"
fi
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

# Registration-time Acquia reachability gate.
# Collect unique app_uuids from projects.json and check which ones have
# usable creds. Done ONCE at startup (not per-tick). If the probe fails
# permanently (revoked creds, IP not allowlisted, invalid_id) the app's
# acquia:* keys are silently excluded for the session — no spawn/fail/
# retry loop, no stderr flood.
#
# Override: DROVER_REACHABLE_ACQUIA_APPS=uuid1,uuid2 or newline-separated.
# A single space/empty-ish override means "gate is active, no apps match"
# — used by tests to exercise the deny path.
REACHABLE_ACQUIA_FILE="$TRACK_DIR/reachable-acquia"
if [ -n "${DROVER_REACHABLE_ACQUIA_APPS+set}" ]; then
  # Env var is set (including empty/space) — honor as-is, no probe.
  printf '%s' "$DROVER_REACHABLE_ACQUIA_APPS" | tr ', ' '\n' | sed '/^$/d' > "$REACHABLE_ACQUIA_FILE"
  log "acquia gate: explicit override — $(grep -c . "$REACHABLE_ACQUIA_FILE" 2>/dev/null || echo 0) app(s) reachable"
elif [ -f "$PROJECTS_FILE" ]; then
  # Derive unique app_uuids from projects.json and probe each via the
  # acquia_api python module. Apps with successful probes write their
  # uuid to the reachable file; permanent failures are skipped.
  python3 - "$PROJECTS_FILE" "$REACHABLE_ACQUIA_FILE" "$SCRIPT_DIR" <<'PY' 2>>"$LOG_FILE" || : > "$REACHABLE_ACQUIA_FILE"
import json, os, sys

projects_file, reachable_file, script_dir = sys.argv[1:4]

# Collect unique app_uuids.
app_uuids: set[str] = set()
try:
    for e in json.load(open(projects_file)):
        ac = e.get("acquia") or {}
        parent = ac.get("app_uuid", "")
        for env in ac.get("environments") or []:
            if isinstance(env, dict):
                uid = env.get("app_uuid") or parent
                if uid:
                    app_uuids.add(uid)
except Exception:
    pass

if not app_uuids:
    open(reachable_file, "w").write("")
    sys.exit(0)

# Try to import acquia_api. If unavailable (dev environment missing deps)
# be permissive — let each watcher probe independently.
sys.path.insert(0, script_dir)
try:
    import acquia_api as aa
except Exception as e:
    print(f"acquia gate: acquia_api unavailable ({e}); skipping gate", file=sys.stderr)
    open(reachable_file, "w").write("")
    sys.exit(0)

try:
    client = aa.AcquiaClient()
except Exception as e:
    # Creds file missing / malformed — all apps unreachable.
    print(f"acquia gate: no credentials ({e}); all Acquia envs excluded", file=sys.stderr)
    open(reachable_file, "w").write("")
    sys.exit(0)

reachable = []
for uid in sorted(app_uuids):
    try:
        # list_environments is the cheapest probe that exercises both auth
        # and the specific app_uuid (would-be invalid_id surfaces here).
        client.list_environments(uid)
        reachable.append(uid)
    except Exception as e:
        slug = getattr(e, "error_slug", "")
        status = getattr(e, "status", "?")
        print(f"acquia gate: app {uid} unreachable status={status} slug={slug}", file=sys.stderr)

open(reachable_file, "w").write("\n".join(reachable) + ("\n" if reachable else ""))
PY
  count="$(grep -c . "$REACHABLE_ACQUIA_FILE" 2>/dev/null || echo 0)"
  log "acquia gate: $count app(s) reachable"
else
  : > "$REACHABLE_ACQUIA_FILE"
fi

acquia_reachable() {
  # Input: "env.app_uuid" (the id portion of an acquia:<id> key).
  local id="$1"
  # If the override was never set AND no file exists, gate is inactive
  # (permissive fallback).
  [ -f "$REACHABLE_ACQUIA_FILE" ] || return 0
  # If the override WAS set but resolved to empty, all apps are unreachable.
  if [ ! -s "$REACHABLE_ACQUIA_FILE" ] && [ -n "${DROVER_REACHABLE_ACQUIA_APPS+set}" ]; then
    return 1
  fi
  # No file content but also no explicit override = permissive (acquia_api
  # probe was skipped because no uuids or deps missing).
  [ -s "$REACHABLE_ACQUIA_FILE" ] || return 0
  # Extract app_uuid portion (everything after the first dot).
  local app_uuid="${id#*.}"
  grep -qx "$app_uuid" "$REACHABLE_ACQUIA_FILE"
}

# Platform dispatch. projects.json entries may carry a `platform` field
# ("drupal" | "wordpress" | …). At session start we build a sidecar
# {ddev_project_name} -> {platform} map so start_child() can route a
# ddev:* key to the correct watcher (ddev-watch.py for drupal,
# wp-watch.py for wordpress). Unknown platforms fall back to drupal
# with a log warning.
PLATFORM_MAP_FILE="$TRACK_DIR/platform-map"
NOISE_FILTER_MAP_FILE="$TRACK_DIR/noise-filter-map"
if [ -f "$PROJECTS_FILE" ]; then
  python3 - "$PROJECTS_FILE" "$PLATFORM_MAP_FILE" "$NOISE_FILTER_MAP_FILE" <<'PY' 2>/dev/null || { : > "$PLATFORM_MAP_FILE"; : > "$NOISE_FILTER_MAP_FILE"; }
import json, sys
platforms = []
noise = []
try:
    data = json.load(open(sys.argv[1]))
    for e in data:
        name = e.get("ddev_project") or e.get("name")
        if not name:
            continue
        platform = (e.get("platform") or "drupal").lower()
        platforms.append(f"{name}\t{platform}")
        # Noise filter applies to the project's local DDEV env when
        # trust_level=low AND noise_filter=true. Signal comes from the
        # per-project drover-config.json written by /drover:setup.
        cfg_path = f"{e.get('path', '')}/.claude/drover-config.json"
        try:
            cfg = json.load(open(cfg_path))
            for env in cfg.get("environments", []):
                if env.get("type") == "ddev" and \
                   env.get("trust_level", "low") == "low" and \
                   env.get("noise_filter", False):
                    noise.append(name)
                    break
        except Exception:
            pass
    open(sys.argv[2], "w").write("\n".join(platforms) + "\n")
    open(sys.argv[3], "w").write("\n".join(noise) + "\n")
except Exception:
    open(sys.argv[2], "w").write("")
    open(sys.argv[3], "w").write("")
PY
fi

noise_filter_for_ddev() {
  local name="$1"
  # Override path for tests: DROVER_NOISE_FILTER_DDEV=name1,name2
  if [ -n "${DROVER_NOISE_FILTER_DDEV:-}" ]; then
    printf '%s\n' "${DROVER_NOISE_FILTER_DDEV//,/$'\n'}" | grep -qx "$name"
    return $?
  fi
  [ -s "$NOISE_FILTER_MAP_FILE" ] || return 1
  grep -qx "$name" "$NOISE_FILTER_MAP_FILE"
}

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
import json, os, sys
# The per-project drover-config.json is the source of truth for WHICH envs
# drover should tail. projects.json only says the project exists and lists
# every possible env from the Acquia application — it does NOT mean the
# user wants each one streamed. An env with sources=[] (the safe default
# since 1.29.1) is explicitly paused and must not be emitted as a spawn
# key. Prior behavior spawned children for every projects.json env, which
# silently bypassed the user's own config.
def find_drover_config(project_path):
    if not project_path:
        return None
    cur = project_path
    for _ in range(5):
        p = os.path.join(cur, ".claude", "drover-config.json")
        if os.path.isfile(p):
            try: return json.load(open(p))
            except Exception: return None
        parent = os.path.dirname(cur)
        if parent == cur: break
        cur = parent
    return None

def env_has_sources(cfg, predicate):
    """Return True if the config has any env matching predicate with a
    non-empty sources list. predicate(e) -> bool."""
    if not cfg: return False
    for e in cfg.get("environments", []) or []:
        if predicate(e):
            srcs = e.get("sources") or []
            return bool(srcs)
    return False

try:
    data = json.load(open(sys.argv[1]))
    for e in data:
        name = e.get("name") or e.get("ddev_project")
        project_path = e.get("path", "")
        cfg = find_drover_config(project_path)

        # Gate ddev:<name> by the project's local ddev env having sources.
        ddev_project = e.get("ddev_project") or name
        if name and env_has_sources(cfg, lambda x: x.get("type") == "ddev"
                                     and (x.get("ddev_project") == ddev_project
                                          or x.get("name") == "local")):
            print(f"ddev:{name}")

        # Gate each acquia:<env>.<uuid> by that specific env having sources.
        parent_app_uuid = (e.get("acquia") or {}).get("app_uuid", "")
        for env in (e.get("acquia") or {}).get("environments", []) or []:
            if isinstance(env, dict):
                env_name = env.get("env") or env.get("name") or env.get("env_slug", "")
                app_uuid = env.get("app_uuid") or parent_app_uuid
                eid = env.get("alias") or env.get("id", "")
            else:
                env_name = env
                app_uuid = parent_app_uuid
                eid = env

            def match_acquia(x, _env=env_name):
                if x.get("type") != "acquia": return False
                return (x.get("env_slug") == _env
                        or x.get("name") == _env
                        or x.get("env") == _env)
            if not env_has_sources(cfg, match_acquia):
                # Paused or unconfigured remote env — do not spawn a watcher.
                continue

            if app_uuid and env_name:
                print(f"acquia:{env_name}.{app_uuid}")
            elif eid:
                print(f"acquia:{eid}")

        # bd-ready always runs per project (local Beads board poller); it
        # is not a log streamer and is not gated by sources.
        if project_path:
            print(f"bd-ready:{project_path}")
except Exception:
    pass
PY
}

start_child() {
  local key="$1"
  local kind="${key%%:*}"
  local id="${key#*:}"
  local cmd
  local noise_env=""
  case "$kind" in
    ddev)
      cmd="$(watcher_for_ddev "$id")"
      if noise_filter_for_ddev "$id"; then
        noise_env="DROVER_NOISE_FILTER=1"
      fi
      ;;
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
  # T3: per-key log-type override. When Stream-tab toggles write
  # ${TRACK_DIR}/sources/<hash>.types with a comma-separated list, the
  # child watcher starts with that DROVER_LOG_TYPES so Acquia's WSS
  # connection only subscribes to enabled sources. Missing file = inherit
  # the umbrella-level DROVER_LOG_TYPES (legacy behaviour).
  local key_hash
  key_hash="$(printf %s "$key" | shasum | awk '{print $1}' | cut -c1-12)"
  local types_file="$TRACK_DIR/sources/$key_hash.types"
  local types_override=""
  if [ -f "$types_file" ]; then
    types_override="$(head -1 "$types_file" 2>/dev/null)"
  fi
  (
    set -o pipefail
    if [ -n "$noise_env" ]; then
      export DROVER_NOISE_FILTER=1
    fi
    if [ -n "$types_override" ]; then
      export DROVER_LOG_TYPES="$types_override"
    fi
    # Per-line passthrough for traffic logs so the dashboard pulse feed
    # sees every apache-request / fpm-access event in real time instead
    # of a once-per-1000 aggregate. Harmless when no traffic log is in
    # the subscription (acquia-watch only honors this in TRAFFIC_TYPES
    # branches).
    export DROVER_TRAFFIC_PASSTHRU=1
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
  if [ -n "$types_override" ]; then
    log "starting $key (subscribe sources=[$types_override])"
  else
    log "starting $key (subscribe sources=[all-detected])"
  fi
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
  log "stopping $key (unsubscribe)"
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
      acquia:*)
        id="${key#acquia:}"
        if ! acquia_reachable "$id"; then
          marker="$TRACK_DIR/skipped.$(printf %s "$key" | shasum | awk '{print $1}' | cut -c1-12)"
          if [ ! -f "$marker" ]; then
            log "skip $key (app creds unreachable; re-run /drover:setup to fix)"
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
