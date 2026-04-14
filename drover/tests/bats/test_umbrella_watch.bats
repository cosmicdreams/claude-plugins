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
  [[ "$output" == *"starting siteA"* ]]
  [[ "$output" == *"[siteA] tick siteA"* ]]
}

@test "two projects spawn two children" {
  write_projects siteA siteB
  run run_timeout 3 "$SCRIPT"
  [[ "$output" == *"starting siteA"* ]]
  [[ "$output" == *"starting siteB"* ]]
  [[ "$output" == *"[siteA] tick siteA"* ]]
  [[ "$output" == *"[siteB] tick siteB"* ]]
}

@test "missing projects file is tolerated" {
  # No file at all.
  run run_timeout 3 "$SCRIPT"
  [ "$status" -eq 0 ]
  [[ "$output" != *"starting"* ]]
}
