#!/usr/bin/env bash
# heartbeat.sh — Observer heartbeat sidecars for sprint agents.
#
# Sidecars live at: ~/.claude/plugins/data/sprint/heartbeats/<card-id>.json
# They are project-local, disposable, and never touch the Beads schema.
#
# Usage:
#   heartbeat.sh start  <card-id> <agent-name> [phase]
#   heartbeat.sh touch  <card-id> [phase]
#   heartbeat.sh stop   <card-id>
#   heartbeat.sh stalled [--max-age-sec N]   (default: 600)

set -euo pipefail

HEARTBEAT_DIR="${SPRINT_HEARTBEAT_DIR:-${HOME}/.claude/plugins/data/sprint/heartbeats}"

_now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
_now_epoch() { date -u +%s; }

_sidecar_path() {
  local card_id="$1"
  echo "${HEARTBEAT_DIR}/${card_id}.json"
}

cmd_start() {
  local card_id="${1:?card-id required}"
  local agent="${2:?agent-name required}"
  local phase="${3:-}"

  mkdir -p "${HEARTBEAT_DIR}"
  local path
  path="$(_sidecar_path "${card_id}")"
  local now_iso now_epoch
  now_iso="$(_now_iso)"
  now_epoch="$(_now_epoch)"

  printf '{\n  "card_id": "%s",\n  "agent": "%s",\n  "started_at": "%s",\n  "started_epoch": %d,\n  "last_touch": "%s",\n  "last_touch_epoch": %d,\n  "phase": "%s"\n}\n' \
    "${card_id}" "${agent}" "${now_iso}" "${now_epoch}" "${now_iso}" "${now_epoch}" "${phase}" \
    > "${path}"

  echo "heartbeat: started ${card_id} (agent=${agent}, phase=${phase:-unset})"
}

cmd_touch() {
  local card_id="${1:?card-id required}"
  local phase="${2:-}"

  local path
  path="$(_sidecar_path "${card_id}")"

  if [[ ! -f "${path}" ]]; then
    echo "heartbeat: no sidecar for ${card_id} — skipping touch" >&2
    return 0
  fi

  local now_iso now_epoch
  now_iso="$(_now_iso)"
  now_epoch="$(_now_epoch)"

  # Read existing fields we want to preserve.
  local existing_card existing_agent existing_started existing_started_epoch existing_phase
  existing_card="$(python3 -c "import json,sys; d=json.load(open('${path}')); print(d.get('card_id',''))")"
  existing_agent="$(python3 -c "import json,sys; d=json.load(open('${path}')); print(d.get('agent',''))")"
  existing_started="$(python3 -c "import json,sys; d=json.load(open('${path}')); print(d.get('started_at',''))")"
  existing_started_epoch="$(python3 -c "import json,sys; d=json.load(open('${path}')); print(d.get('started_epoch',0))")"
  existing_phase="$(python3 -c "import json,sys; d=json.load(open('${path}')); print(d.get('phase',''))")"

  local effective_phase="${phase:-${existing_phase}}"

  printf '{\n  "card_id": "%s",\n  "agent": "%s",\n  "started_at": "%s",\n  "started_epoch": %s,\n  "last_touch": "%s",\n  "last_touch_epoch": %d,\n  "phase": "%s"\n}\n' \
    "${existing_card}" "${existing_agent}" "${existing_started}" "${existing_started_epoch}" \
    "${now_iso}" "${now_epoch}" "${effective_phase}" \
    > "${path}"

  echo "heartbeat: touched ${card_id} (phase=${effective_phase:-unset})"
}

cmd_stop() {
  local card_id="${1:?card-id required}"
  local path
  path="$(_sidecar_path "${card_id}")"

  if [[ -f "${path}" ]]; then
    rm -f "${path}"
    echo "heartbeat: stopped ${card_id}"
  else
    echo "heartbeat: no sidecar for ${card_id} — nothing to stop"
  fi
}

cmd_stalled() {
  local max_age_sec=600
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --max-age-sec) max_age_sec="${2:?value required}"; shift 2 ;;
      *) echo "stalled: unknown option $1" >&2; exit 1 ;;
    esac
  done

  if [[ ! -d "${HEARTBEAT_DIR}" ]]; then
    echo "heartbeat: no sidecar directory — no agents tracked"
    return 0
  fi

  local now_epoch stalled_count
  now_epoch="$(_now_epoch)"
  stalled_count=0

  for path in "${HEARTBEAT_DIR}"/*.json; do
    [[ -e "${path}" ]] || continue

    local last_touch_epoch card_id agent phase last_touch
    last_touch_epoch="$(python3 -c "import json; d=json.load(open('${path}')); print(d.get('last_touch_epoch',0))")"
    card_id="$(python3 -c "import json; d=json.load(open('${path}')); print(d.get('card_id','?'))")"
    agent="$(python3 -c "import json; d=json.load(open('${path}')); print(d.get('agent','?'))")"
    phase="$(python3 -c "import json; d=json.load(open('${path}')); print(d.get('phase',''))")"
    last_touch="$(python3 -c "import json; d=json.load(open('${path}')); print(d.get('last_touch','?'))")"

    local age=$(( now_epoch - last_touch_epoch ))
    if [[ "${age}" -ge "${max_age_sec}" ]]; then
      stalled_count=$(( stalled_count + 1 ))
      printf "STALLED card=%-20s agent=%-20s phase=%-15s last_touch=%s age=%ds\n" \
        "${card_id}" "${agent}" "${phase:-unset}" "${last_touch}" "${age}"
    fi
  done

  if [[ "${stalled_count}" -eq 0 ]]; then
    echo "heartbeat: no stalled agents (threshold=${max_age_sec}s)"
  fi
}

# --- dispatch ---

subcommand="${1:-}"
shift || true

case "${subcommand}" in
  start)   cmd_start "$@" ;;
  touch)   cmd_touch "$@" ;;
  stop)    cmd_stop "$@" ;;
  stalled) cmd_stalled "$@" ;;
  *)
    cat >&2 <<'USAGE'
Usage:
  heartbeat.sh start  <card-id> <agent-name> [phase]
  heartbeat.sh touch  <card-id> [phase]
  heartbeat.sh stop   <card-id>
  heartbeat.sh stalled [--max-age-sec N]
USAGE
    exit 1
    ;;
esac
