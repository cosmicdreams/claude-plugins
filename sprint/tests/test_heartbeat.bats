#!/usr/bin/env bats

# Tests for sprint/scripts/heartbeat.sh
# Covers: start/touch/stop lifecycle, stalled detection, JSON schema validity.

setup() {
  SPRINT_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  SCRIPT="$SPRINT_ROOT/scripts/heartbeat.sh"
  TMP="$(mktemp -d)"
  export SPRINT_HEARTBEAT_DIR="$TMP/heartbeats"
}

teardown() {
  rm -rf "$TMP"
}

# --- helpers ---

_sidecar() { echo "${SPRINT_HEARTBEAT_DIR}/${1}.json"; }

_json_field() {
  python3 -c "import json,sys; d=json.load(open('${1}')); print(d.get('${2}',''))"
}

_valid_json() {
  python3 -c "import json,sys; json.load(open('${1}'))" 2>/dev/null
}

# --- start ---

@test "start: creates sidecar file" {
  run "$SCRIPT" start sprint-1 slice-1
  [ "$status" -eq 0 ]
  [ -f "$(_sidecar sprint-1)" ]
}

@test "start: sidecar has required JSON fields" {
  "$SCRIPT" start sprint-1 slice-1 analyze
  local path
  path="$(_sidecar sprint-1)"
  _valid_json "$path"
  [ "$(_json_field "$path" card_id)" = "sprint-1" ]
  [ "$(_json_field "$path" agent)" = "slice-1" ]
  [ "$(_json_field "$path" phase)" = "analyze" ]
  [ -n "$(_json_field "$path" started_at)" ]
  [ -n "$(_json_field "$path" last_touch)" ]
  [ "$(_json_field "$path" started_epoch)" -gt 0 ]
  [ "$(_json_field "$path" last_touch_epoch)" -gt 0 ]
}

@test "start: phase defaults to empty string when omitted" {
  "$SCRIPT" start sprint-2 slice-2
  local path
  path="$(_sidecar sprint-2)"
  [ "$(_json_field "$path" phase)" = "" ]
}

@test "start: creates heartbeat directory if absent" {
  [ ! -d "$SPRINT_HEARTBEAT_DIR" ]
  "$SCRIPT" start sprint-3 slice-3
  [ -d "$SPRINT_HEARTBEAT_DIR" ]
}

# --- touch ---

@test "touch: updates last_touch_epoch" {
  "$SCRIPT" start sprint-4 slice-1 analyze
  local path
  path="$(_sidecar sprint-4)"
  local before
  before="$(_json_field "$path" last_touch_epoch)"
  sleep 1
  "$SCRIPT" touch sprint-4
  local after
  after="$(_json_field "$path" last_touch_epoch)"
  [ "$after" -gt "$before" ]
}

@test "touch: preserves started_at and agent" {
  "$SCRIPT" start sprint-5 slice-1 analyze
  local path
  path="$(_sidecar sprint-5)"
  local orig_started orig_agent
  orig_started="$(_json_field "$path" started_at)"
  orig_agent="$(_json_field "$path" agent)"
  "$SCRIPT" touch sprint-5 implement
  [ "$(_json_field "$path" started_at)" = "$orig_started" ]
  [ "$(_json_field "$path" agent)" = "$orig_agent" ]
}

@test "touch: updates phase when provided" {
  "$SCRIPT" start sprint-6 slice-1 analyze
  "$SCRIPT" touch sprint-6 implement
  [ "$(_json_field "$(_sidecar sprint-6)" phase)" = "implement" ]
}

@test "touch: retains existing phase when not provided" {
  "$SCRIPT" start sprint-7 slice-1 analyze
  "$SCRIPT" touch sprint-7
  [ "$(_json_field "$(_sidecar sprint-7)" phase)" = "analyze" ]
}

@test "touch: succeeds silently when no sidecar exists" {
  run "$SCRIPT" touch nonexistent-card
  [ "$status" -eq 0 ]
}

# --- stop ---

@test "stop: removes sidecar file" {
  "$SCRIPT" start sprint-8 slice-1
  "$SCRIPT" stop sprint-8
  [ ! -f "$(_sidecar sprint-8)" ]
}

@test "stop: succeeds when sidecar does not exist" {
  run "$SCRIPT" stop nonexistent-card
  [ "$status" -eq 0 ]
}

# --- stalled ---

@test "stalled: no output when directory absent" {
  run "$SCRIPT" stalled --max-age-sec 5
  [ "$status" -eq 0 ]
  [[ "$output" == *"no sidecar directory"* ]]
}

@test "stalled: does not flag fresh sidecar" {
  "$SCRIPT" start sprint-9 slice-1
  run "$SCRIPT" stalled --max-age-sec 600
  [ "$status" -eq 0 ]
  [[ "$output" != *"STALLED"* ]]
}

@test "stalled: flags sidecar older than threshold" {
  "$SCRIPT" start sprint-10 slice-1 analyze
  local path
  path="$(_sidecar sprint-10)"
  # Back-date last_touch_epoch by 700 seconds.
  local old_epoch
  old_epoch=$(( $(date -u +%s) - 700 ))
  python3 - "${path}" "${old_epoch}" <<'PYEOF'
import json, sys
path, epoch = sys.argv[1], int(sys.argv[2])
d = json.load(open(path))
d['last_touch_epoch'] = epoch
json.dump(d, open(path, 'w'), indent=2)
PYEOF
  run "$SCRIPT" stalled --max-age-sec 600
  [ "$status" -eq 0 ]
  [[ "$output" == *"STALLED"* ]]
  [[ "$output" == *"sprint-10"* ]]
  [[ "$output" == *"slice-1"* ]]
}

@test "stalled: default threshold is 600s" {
  "$SCRIPT" start sprint-11 slice-1
  local path
  path="$(_sidecar sprint-11)"
  # Back-date by 601s — should appear with default threshold.
  local old_epoch
  old_epoch=$(( $(date -u +%s) - 601 ))
  python3 - "${path}" "${old_epoch}" <<'PYEOF'
import json, sys
path, epoch = sys.argv[1], int(sys.argv[2])
d = json.load(open(path))
d['last_touch_epoch'] = epoch
json.dump(d, open(path, 'w'), indent=2)
PYEOF
  run "$SCRIPT" stalled
  [ "$status" -eq 0 ]
  [[ "$output" == *"STALLED"* ]]
}

@test "stalled: only flags sidecars past threshold, not fresh ones" {
  "$SCRIPT" start sprint-12a slice-1 analyze   # fresh
  "$SCRIPT" start sprint-12b slice-2 implement # will be stalled

  local stale_path
  stale_path="$(_sidecar sprint-12b)"
  local old_epoch
  old_epoch=$(( $(date -u +%s) - 700 ))
  python3 - "${stale_path}" "${old_epoch}" <<'PYEOF'
import json, sys
path, epoch = sys.argv[1], int(sys.argv[2])
d = json.load(open(path))
d['last_touch_epoch'] = epoch
json.dump(d, open(path, 'w'), indent=2)
PYEOF

  run "$SCRIPT" stalled --max-age-sec 600
  [ "$status" -eq 0 ]
  [[ "$output" == *"sprint-12b"* ]]
  [[ "$output" != *"sprint-12a"* ]]
}

# --- JSON schema validity (roundtrip) ---

@test "start+touch produces valid JSON throughout" {
  "$SCRIPT" start sprint-13 slice-1 analyze
  _valid_json "$(_sidecar sprint-13)"
  "$SCRIPT" touch sprint-13 implement
  _valid_json "$(_sidecar sprint-13)"
}
