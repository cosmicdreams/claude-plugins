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

@test "Acquia env blocks are discovered from site.yml ac-site/ac-env keys" {
  make_project "$TMP/pncb" "pncb-main"
  mkdir -p "$TMP/pncb/drush/sites"
  cat > "$TMP/pncb/drush/sites/pncb.site.yml" <<EOF
dev:
  uri: dev.example.org
  ac-site: pncb
  ac-env: dev
prod:
  uri: www.example.org
  ac-site: pncb
  ac-env: prod
local:
  uri: 'http://pncb.ddev.site'
EOF
  run "$SCRIPT" "$TMP/pncb"
  [ "$status" -eq 0 ]
  python3 -c "
import json,os
d = json.load(open(os.environ['DROVER_PROJECTS_FILE']))
envs = d[0]['acquia']['environments']
aliases = sorted(e['alias'] for e in envs)
assert aliases == ['pncb.dev', 'pncb.prod'], aliases
"
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

@test "Acquia envs are deduped when multiple drush alias files point to the same app/env" {
  # Regression for sprint-7gj. The pncb project in the wild has two drush
  # alias files (pncb.site.yml + ipn.site.yml) that each declare the same
  # three Acquia envs (dev/prod/test). Previously add-project appended an
  # environments[] entry per alias-file per env, producing 6 duplicate env
  # entries — which doubled the umbrella's Acquia watcher fire rate.
  make_project "$TMP/pncb" "pncb-main"
  mkdir -p "$TMP/pncb/drush/sites"
  cat > "$TMP/pncb/drush/sites/pncb.site.yml" <<EOF
dev:
  uri: dev.example.org
  ac-site: pncb
  ac-env: dev
prod:
  uri: www.example.org
  ac-site: pncb
  ac-env: prod
test:
  uri: stage.example.org
  ac-site: pncb
  ac-env: test
EOF
  cat > "$TMP/pncb/drush/sites/ipn.site.yml" <<EOF
dev:
  uri: dev.example.org
  ac-site: pncb
  ac-env: dev
prod:
  uri: www.example.org
  ac-site: pncb
  ac-env: prod
test:
  uri: stage.example.org
  ac-site: pncb
  ac-env: test
EOF
  run "$SCRIPT" "$TMP/pncb"
  [ "$status" -eq 0 ]
  python3 -c "
import json, os
d = json.load(open(os.environ['DROVER_PROJECTS_FILE']))
envs = d[0]['acquia']['environments']
aliases = [e['alias'] for e in envs]
assert sorted(aliases) == ['pncb.dev', 'pncb.prod', 'pncb.test'], f'expected 3 unique envs, got {aliases}'
# Each unique env should merge its drush_aliases (both @pncb and @ipn pointed to it).
dev = next(e for e in envs if e['alias'] == 'pncb.dev')
# Either aliases stored as a list, or the first alias was kept — both are
# acceptable outcomes. Just require the env entry is not duplicated.
"
}

@test "corrupt projects file returns error" {
  make_project "$TMP/site4" "site4-main"
  echo "not json" > "$DROVER_PROJECTS_FILE"
  run "$SCRIPT" "$TMP/site4"
  [ "$status" -eq 1 ]
  [[ "$output" == *"corrupt"* ]]
}
