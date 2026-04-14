#!/usr/bin/env bats

# Tests for scripts/monitors/acquia-watch.py — stubs `acli` via DROVER_ACLI.

setup() {
  DROVER_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$DROVER_ROOT/scripts/monitors/acquia-watch.py"
  TMP="$(mktemp -d)"
  export DROVER_STATE_DIR="$TMP/state"
  export DROVER_THRESHOLD=3

  # Fake acli that emits the preamble then some log lines.
  export DROVER_ACLI="$TMP/fake-acli"
  cat > "$DROVER_ACLI" <<'EOF'
#!/usr/bin/env bash
echo "Box Requirements Checker"
echo ""
echo "Streaming has started and new logs will appear below. Use Ctrl+C to exit."
# Access log — should be skipped.
echo '127.0.0.1 - - [14/Apr/2026:20:22:40 +0000] "GET / HTTP/1.1" 200 861'
# PHP Fatal — one fingerprint.
echo 'PHP Fatal error:  Uncaught TypeError in /var/www/html/pncb.prod/docroot/modules/foo/src/Bar.php on line 42'
# Three identical notices.
for i in 1 2 3; do
  echo "Sun, 2026/04/14 - 21:0$i | php | Notice: Undefined index in /var/www/html/foo.module (line 99)."
done
EOF
  chmod +x "$DROVER_ACLI"
}

teardown() {
  rm -rf "$TMP"
}

@test "skips preamble until 'Streaming has started'" {
  DROVER_MAX_EVENTS=1 run "$SCRIPT" envX
  [[ "$output" != *"Box Requirements"* ]]
}

@test "emits NEW for a PHP fatal" {
  DROVER_MAX_EVENTS=1 run "$SCRIPT" envX
  [[ "$output" == *"NEW "* ]]
  [[ "$output" == *"error"* ]]
}

@test "distinct fingerprints for fatal and watchdog notice" {
  DROVER_MAX_EVENTS=4 run "$SCRIPT" envY
  new_count=$(echo "$output" | grep -c "^NEW " || true)
  [ "$new_count" -eq 2 ]
}

@test "emits THRESH at threshold" {
  DROVER_MAX_EVENTS=5 run "$SCRIPT" envZ
  [[ "$output" == *"THRESH "* ]]
  [[ "$output" == *"count=3"* ]]
}

@test "state file created per environment id" {
  DROVER_MAX_EVENTS=2 "$SCRIPT" env-abc > /dev/null
  [ -f "$DROVER_STATE_DIR/env-abc.json" ]
}

@test "missing env id exits 2" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
}
