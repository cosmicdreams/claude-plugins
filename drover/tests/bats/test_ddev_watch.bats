#!/usr/bin/env bats

# Tests for scripts/monitors/ddev-watch.sh. Stubs `ddev` via PATH.
# Uses DROVER_MAX_EVENTS to bound execution deterministically.

setup() {
  DROVER_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$DROVER_ROOT/scripts/monitors/ddev-watch.py"
  TMP="$(mktemp -d)"
  export DROVER_STATE_DIR="$TMP/state"
  export DROVER_THRESHOLD=3

  BIN="$TMP/bin"
  mkdir -p "$BIN"
  cat > "$BIN/ddev" <<'EOF'
#!/usr/bin/env bash
case " $* " in
  *" drush watchdog:tail "*)
    for i in 1 2 3 4 5; do
      echo "Sun, 2026/04/14 - 14:5$i | php | Notice: Undefined index: foo in /app/web/modules/bar.module (line 99)."
    done
    ;;
  *" logs -f --service web "*)
    echo "PHP Fatal error: Uncaught TypeError in /app/web/modules/baz.module on line 7"
    ;;
esac
# Exit immediately so ddev-watch's inner while-loop cycles to the next call,
# but DROVER_MAX_EVENTS will break us out before that happens.
EOF
  chmod +x "$BIN/ddev"
  export PATH="$BIN:$PATH"
}

teardown() {
  rm -rf "$TMP"
}

@test "emits NEW on first occurrence of a fingerprint" {
  DROVER_MAX_EVENTS=2 run "$SCRIPT" site1
  [[ "$output" == *"NEW "* ]]
}

@test "two distinct fingerprints yield two NEW lines" {
  # Need enough events to see both streams (watchdog emits 5, web emits 1).
  DROVER_MAX_EVENTS=6 run "$SCRIPT" site2
  new_count=$(echo "$output" | grep -c "^NEW " || true)
  [ "$new_count" -eq 2 ]
}

@test "emits THRESH when repeat count hits DROVER_THRESHOLD" {
  # Notice fires 5 times; fatal fires once. With THRESHOLD=3:
  # notice → NEW, repeat, THRESH at count=3 — need enough events processed.
  DROVER_MAX_EVENTS=5 run "$SCRIPT" site3
  [[ "$output" == *"THRESH "* ]]
  [[ "$output" == *"count=3"* ]]
}

@test "state file is created with at least one fingerprint" {
  DROVER_MAX_EVENTS=2 "$SCRIPT" site4 > /dev/null
  [ -f "$DROVER_STATE_DIR/site4.json" ]
  python3 -c "import json,os; d=json.load(open(os.environ['DROVER_STATE_DIR']+'/site4.json')); assert len(d) >= 1"
}

@test "missing project argument exits 2" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
}
