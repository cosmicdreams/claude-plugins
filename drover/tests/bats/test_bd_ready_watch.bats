#!/usr/bin/env bats

# Tests for scripts/monitors/bd-ready-watch.py. Stubs `bd` via DROVER_BD.

setup() {
  DROVER_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$DROVER_ROOT/scripts/monitors/bd-ready-watch.py"
  TMP="$(mktemp -d)"
  PROJ="$TMP/myproj"
  mkdir -p "$PROJ/.beads"
  # bd requires the db to exist — the watcher checks db_path.exists().
  : > "$PROJ/.beads/drover.db"
  export DROVER_STATE_DIR="$TMP/state"
  export DROVER_BD_POLL_INTERVAL=1

  # Fake bd: returns two ready tickets on first call, the same plus one new on
  # the second, to prove diffing.
  export DROVER_BD="$TMP/fake-bd"
  export CALL_LOG="$TMP/bd.calls"
  : > "$CALL_LOG"
  cat > "$DROVER_BD" <<EOF
#!/usr/bin/env bash
n=\$(wc -l < "$CALL_LOG" | tr -d ' ')
n=\$((n+1))
echo "call\$n" >> "$CALL_LOG"
if [ "\$n" -eq 1 ]; then
  cat <<'JSON'
[
  {"id":"drover-1","labels":["board-drover","lane-ready","severity-error"],"body":"**Fingerprint:** \`aaaaaaaaaaaa\`"},
  {"id":"drover-2","labels":["board-drover","lane-ready","severity-warning"],"body":"nothing"}
]
JSON
else
  cat <<'JSON'
[
  {"id":"drover-1","labels":["board-drover","lane-ready","severity-error"],"body":"**Fingerprint:** \`aaaaaaaaaaaa\`"},
  {"id":"drover-2","labels":["board-drover","lane-ready","severity-warning"],"body":"nothing"},
  {"id":"drover-3","labels":["board-drover","lane-ready","severity-notice"],"body":"third"}
]
JSON
fi
EOF
  chmod +x "$DROVER_BD"
}

teardown() {
  rm -rf "$TMP"
}

@test "missing project path exits 2" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
}

@test "emits READY once per unseen ready ticket" {
  DROVER_MAX_ITERATIONS=1 run "$SCRIPT" "$PROJ"
  ready_count=$(echo "$output" | grep -c "^READY " || true)
  [ "$ready_count" -eq 2 ]
  [[ "$output" == *"READY drover-1 error aaaaaaaaaaaa myproj"* ]]
  [[ "$output" == *"READY drover-2 warning - myproj"* ]]
}

@test "second poll only emits net-new tickets" {
  DROVER_MAX_ITERATIONS=2 run "$SCRIPT" "$PROJ"
  ready_count=$(echo "$output" | grep -c "^READY " || true)
  # Call 1: drover-1, drover-2; Call 2: drover-3. Total 3 READY emissions.
  [ "$ready_count" -eq 3 ]
  [[ "$output" == *"READY drover-3 notice"* ]]
}

@test "state file persists seen ticket ids" {
  DROVER_MAX_ITERATIONS=1 "$SCRIPT" "$PROJ" > /dev/null
  [ -f "$DROVER_STATE_DIR/myproj.json" ]
  python3 -c "
import json, os
d = json.load(open(os.environ['DROVER_STATE_DIR']+'/myproj.json'))
assert 'drover-1' in d
assert 'drover-2' in d
"
}

@test "missing drover.db is tolerated (no error, no emissions)" {
  rm "$PROJ/.beads/drover.db"
  DROVER_MAX_ITERATIONS=1 run "$SCRIPT" "$PROJ"
  [ "$status" -eq 0 ]
  ready_count=$(echo "$output" | grep -c "^READY " || true)
  [ "$ready_count" -eq 0 ]
}
