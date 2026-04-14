#!/usr/bin/env bats

# Tests for scripts/backfill.sh. Stubs acquia-download.sh via
# DROVER_DOWNLOAD_SCRIPT to avoid needing real acli.

setup() {
  DROVER_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$DROVER_ROOT/scripts/backfill.sh"
  TMP="$(mktemp -d)"
  export DROVER_STATE_DIR="$TMP/state"
  export DROVER_THRESHOLD=3

  # Fake downloader: emits canned log lines. Ignores args.
  export DROVER_DOWNLOAD_SCRIPT="$TMP/fake-download.sh"
  cat > "$DROVER_DOWNLOAD_SCRIPT" <<'EOF'
#!/usr/bin/env bash
case "$2" in
  php-error)
    for i in 1 2 3 4 5; do
      echo "[14-Apr-2026 20:0$i:00 UTC] PHP Fatal error: Uncaught TypeError in /var/www/foo.php on line 42"
    done
    ;;
  apache-error)
    echo "[Mon Apr 14 20:05:00 2026] [php:error] [pid 123] something DIFFERENT happened"
    ;;
esac
EOF
  chmod +x "$DROVER_DOWNLOAD_SCRIPT"
}

teardown() {
  rm -rf "$TMP"
}

@test "missing alias exits 2" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
}

@test "emits NEW for first fingerprint of each kind" {
  run "$SCRIPT" pncb.prod
  new_count=$(echo "$output" | grep -c "^NEW " || true)
  [ "$new_count" -eq 2 ]
}

@test "emits THRESH when fingerprint hits DROVER_THRESHOLD" {
  run "$SCRIPT" pncb.prod
  [[ "$output" == *"THRESH "* ]]
  [[ "$output" == *"count=3"* ]]
}

@test "prints BACKFILL summary line" {
  run "$SCRIPT" pncb.prod
  [[ "$output" == *"BACKFILL done env=pncb.prod"* ]]
  [[ "$output" == *"events=6"* ]]
}

@test "state file is created and contains processed fingerprints" {
  "$SCRIPT" pncb.prod > /dev/null
  [ -f "$DROVER_STATE_DIR/pncb.prod.json" ]
  python3 -c "
import json, os
d = json.load(open(os.environ['DROVER_STATE_DIR']+'/pncb.prod.json'))
assert len(d) == 2, d  # two distinct fingerprints
"
}

@test "DROVER_JSONL_OUT captures per-event records" {
  export DROVER_JSONL_OUT="$TMP/events.jsonl"
  "$SCRIPT" pncb.prod > /dev/null
  [ -f "$DROVER_JSONL_OUT" ]
  count=$(wc -l < "$DROVER_JSONL_OUT")
  [ "$count" -eq 6 ]
  # Each line parses as JSON with fingerprint+env fields.
  python3 -c "
import json, os
for line in open(os.environ['DROVER_JSONL_OUT']):
    d = json.loads(line)
    assert d['fingerprint']
    assert d['env'] == 'pncb.prod'
"
}

@test "second invocation is idempotent (counts continue, no double NEW)" {
  "$SCRIPT" pncb.prod > /dev/null
  run "$SCRIPT" pncb.prod
  # All fingerprints already exist, so no NEW lines on second run.
  new_count=$(echo "$output" | grep -c "^NEW " || true)
  [ "$new_count" -eq 0 ]
}
