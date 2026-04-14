#!/usr/bin/env bats

# Tests for scripts/add-project.sh — uses DROVER_PROJECTS_FILE to redirect state.

setup() {
  DROVER_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$DROVER_ROOT/scripts/add-project.sh"
  TMP="$(mktemp -d)"
  export DROVER_PROJECTS_FILE="$TMP/projects.json"
}

teardown() {
  rm -rf "$TMP"
}

make_project() {
  local dir="$1" name="$2"
  mkdir -p "$dir/.ddev"
  cat > "$dir/.ddev/config.yaml" <<EOF
name: $name
type: drupal11
docroot: web
php_version: "8.3"
EOF
}

@test "missing path argument is an error" {
  run "$SCRIPT"
  [ "$status" -eq 1 ]
  [[ "$output" == *'"status":"error"'* ]]
  [[ "$output" == *"missing path"* ]]
}

@test "non-existent path is an error" {
  run "$SCRIPT" "$TMP/does-not-exist"
  [ "$status" -eq 1 ]
  [[ "$output" == *'"status":"error"'* ]]
  [[ "$output" == *"not a directory"* ]]
}

@test "path without .ddev/config.yaml is an error" {
  mkdir -p "$TMP/plain"
  run "$SCRIPT" "$TMP/plain"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no .ddev"* ]]
}

@test "valid project registers and writes projects.json" {
  make_project "$TMP/site1" "site1-main"
  run "$SCRIPT" "$TMP/site1"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"status":"added"'* ]]
  [[ "$output" == *'"name":"site1-main"'* ]]
  [ -f "$DROVER_PROJECTS_FILE" ]
  grep -q "site1-main" "$DROVER_PROJECTS_FILE"
  grep -q '"ddev_type": "drupal11"' "$DROVER_PROJECTS_FILE"
}

@test "duplicate add is idempotent (status exists)" {
  make_project "$TMP/site2" "site2-main"
  "$SCRIPT" "$TMP/site2" > /dev/null
  run "$SCRIPT" "$TMP/site2"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"status":"exists"'* ]]
  # File should still have exactly one entry total.
  count="$(python3 -c "import json,os; print(len(json.load(open(os.environ['DROVER_PROJECTS_FILE']))))")"
  [ "$count" = "1" ]
}

@test "drush aliases are captured when present" {
  make_project "$TMP/site3" "site3-main"
  mkdir -p "$TMP/site3/drush/sites"
  : > "$TMP/site3/drush/sites/prod.site.yml"
  : > "$TMP/site3/drush/sites/stage.site.yml"
  run "$SCRIPT" "$TMP/site3"
  [ "$status" -eq 0 ]
  grep -q '"prod"' "$DROVER_PROJECTS_FILE"
  grep -q '"stage"' "$DROVER_PROJECTS_FILE"
}

@test "config.yaml missing name is an error" {
  mkdir -p "$TMP/bad/.ddev"
  cat > "$TMP/bad/.ddev/config.yaml" <<EOF
type: drupal11
docroot: web
EOF
  run "$SCRIPT" "$TMP/bad"
  [ "$status" -eq 1 ]
  [[ "$output" == *"missing name"* ]]
}

@test "two different projects both register" {
  make_project "$TMP/a" "a-main"
  make_project "$TMP/b" "b-main"
  "$SCRIPT" "$TMP/a" > /dev/null
  "$SCRIPT" "$TMP/b" > /dev/null
  count="$(python3 -c "import json,os; print(len(json.load(open(os.environ['DROVER_PROJECTS_FILE']))))")"
  [ "$count" = "2" ]
}

@test "corrupt projects file returns error" {
  make_project "$TMP/site4" "site4-main"
  echo "not json" > "$DROVER_PROJECTS_FILE"
  run "$SCRIPT" "$TMP/site4"
  [ "$status" -eq 1 ]
  [[ "$output" == *"corrupt"* ]]
}
