#!/usr/bin/env bats

load helpers

# Tests for scripts/monitors/umbrella-watch.sh.
# Child watcher scripts are stubbed via DROVER_{DDEV,ACQUIA,BD_READY}_WATCH
# to avoid needing real DDEV / Acquia credentials. The `ddev` binary itself
# (used by the reachability gate) is stubbed via bats-mock where needed.

setup() {
  DROVER_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$DROVER_ROOT/scripts/monitors/umbrella-watch.sh"
  TMP="$(mktemp -d)"
  export DROVER_PROJECTS_FILE="$TMP/projects.json"
  export DROVER_UMBRELLA_POLL=1
  export DROVER_UMBRELLA_MAX_ITERATIONS=2
  export DROVER_UMBRELLA_LOG="$TMP/umbrella.log"
  # Default: a broad DDEV reachability set so generic tests don't get gated.
  # Tests exercising the gate override this explicitly, and the parser-path
  # test replaces this with a bats-mock `ddev` stub so the code reads real
  # ddev-shaped JSON instead of the env-var backdoor.
  export DROVER_REACHABLE_DDEV=$'siteA\nsiteB\nsiteC'
  # Default: accept any Acquia app (prevents the real acquia_api probe from
  # running, which would hit live Acquia and exceed the run_timeout budget).
  # Tests that exercise the Acquia gate override this explicitly.
  export DROVER_REACHABLE_ACQUIA_APPS=$'fa5e7770-c451-433d-8dcb-482af08eae21\n30395-xxx\n30396-xxx\n30397-xxx\nabc-123'

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
  refute_output --partial "starting"
  refute_output --partial "tick"
  # Lifecycle never emitted on stdout even with projects present.
  refute [ -s "$DROVER_UMBRELLA_LOG" ] || { run cat "$DROVER_UMBRELLA_LOG"; refute_output --partial "starting"; }
}

@test "one project spawns one child and emits prefixed output" {
  write_projects siteA
  run run_timeout 3 "$SCRIPT"
  # Lifecycle goes to log, not stdout.
  refute_output --partial "starting"
  assert_output --partial "[ddev:siteA] tick siteA"
  run cat "$DROVER_UMBRELLA_LOG"
  assert_output --partial "starting ddev:siteA"
}

@test "two projects spawn two children" {
  write_projects siteA siteB
  run run_timeout 3 "$SCRIPT"
  assert_output --partial "[ddev:siteA] tick siteA"
  assert_output --partial "[ddev:siteB] tick siteB"
  run cat "$DROVER_UMBRELLA_LOG"
  assert_output --partial "starting ddev:siteA"
  assert_output --partial "starting ddev:siteB"
}

@test "project with acquia envs spawns one child per env" {
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
  assert_output --partial "[acquia:30395-xxx] aqtick 30395-xxx"
  run cat "$DROVER_UMBRELLA_LOG"
  assert_output --partial "starting ddev:siteC"
  assert_output --partial "starting acquia:30395-xxx"
  assert_output --partial "starting acquia:30396-xxx"
}

@test "missing projects file is tolerated" {
  run run_timeout 3 "$SCRIPT"
  assert_success
  refute_output --partial "starting"
}

@test "Acquia gate: app with reachable creds spawns its env watchers" {
  # Override marks app_uuid A as reachable; watcher should spawn.
  export DROVER_REACHABLE_ACQUIA_APPS="fa5e7770-c451-433d-8dcb-482af08eae21"
  export DROVER_ACQUIA_WATCH="$TMP/fake-acquia-watch.sh"
  cat > "$DROVER_ACQUIA_WATCH" <<'EOF'
#!/usr/bin/env bash
echo "aqtick $1"; sleep 0.2
EOF
  chmod +x "$DROVER_ACQUIA_WATCH"

  python3 -c "
import json
print(json.dumps([{'name': 'siteA', 'path': '/tmp/siteA', 'ddev_project': 'siteA',
    'acquia': {'environments': [
        {'alias': 'pncb.dev', 'env': 'dev',
         'app_uuid': 'fa5e7770-c451-433d-8dcb-482af08eae21'}]}}]))
" > "$DROVER_PROJECTS_FILE"
  run run_timeout 3 "$SCRIPT"
  assert_output --partial "[acquia:dev.fa5e7770-c451-433d-8dcb-482af08eae21]"
}

@test "Acquia gate: unreachable app is silently skipped (no spawn)" {
  # Empty reachable set with the env var explicitly present: gate is
  # active but no apps match — all acquia:* keys silently excluded.
  export DROVER_REACHABLE_ACQUIA_APPS=" "
  export DROVER_ACQUIA_WATCH="$TMP/fake-acquia-watch.sh"
  cat > "$DROVER_ACQUIA_WATCH" <<'EOF'
#!/usr/bin/env bash
echo "aqtick $1"; sleep 0.2
EOF
  chmod +x "$DROVER_ACQUIA_WATCH"

  python3 -c "
import json
print(json.dumps([{'name': 'siteA', 'path': '/tmp/siteA', 'ddev_project': 'siteA',
    'acquia': {'environments': [
        {'alias': 'pncb.dev', 'env': 'dev',
         'app_uuid': 'fa5e7770-c451-433d-8dcb-482af08eae21'}]}}]))
" > "$DROVER_PROJECTS_FILE"
  run run_timeout 3 "$SCRIPT"
  refute_output --partial "aqtick"
  run cat "$DROVER_UMBRELLA_LOG"
  assert_output --partial "skip acquia:dev.fa5e7770-c451-433d-8dcb-482af08eae21"
}

@test "Acquia gate: skip is logged once per session, not per tick" {
  export DROVER_REACHABLE_ACQUIA_APPS=" "
  export DROVER_ACQUIA_WATCH="$TMP/fake-acquia-watch.sh"
  cat > "$DROVER_ACQUIA_WATCH" <<'EOF'
#!/usr/bin/env bash
echo "aqtick $1"; sleep 0.2
EOF
  chmod +x "$DROVER_ACQUIA_WATCH"
  python3 -c "
import json
print(json.dumps([{'name': 'siteA', 'path': '/tmp/siteA', 'ddev_project': 'siteA',
    'acquia': {'environments': [
        {'alias': 'pncb.dev', 'env': 'dev',
         'app_uuid': 'fa5e7770-c451-433d-8dcb-482af08eae21'}]}}]))
" > "$DROVER_PROJECTS_FILE"
  run run_timeout 3 "$SCRIPT"
  count=$(grep -c "skip acquia:" "$DROVER_UMBRELLA_LOG" 2>/dev/null || true)
  assert_equal "$count" "1"
}

@test "acquia alias contract: real-shape projects.json emits acquia:env.app_uuid" {
  # Regression test for sprint-8bo. Real add-project.sh output uses 'env' for
  # the env slug (not 'name' / 'env_slug') and puts app_uuid inside each env
  # entry (not at the parent 'acquia' level). Previously the umbrella's
  # list_projects used the wrong field names and fell through to emitting
  # the raw drush alias ("pncb.dev") as the acquia key — which acquia-watch
  # then split as env='pncb' app_uuid='dev' and blew up with HTTP 400
  # invalid_id on every cycle.
  export DROVER_ACQUIA_WATCH="$TMP/fake-acquia-watch.sh"
  cat > "$DROVER_ACQUIA_WATCH" <<'EOF'
#!/usr/bin/env bash
echo "aqtick $1"
sleep 0.2
EOF
  chmod +x "$DROVER_ACQUIA_WATCH"

  python3 -c "
import json
print(json.dumps([{
    'name': 'pncb-main',
    'path': '/tmp/pncb',
    'ddev_project': 'pncb-main',
    'acquia': {
        'environments': [
            {'alias': 'pncb.dev',  'env': 'dev',  'site': 'pncb',
             'app_uuid': 'fa5e7770-c451-433d-8dcb-482af08eae21'},
            {'alias': 'pncb.prod', 'env': 'prod', 'site': 'pncb',
             'app_uuid': 'fa5e7770-c451-433d-8dcb-482af08eae21'},
        ]
    }
}]))
" > "$DROVER_PROJECTS_FILE"

  run run_timeout 3 "$SCRIPT"
  # Correct form: env_name.app_uuid — what acquia-watch.py expects.
  assert_output --partial "[acquia:dev.fa5e7770-c451-433d-8dcb-482af08eae21]"
  assert_output --partial "[acquia:prod.fa5e7770-c451-433d-8dcb-482af08eae21]"
  # Must NOT emit the raw drush-alias form which triggered the bug.
  refute_output --partial "[acquia:pncb.dev]"
  refute_output --partial "[acquia:pncb.prod]"
}

@test "DDEV gate: ddev:<name> in active set spawns watcher" {
  export DROVER_REACHABLE_DDEV="siteA"
  write_projects siteA
  run run_timeout 3 "$SCRIPT"
  assert_output --partial "[ddev:siteA] tick siteA"
}

@test "DDEV gate: ddev:<name> not in active set is silently skipped" {
  # siteA is configured but ddev reports it as not running.
  export DROVER_REACHABLE_DDEV="otherSite"
  write_projects siteA
  run run_timeout 3 "$SCRIPT"
  # No watcher spawned → no tick on stdout, no terminal noise.
  refute_output --partial "tick"
  # Log records the skip once, for debuggability.
  run cat "$DROVER_UMBRELLA_LOG"
  assert_output --partial "skip ddev:siteA"
}

@test "DDEV gate: only ddev kind is gated; acquia passes through" {
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
  refute_output --partial "tick siteA"
  assert_output --partial "[acquia:30395-xxx] aqtick 30395-xxx"
}

@test "DDEV gate: skip is logged once per session, not per tick" {
  # Two iterations (DROVER_UMBRELLA_MAX_ITERATIONS=2) should produce exactly
  # one skip log line per key — otherwise the log itself becomes a spam channel.
  export DROVER_REACHABLE_DDEV="otherSite"
  write_projects siteA
  run run_timeout 3 "$SCRIPT"
  count=$(grep -c "skip ddev:siteA" "$DROVER_UMBRELLA_LOG" 2>/dev/null || true)
  assert_equal "$count" "1"
}

@test "DDEV gate: uses real ddev CLI output when no override is set" {
  # Replace the env-var backdoor with a bats-mock `ddev` stub so the parser
  # path (ddev list -A --json-output | python3 ...) actually runs. Proves
  # the JSON parser correctly extracts project names from real ddev output.
  unset DROVER_REACHABLE_DDEV
  stub ddev \
    "list -A --json-output : echo '{\"raw\":[{\"name\":\"siteA\",\"status\":\"running\"}]}'"

  write_projects siteA siteB
  # Umbrella runs under perl-based run_timeout; PATH modifications from
  # bats-mock must cross into exec'd subprocesses. Assert they did by
  # checking the log for a "1 active DDEV project" line before asserting
  # child-watcher behavior.
  run run_timeout 3 "$SCRIPT"
  run cat "$DROVER_UMBRELLA_LOG"
  assert_output --partial "reachability gate: 1 active DDEV project"
  assert_output --partial "skip ddev:siteB"

  unstub ddev
}

@test "child stderr routes to log, not harness stdout" {
  cat > "$DROVER_DDEV_WATCH" <<'EOF'
#!/usr/bin/env bash
echo "signal-line $1"
echo "noisy-retry $1" >&2
sleep 0.3
EOF
  chmod +x "$DROVER_DDEV_WATCH"

  write_projects siteA
  run run_timeout 3 "$SCRIPT"

  assert_output --partial "[ddev:siteA] signal-line siteA"
  refute_output --partial "noisy-retry"
  run cat "$DROVER_UMBRELLA_LOG"
  assert_output --partial "[ddev:siteA] noisy-retry siteA"
}

@test "TRANSIENT acquia-watch lines stay off harness stdout" {
  # Real TRANSIENT pattern from acquia-watch.py (status=400 invalid_id).
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
  refute_output --partial "TRANSIENT"
  refute_output --partial "invalid_id"
  run cat "$DROVER_UMBRELLA_LOG"
  assert_output --partial "TRANSIENT"
  assert_output --partial "[acquia:30395-xxx]"
}

@test "PERMANENT acquia-watch lines stay off harness stdout" {
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
  refute_output --partial "PERMANENT"
  refute_output --partial "forbidden_ip"
  run cat "$DROVER_UMBRELLA_LOG"
  assert_output --partial "PERMANENT"
  assert_output --partial "forbidden_ip"
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
  refute_output --partial "expected alias format"
  run cat "$DROVER_UMBRELLA_LOG"
  assert_output --partial "expected alias format"
}

@test "dispatcher: drupal platform routes to ddev-watch" {
  # Default: projects without an explicit platform field are treated as drupal.
  write_projects siteA
  run run_timeout 3 "$SCRIPT"
  assert_output --partial "[ddev:siteA] tick siteA"
  # The ddev-watch fake echoes "tick NAME". If the wrong watcher were
  # dispatched, we'd see a different output prefix or nothing.
}

@test "dispatcher: wordpress platform routes to wp-watch" {
  # Override the wp watcher with a fake that emits a distinct marker.
  export DROVER_WP_WATCH="$TMP/fake-wp-watch.sh"
  cat > "$DROVER_WP_WATCH" <<'EOF'
#!/usr/bin/env bash
echo "wp-tick $1"
sleep 0.3
EOF
  chmod +x "$DROVER_WP_WATCH"

  python3 -c "
import json
print(json.dumps([{'name': 'siteA', 'path': '/tmp/siteA', 'ddev_project': 'siteA',
                   'platform': 'wordpress'}]))
" > "$DROVER_PROJECTS_FILE"

  run run_timeout 3 "$SCRIPT"
  # wp-watch fake emits wp-tick; the ddev-watch fake would emit "tick".
  assert_output --partial "[ddev:siteA] wp-tick siteA"
  refute_output --partial "[ddev:siteA] tick siteA"
}

@test "dispatcher: explicit drupal platform still routes to ddev-watch" {
  python3 -c "
import json
print(json.dumps([{'name': 'siteA', 'path': '/tmp/siteA', 'ddev_project': 'siteA',
                   'platform': 'drupal'}]))
" > "$DROVER_PROJECTS_FILE"

  run run_timeout 3 "$SCRIPT"
  assert_output --partial "[ddev:siteA] tick siteA"
}

@test "dispatcher: unknown platform logs a warning and falls back to drupal" {
  python3 -c "
import json
print(json.dumps([{'name': 'siteA', 'path': '/tmp/siteA', 'ddev_project': 'siteA',
                   'platform': 'sitecore'}]))
" > "$DROVER_PROJECTS_FILE"

  run run_timeout 3 "$SCRIPT"
  assert_output --partial "[ddev:siteA] tick siteA"
  run cat "$DROVER_UMBRELLA_LOG"
  assert_output --partial "unknown platform 'sitecore' for ddev:siteA; falling back to drupal"
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
  assert_output --partial "NEW fp1 error source siteA msg1"
  assert_output --partial "NEW fp2 error source siteA msg2"
  assert_output --partial "NEW fp3 error source siteA msg3"
  run cat "$DROVER_UMBRELLA_LOG"
  assert_output --partial "TRANSIENT blip 1"
  assert_output --partial "TRANSIENT blip 3"
}
