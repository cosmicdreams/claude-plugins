#!/usr/bin/env bats

load helpers

# Tests for scripts/monitors/wp-watch.py — the WordPress-on-DDEV watcher.
# Structurally mirrors test_ddev_watch.bats. A per-test `ddev` shim script
# on $PATH stands in for real DDEV — bats-mock is unsuitable here because
# wp-watch runs two concurrent `ddev` subprocesses via Python threading,
# which races the stub's shared invocation counter.

setup() {
  DROVER_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$DROVER_ROOT/scripts/monitors/wp-watch.py"
  TMP="$(mktemp -d)"
  export DROVER_STATE_DIR="$TMP/state"
  export DROVER_MAX_EVENTS=5
  export DROVER_THRESHOLD=3
  mkdir -p "$DROVER_STATE_DIR"
  # Put a shim bin at the front of PATH so our fake `ddev` is found.
  SHIM_BIN="$TMP/bin"
  mkdir -p "$SHIM_BIN"
  export PATH="$SHIM_BIN:$PATH"
}

teardown() {
  rm -rf "$TMP"
}

# Write a fake `ddev` to $SHIM_BIN that dispatches on its first arg.
#   $1 = lines to emit on `ddev exec ...` stdout
# `ddev logs` always exits immediately (no output).
write_ddev_shim() {
  local tail_output="$1"
  cat > "$SHIM_BIN/ddev" <<SHIM
#!/usr/bin/env bash
case "\$1" in
  exec)  printf '%s' "$(printf '%s' "$tail_output" | sed 's/"/\\"/g')"; printf '\n' ;;
  logs)  exit 0 ;;
  *)     exit 0 ;;
esac
SHIM
  chmod +x "$SHIM_BIN/ddev"
}

@test "wp-watch: emits NEW on a PHP Fatal line from debug.log" {
  write_ddev_shim "[21-Apr-2026 14:30:15 UTC] PHP Fatal error:  Uncaught Error: Call to undefined function wp_foo() in /var/www/html/wp-content/plugins/my-plugin/my-plugin.php:42"

  run run_timeout 3 python3 "$SCRIPT" kd
  assert_output --partial "NEW "
  assert_output --partial " error "
  assert_output --partial " kd "
  assert_output --partial "undefined function"
}

@test "wp-watch: PHP Warning classified as warning, not error" {
  write_ddev_shim "[21-Apr-2026 14:30:16 UTC] PHP Warning:  Undefined variable foo in /var/www/html/wp-content/themes/twentytwenty/functions.php on line 10"

  run run_timeout 3 python3 "$SCRIPT" kd
  assert_output --partial "NEW "
  assert_output --partial " warning "
  refute_output --partial " error "
}

@test "wp-watch: THRESH emitted when count hits threshold" {
  # Emit 5 copies of the same fingerprint-worthy line. Threshold=3 → NEW
  # on the first, THRESH on the third (when count transitions to 3).
  local lines=""
  for i in 1 2 3 4 5; do
    lines+="[21-Apr-2026 14:30:15 UTC] PHP Fatal error: repeating boom"$'\n'
  done
  write_ddev_shim "$lines"

  run run_timeout 3 python3 "$SCRIPT" kd
  assert_output --partial "NEW "
  assert_output --partial "THRESH "
  assert_output --partial "count=3"
}

@test "wp-watch: missing project name exits with usage error on stderr" {
  run python3 "$SCRIPT"
  assert_failure
  [[ "$stderr" == *"missing project name"* ]] || [[ "$output" == *"missing project name"* ]]
}

@test "wp-watch: non-error access-log line is ignored" {
  write_ddev_shim "192.168.1.1 - - [21/Apr/2026:14:30:15 +0000] \"GET /wp-admin HTTP/1.1\" 200 1234"

  run run_timeout 3 python3 "$SCRIPT" kd
  refute_output --partial "NEW "
  refute_output --partial "THRESH "
}

@test "wp-watch: respects DROVER_WP_DEBUG_LOG override for debug.log path" {
  # Shim records the full argv so we can prove the override is honored.
  cat > "$SHIM_BIN/ddev" <<'SHIM'
#!/usr/bin/env bash
case "$1" in
  exec)  printf '%s\n' "ARGS:$*" ;;
  logs)  exit 0 ;;
esac
SHIM
  chmod +x "$SHIM_BIN/ddev"

  export DROVER_WP_DEBUG_LOG="/custom/path/mu-debug.log"
  # The ARGS: line won't classify as an error, so wp-watch produces no NEW —
  # but the fact that we see the expected args in the fake `ddev` output
  # captured via DROVER_MAX_EVENTS being unreachable is irrelevant. Use a
  # wrapped approach: capture shim stdout into a file via DROVER_STATE_DIR
  # temp, then assert on file contents.
  SHIM_LOG="$TMP/shim.log"
  cat > "$SHIM_BIN/ddev" <<SHIM
#!/usr/bin/env bash
echo "ARGV: \$*" >> "$SHIM_LOG"
case "\$1" in
  exec)  echo "[TS] PHP Fatal error: x" ;;
  logs)  exit 0 ;;
esac
SHIM
  chmod +x "$SHIM_BIN/ddev"

  run run_timeout 3 python3 "$SCRIPT" kd
  # Argv log should contain the overridden path.
  run cat "$SHIM_LOG"
  assert_output --partial "/custom/path/mu-debug.log"
  refute_output --partial "wp-content/debug.log"
}
