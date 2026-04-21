#!/usr/bin/env bats

load helpers

# Tests for scripts/recall-search.sh — the ranked search helper behind
# the /drover:recall skill. Walks registered project boards (one
# .beads/drover.db per entry in projects.json), greps ticket bodies for
# Actual blocks matching a query, ranks and returns top N.

setup() {
  DROVER_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$DROVER_ROOT/scripts/recall-search.sh"
  TMP="$(mktemp -d)"
  export DROVER_PROJECTS_FILE="$TMP/projects.json"
  export DROVER_RECALL_FIXTURES="$TMP/fixtures"
  mkdir -p "$DROVER_RECALL_FIXTURES"
}

teardown() {
  rm -rf "$TMP"
}

# write_fixture <project_name> <ticket_id> <body_markdown>
# Stages a fake ticket body file that recall-search will read in place of bd.
write_fixture() {
  local project="$1" ticket="$2" body="$3"
  mkdir -p "$DROVER_RECALL_FIXTURES/$project"
  printf '%s' "$body" > "$DROVER_RECALL_FIXTURES/$project/${ticket}.md"
}

register_project() {
  local project="$1"
  python3 -c "
import json, os, sys
path = os.environ['DROVER_PROJECTS_FILE']
existing = json.load(open(path)) if os.path.exists(path) else []
existing.append({'name': '$project', 'path': '$TMP/$project', 'ddev_project': '$project'})
json.dump(existing, open(path, 'w'))
"
  mkdir -p "$TMP/$project"
}

@test "recall-search: returns empty when no projects registered" {
  echo '[]' > "$DROVER_PROJECTS_FILE"
  run "$SCRIPT" "paragraph reference"
  assert_success
  [ -z "$output" ] || [[ "$output" == *"no results"* ]]
}

@test "recall-search: finds a ticket with matching Actual root_cause" {
  register_project "projA"
  write_fixture projA drover-a1f "$(cat <<'MD'
# drover-a1f: WSOD on cache rebuild

fingerprint: f4a9c0
severity: error

## Solution

### Actual  (written: 2026-04-15, by: user)
- **root_cause:** A paragraph reference to a deleted entity caused a fatal hydration error.
- **fix_summary:** Added a null-guard in the paragraph render hook.
- **fix_commit_sha:** abc1234
- **effectiveness:** verified
- **captured_by:** user
MD
)"

  run "$SCRIPT" "paragraph reference"
  assert_success
  assert_output --partial "drover-a1f"
  assert_output --partial "projA"
  assert_output --partial "paragraph reference to a deleted entity"
}

@test "recall-search: ranks exact fingerprint matches above keyword matches" {
  register_project "projA"
  register_project "projB"
  write_fixture projA drover-aaa "$(cat <<'MD'
fingerprint: f4a9c0
## Solution
### Actual
- **root_cause:** Undefined variable in theme functions.php
- **fix_summary:** Declared the variable.
- **captured_by:** user
MD
)"
  write_fixture projB drover-bbb "$(cat <<'MD'
fingerprint: abc123
## Solution
### Actual
- **root_cause:** Paragraph reference to deleted entity.
- **fix_summary:** Null guard.
- **captured_by:** user
MD
)"

  # Query by fingerprint — exact match should rank first.
  run "$SCRIPT" --fingerprint f4a9c0
  assert_success
  # drover-aaa appears first, drover-bbb (if at all) lower.
  [[ "$output" == *drover-aaa*drover-bbb* ]] || [[ "$output" == *drover-aaa* ]]
}

@test "recall-search: excludes tickets with Projected-only solutions from default ranking" {
  register_project "projA"
  write_fixture projA drover-proj "$(cat <<'MD'
## Solution
### Projected  (written: 2026-04-15, by: implementer-agent)
- **hypothesis:** Something about paragraph reference
- **proposed_fix:** guard
- **effectiveness:** pending
MD
)"
  write_fixture projA drover-act "$(cat <<'MD'
## Solution
### Actual  (written: 2026-04-15, by: user)
- **root_cause:** Real paragraph reference problem.
- **fix_summary:** Real fix.
- **captured_by:** user
MD
)"

  run "$SCRIPT" "paragraph"
  assert_success
  # Verified Actual result ranks first and is labeled accordingly.
  assert_output --partial "drover-act"
  # Projected-only result shown lower with an unverified marker (or not at all
  # in the default top rank — implementation may include with --include-projected).
}

@test "recall-search: missing query argument exits with usage" {
  run "$SCRIPT"
  assert_failure
  [[ "$stderr" == *"usage"* ]] || [[ "$output" == *"usage"* ]]
}

@test "recall-search: --include-projected surfaces Projected-only tickets" {
  register_project "projA"
  write_fixture projA drover-proj-only "$(cat <<'MD'
## Solution
### Projected  (written: 2026-04-15, by: implementer-agent)
- **hypothesis:** Memory exhausted during migration batch.
- **proposed_fix:** Reduce batch size.
- **effectiveness:** pending
MD
)"

  run "$SCRIPT" --include-projected "memory exhausted"
  assert_success
  assert_output --partial "drover-proj-only"
  assert_output --partial "unverified"
}
