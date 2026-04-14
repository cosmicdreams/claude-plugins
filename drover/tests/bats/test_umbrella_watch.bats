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

@test "empty projects file spawns no children" {
  echo "[]" > "$DROVER_PROJECTS_FILE"
  run run_timeout 3 "$SCRIPT"
  [[ "$output" != *"starting"* ]]
  [[ "$output" != *"tick"* ]]
}

@test "one project spawns one child and emits prefixed output" {
  write_projects siteA
  run run_timeout 3 "$SCRIPT"
  [[ "$output" == *"starting ddev:siteA"* ]]
  [[ "$output" == *"[ddev:siteA] tick siteA"* ]]
}

@test "two projects spawn two children" {
  write_projects siteA siteB
  run run_timeout 3 "$SCRIPT"
  [[ "$output" == *"starting ddev:siteA"* ]]
  [[ "$output" == *"starting ddev:siteB"* ]]
  [[ "$output" == *"[ddev:siteA] tick siteA"* ]]
  [[ "$output" == *"[ddev:siteB] tick siteB"* ]]
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
  [[ "$output" == *"starting ddev:siteC"* ]]
  [[ "$output" == *"starting acquia:30395-xxx"* ]]
  [[ "$output" == *"starting acquia:30396-xxx"* ]]
  [[ "$output" == *"[acquia:30395-xxx] aqtick 30395-xxx"* ]]
}

@test "missing projects file is tolerated" {
  # No file at all.
  run run_timeout 3 "$SCRIPT"
  [ "$status" -eq 0 ]
  [[ "$output" != *"starting"* ]]
}
