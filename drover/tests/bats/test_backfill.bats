#!/usr/bin/env bats

# Tests for scripts/backfill.sh. Stubs acquia-download.sh via
# DROVER_DOWNLOAD_SCRIPT to avoid needing real acli.

setup() {
  DROVER_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$DROVER_ROOT/scripts/backfill.sh"
  TMP="$(mktemp -d)"
  export DROVER_STATE_DIR="$TMP/state"
  export DROVER_THRESHOLD=3

  # Provide a projects.json so backfill.sh can resolve pncb.prod into
  # (app_uuid=fa5e7770-..., env_name=prod). Without this, backfill exits 3.
  export DROVER_PROJECTS_FILE="$TMP/projects.json"
  python3 -c "
import json
print(json.dumps([{
    'name': 'pncb-main', 'path': '/tmp/pncb', 'ddev_project': 'pncb-main',
    'acquia': {'environments': [
        {'alias': 'pncb.prod', 'env': 'prod', 'site': 'pncb',
         'app_uuid': 'fa5e7770-c451-433d-8dcb-482af08eae21'},
    ]}
}]))
" > "$DROVER_PROJECTS_FILE"

  # Fake downloader with the current (drover 1.11.0+) 3-arg signature:
  #   $1=app_uuid, $2=env_name, $3=log-type. Dispatches on log-type.
  export DROVER_DOWNLOAD_SCRIPT="$TMP/fake-download.sh"
  cat > "$DROVER_DOWNLOAD_SCRIPT" <<'EOF'
#!/usr/bin/env bash
case "$3" in
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

@test "downloader is invoked with 3 args: app_uuid, env_name, log_type" {
  # Regression for the broken backfill button. Since drover 1.11.0 the
  # downloader signature is (app_uuid, env_name, log_type); backfill.sh
  # was still passing (alias, log_type). A real download would fail silently
  # (stderr swallowed by backfill's `2>/dev/null`) and the temp log ended
  # up empty — the toast reported "0 events" and nothing was backfilled.
  #
  # This fake downloader asserts it sees exactly 3 non-empty args and
  # records argv to a log file so the test can verify the exact arguments.
  ARGS_LOG="$TMP/download-args.log"
  cat > "$DROVER_DOWNLOAD_SCRIPT" <<EOF
#!/usr/bin/env bash
echo "argc=\$#  arg1=\$1  arg2=\$2  arg3=\${3:-}" >> "$ARGS_LOG"
if [ "\$#" -ne 3 ] || [ -z "\$1" ] || [ -z "\$2" ] || [ -z "\$3" ]; then
  echo "downloader-rejected: wrong arg count" >&2
  exit 1
fi
# Emit one PHP Fatal so backfill has something to fingerprint.
echo "[14-Apr-2026 20:01:00 UTC] PHP Fatal error: Uncaught in /foo.php on line 1"
EOF
  chmod +x "$DROVER_DOWNLOAD_SCRIPT"

  # Backfill needs a way to resolve alias -> (app_uuid, env_name). The
  # natural source is projects.json (written by add-project.sh). Set it
  # up with a registered pncb project.
  export DROVER_PROJECTS_FILE="$TMP/projects.json"
  python3 -c "
import json
print(json.dumps([{
    'name': 'pncb-main',
    'path': '/tmp/pncb',
    'ddev_project': 'pncb-main',
    'acquia': {'environments': [
        {'alias': 'pncb.prod', 'env': 'prod', 'site': 'pncb',
         'app_uuid': 'fa5e7770-c451-433d-8dcb-482af08eae21'},
    ]}
}]))
" > "$DROVER_PROJECTS_FILE"

  run "$SCRIPT" pncb.prod php-error
  # Capture the downloader's argv log for diagnosis on failure.
  if [ -f "$ARGS_LOG" ]; then
    echo "downloader argv log:"
    cat "$ARGS_LOG"
  fi
  # The test fails here if the signature mismatch is present.
  [[ "$output" != *"downloader-rejected"* ]]
  # Assert the downloader saw the right three values, not (alias, log-type, '').
  grep -q "argc=3  arg1=fa5e7770-c451-433d-8dcb-482af08eae21  arg2=prod  arg3=php-error" "$ARGS_LOG"
}

@test "second invocation is idempotent (counts continue, no double NEW)" {
  "$SCRIPT" pncb.prod > /dev/null
  run "$SCRIPT" pncb.prod
  # All fingerprints already exist, so no NEW lines on second run.
  new_count=$(echo "$output" | grep -c "^NEW " || true)
  [ "$new_count" -eq 0 ]
}
