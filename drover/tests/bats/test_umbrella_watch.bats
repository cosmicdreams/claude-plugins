#!/usr/bin/env bats

load helpers

# Tests for scripts/monitors/umbrella-watch.sh.
# Stubs ddev-watch.sh via DROVER_DDEV_WATCH to avoid needing real DDEV.

setup() {
  DROVER_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$DROVER_ROOT/scripts/monitors/umbrella-watch.sh"
  TMP="$(mktemp -d)"
  export DROVER_PROJECTS_FILE="$TMP/projects.json"
  export DROVER_UMBRELLA_POLL=1
  export DROVER_UMBRELLA_MAX_ITERATIONS=2
  export DROVER_UMBRELLA_LOG="$TMP/umbrella.log"
  # Default: no DDEV reachability filter in tests. Individual tests that
  # exercise the gate override DROVER_REACHABLE_DDEV explicitly.
  export DROVER_REACHABLE_DDEV=$'siteA\nsiteB\nsiteC'

  # Fake ddev-watch that echoes a "tick NAME" every 0.2s for 1.2s then exits.
  export DROVER_DDEV_WATCH="$TMP/fake-ddev-watch.sh"
  cat > "$DROVER_DDEV_WATCH" <<'EOF'
#!/usr/bin/env bash
n=0
while [ $n -lt 6 ]; do
  echo "tick $1"
  sleep 0.2
  n=$((n+1))
done
EOF
  chmod +x "$DROVER_DDEV_WATCH"

  # Fake bd-ready-watch: short-lived so tests terminate cleanly.
  export DROVER_BD_READY_WATCH="$TMP/fake-bd-ready-watch.sh"
  cat > "$DROVER_BD_READY_WATCH" <<'EOF'
#!/usr/bin/env bash
echo "bd-ready $1"
exit 0
EOF
  chmod +x "$DROVER_BD_READY_WATCH"
}

teardown() {
  rm -rf "$TMP"
}

write_projects() {
  python3 -c "
import json, sys
data = [{'name': n, 'path': '/tmp/'+n, 'ddev_project': n} for n in sys.argv[1:]]
print(json.dumps(data))
" "$@" > "$DROVER_PROJECTS_FILE"
}

log_contents() {
  cat "$DROVER_UMBRELLA_LOG" 2>/dev/null || true
}

@test "empty projects file spawns no children and exits quietly" {
  echo "[]" > "$DROVER_PROJECTS_FILE"
  run run_timeout 3 "$SCRIPT"
  [[ "$output" != *"starting"* ]]
  [[ "$output" != *"tick"* ]]
  # Lifecycle never emitted on stdout even with projects present.
  logs="$(log_contents)"
  [[ "$logs" != *"starting"* ]]
}

@test "one project spawns one child and emits prefixed output" {
  write_projects siteA
  run run_timeout 3 "$SCRIPT"
  # Lifecycle goes to log, not stdout.
  [[ "$output" != *"starting"* ]]
  [[ "$output" == *"[ddev:siteA] tick siteA"* ]]
  logs="$(log_contents)"
  [[ "$logs" == *"starting ddev:siteA"* ]]
}

@test "two projects spawn two children" {
  write_projects siteA siteB
  run run_timeout 3 "$SCRIPT"
  [[ "$output" == *"[ddev:siteA] tick siteA"* ]]
  [[ "$output" == *"[ddev:siteB] tick siteB"* ]]
  logs="$(log_contents)"
  [[ "$logs" == *"starting ddev:siteA"* ]]
  [[ "$logs" == *"starting ddev:siteB"* ]]
}

@test "project with acquia envs spawns one child per env" {
  # Use a fake acquia watcher so the umbrella can route without real acli.
  export DROVER_ACQUIA_WATCH="$TMP/fake-acquia-watch.sh"
  cat > "$DROVER_ACQUIA_WATCH" <<'EOF'
#!/usr/bin/env bash
for i in 1 2 3; do echo "aqtick $1"; sleep 0.2; done
EOF
  chmod +x "$DROVER_ACQUIA_WATCH"

  python3 -c "
import json
data = [{'name': 'siteC', 'path': '/tmp/siteC', 'ddev_project': 'siteC',
         'acquia': {'environments': [{'id': '30395-xxx'}, {'id': '30396-xxx'}]}}]
print(json.dumps(data))
" > "$DROVER_PROJECTS_FILE"

  run run_timeout 3 "$SCRIPT"
  [[ "$output" == *"[acquia:30395-xxx] aqtick 30395-xxx"* ]]
  logs="$(log_contents)"
  [[ "$logs" == *"starting ddev:siteC"* ]]
  [[ "$logs" == *"starting acquia:30395-xxx"* ]]
  [[ "$logs" == *"starting acquia:30396-xxx"* ]]
}

@test "missing projects file is tolerated" {
  # No file at all.
  run run_timeout 3 "$SCRIPT"
  [ "$status" -eq 0 ]
  [[ "$output" != *"starting"* ]]
}

@test "DDEV gate: ddev:<name> in active set spawns watcher" {
  export DROVER_REACHABLE_DDEV="siteA"
  write_projects siteA
  run run_timeout 3 "$SCRIPT"
  [[ "$output" == *"[ddev:siteA] tick siteA"* ]]
}

@test "DDEV gate: ddev:<name> not in active set is silently skipped" {
  # siteA is configured but ddev reports it as not running.
  export DROVER_REACHABLE_DDEV="otherSite"
  write_projects siteA
  run run_timeout 3 "$SCRIPT"
  # No watcher spawned → no tick on stdout, no terminal noise.
  [[ "$output" != *"tick"* ]]
  # Log records the skip once, for debuggability.
  logs="$(log_contents)"
  [[ "$logs" == *"skip ddev:siteA"* ]]
}

@test "DDEV gate: only ddev kind is gated; acquia passes through" {
  # Fake acquia-watch so we can observe the spawn without needing credentials.
  export DROVER_ACQUIA_WATCH="$TMP/fake-acquia-watch.sh"
  cat > "$DROVER_ACQUIA_WATCH" <<'EOF'
#!/usr/bin/env bash
echo "aqtick $1"
sleep 0.3
EOF
  chmod +x "$DROVER_ACQUIA_WATCH"

  # Non-matching DDEV active set: ddev:siteA gated out, acquia untouched.
  export DROVER_REACHABLE_DDEV="differentSite"
  python3 -c "
import json
data = [{'name': 'siteA', 'path': '/tmp/siteA', 'ddev_project': 'siteA',
         'acquia': {'environments': [{'id': '30395-xxx'}]}}]
print(json.dumps(data))
" > "$DROVER_PROJECTS_FILE"

  run run_timeout 3 "$SCRIPT"
  # ddev:siteA gated out.
  [[ "$output" != *"tick siteA"* ]]
  # acquia watcher spawns regardless of ddev gate.
  [[ "$output" == *"[acquia:30395-xxx] aqtick 30395-xxx"* ]]
}

@test "DDEV gate: skip is logged once per session, not per tick" {
  # Two iterations of the main loop (DROVER_UMBRELLA_MAX_ITERATIONS=2 in
  # setup) should only produce one skip log line per key — otherwise the
  # log itself becomes a per-tick spam channel.
  export DROVER_REACHABLE_DDEV="otherSite"
  write_projects siteA
  run run_timeout 3 "$SCRIPT"
  logs="$(log_contents)"
  count=$(printf '%s\n' "$logs" | grep -c "skip ddev:siteA" || true)
  [ "$count" -eq 1 ]
}

@test "child stderr routes to log, not harness stdout" {
  # Watcher that emits to both stdout and stderr. stderr must not reach
  # harness (task-notification channel); it must land in the umbrella log
  # with the watcher key prefixed.
  cat > "$DROVER_DDEV_WATCH" <<'EOF'
#!/usr/bin/env bash
echo "signal-line $1"
echo "noisy-retry $1" >&2
sleep 0.3
EOF
  chmod +x "$DROVER_DDEV_WATCH"

  write_projects siteA
  run run_timeout 3 "$SCRIPT"

  # Signal reaches stdout with key prefix.
  [[ "$output" == *"[ddev:siteA] signal-line siteA"* ]]
  # Noise MUST NOT reach stdout.
  [[ "$output" != *"noisy-retry"* ]]
  # Noise lands in log with a key prefix so it's scannable for debugging.
  logs="$(log_contents)"
  [[ "$logs" == *"[ddev:siteA] noisy-retry siteA"* ]]
}

@test "TRANSIENT acquia-watch lines stay off harness stdout" {
  # Simulate acquia-watch.py emitting the TRANSIENT pattern seen in real
  # spam (status=400 HTTP 400 invalid_id). Must not reach harness.
  export DROVER_ACQUIA_WATCH="$TMP/fake-acquia-transient.sh"
  cat > "$DROVER_ACQUIA_WATCH" <<'EOF'
#!/usr/bin/env bash
echo "acquia-watch: TRANSIENT $1 status=400 HTTP 400 (invalid_id)" >&2
exit 1
EOF
  chmod +x "$DROVER_ACQUIA_WATCH"

  python3 -c "
import json
print(json.dumps([{'name': 'siteA', 'path': '/tmp/siteA', 'ddev_project': 'siteA',
                   'acquia': {'environments': [{'id': '30395-xxx'}]}}]))
" > "$DROVER_PROJECTS_FILE"

  run run_timeout 3 "$SCRIPT"
  [[ "$output" != *"TRANSIENT"* ]]
  [[ "$output" != *"invalid_id"* ]]
  logs="$(log_contents)"
  [[ "$logs" == *"TRANSIENT"* ]]
  [[ "$logs" == *"[acquia:30395-xxx]"* ]]
}

@test "PERMANENT acquia-watch lines stay off harness stdout" {
  # PERMANENT pattern (quarantine-triggering). Must not reach harness.
  export DROVER_ACQUIA_WATCH="$TMP/fake-acquia-permanent.sh"
  cat > "$DROVER_ACQUIA_WATCH" <<'EOF'
#!/usr/bin/env bash
echo "acquia-watch: PERMANENT $1 status=403 slug=forbidden_ip Your IP is not allowed" >&2
exit 3
EOF
  chmod +x "$DROVER_ACQUIA_WATCH"

  python3 -c "
import json
print(json.dumps([{'name': 'siteA', 'path': '/tmp/siteA', 'ddev_project': 'siteA',
                   'acquia': {'environments': [{'id': '30395-xxx'}]}}]))
" > "$DROVER_PROJECTS_FILE"

  run run_timeout 3 "$SCRIPT"
  [[ "$output" != *"PERMANENT"* ]]
  [[ "$output" != *"forbidden_ip"* ]]
  logs="$(log_contents)"
  [[ "$logs" == *"PERMANENT"* ]]
  [[ "$logs" == *"forbidden_ip"* ]]
}

@test "init-error on child stderr stays off harness stdout" {
  # A child that writes an init error to stderr and exits immediately —
  # e.g. missing arg, malformed alias. Historically this flooded harness.
  cat > "$DROVER_DDEV_WATCH" <<'EOF'
#!/usr/bin/env bash
echo "ddev-watch: expected alias format; got garbage" >&2
exit 2
EOF
  chmod +x "$DROVER_DDEV_WATCH"

  write_projects siteA
  run run_timeout 3 "$SCRIPT"
  [[ "$output" != *"expected alias format"* ]]
  logs="$(log_contents)"
  [[ "$logs" == *"expected alias format"* ]]
}

@test "signal still reaches harness when stderr is also active" {
  # Interleave stdout and stderr — make sure the stdout path isn't
  # accidentally starved or buffered to death by the stderr redirection.
  cat > "$DROVER_DDEV_WATCH" <<'EOF'
#!/usr/bin/env bash
for i in 1 2 3; do
  echo "NEW fp$i error source $1 msg$i"
  echo "TRANSIENT blip $i" >&2
done
sleep 0.3
EOF
  chmod +x "$DROVER_DDEV_WATCH"

  write_projects siteA
  run run_timeout 3 "$SCRIPT"
  # All three NEW events should arrive on stdout.
  [[ "$output" == *"NEW fp1 error source siteA msg1"* ]]
  [[ "$output" == *"NEW fp2 error source siteA msg2"* ]]
  [[ "$output" == *"NEW fp3 error source siteA msg3"* ]]
  # And all three TRANSIENT blips in the log.
  logs="$(log_contents)"
  [[ "$logs" == *"TRANSIENT blip 1"* ]]
  [[ "$logs" == *"TRANSIENT blip 3"* ]]
}
