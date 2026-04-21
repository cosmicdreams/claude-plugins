#!/usr/bin/env bats
# Tests for workflow/scripts/check-integration.sh circuit-breaker behavior.
# All external CLIs are stubbed — no network calls.

SCRIPT="${BATS_TEST_DIRNAME}/../scripts/check-integration.sh"
CACHE_DIR="${BATS_TMPDIR}/workflow-test-cache"
CACHE_FILE="${CACHE_DIR}/integration-cache.json"

setup() {
  mkdir -p "$CACHE_DIR"
  # Override the cache location via HOME so the script uses our temp dir
  export HOME="$BATS_TMPDIR"
  mkdir -p "${HOME}/.claude/plugins/data/workflow"
  export REAL_CACHE_FILE="${HOME}/.claude/plugins/data/workflow/integration-cache.json"

  # Create a stub bin dir and prepend to PATH so external CLIs are interceptable
  export STUB_BIN="${BATS_TMPDIR}/stub-bin"
  mkdir -p "$STUB_BIN"
  export PATH="${STUB_BIN}:${PATH}"
}

teardown() {
  rm -rf "$STUB_BIN"
  rm -f "$REAL_CACHE_FILE"
}

# Helper: write a healthy cache entry with a recent timestamp
_write_healthy_cache() {
  local tool="$1"
  python3 -c "
import json, time, os
f = os.path.expanduser('~/.claude/plugins/data/workflow/integration-cache.json')
data = {}
if os.path.exists(f):
    data = json.load(open(f))
data['${tool}'] = {'status': 'healthy', 'reason': '', 'ts': time.time()}
json.dump(data, open(f, 'w'))
"
}

# Helper: write a failed cache entry with a recent timestamp
_write_failed_cache() {
  local tool="$1" reason="$2"
  python3 -c "
import json, time, os
f = os.path.expanduser('~/.claude/plugins/data/workflow/integration-cache.json')
data = {}
if os.path.exists(f):
    data = json.load(open(f))
data['${tool}'] = {'status': 'failed', 'reason': '${reason}', 'ts': time.time()}
json.dump(data, open(f, 'w'))
"
}

# Helper: write an expired cache entry (ts = now - 600s, older than 5-min TTL)
_write_expired_cache() {
  local tool="$1" status="$2" reason="$3"
  python3 -c "
import json, time, os
f = os.path.expanduser('~/.claude/plugins/data/workflow/integration-cache.json')
data = {}
if os.path.exists(f):
    data = json.load(open(f))
data['${tool}'] = {'status': '${status}', 'reason': '${reason}', 'ts': time.time() - 600}
json.dump(data, open(f, 'w'))
"
}

# ---------------------------------------------------------------------------
# (a) Cache hit — short-circuits, no CLI call made
# ---------------------------------------------------------------------------

@test "cache hit healthy: exits 0 without calling CLI" {
  _write_healthy_cache "gh"

  # Create a stub that fails if called — proves we never hit it
  cat > "${STUB_BIN}/gh" <<'EOF'
#!/usr/bin/env zsh
echo "STUB CALLED — should not reach here" >&2
exit 99
EOF
  chmod +x "${STUB_BIN}/gh"

  run "$SCRIPT" gh
  [ "$status" -eq 0 ]
}

@test "cache hit failed: exits 1 without calling CLI (circuit open)" {
  _write_failed_cache "jira" "jira auth failed: invalid credentials"

  cat > "${STUB_BIN}/jira" <<'EOF'
#!/usr/bin/env zsh
echo "STUB CALLED — should not reach here" >&2
exit 99
EOF
  chmod +x "${STUB_BIN}/jira"

  run "$SCRIPT" jira
  [ "$status" -eq 1 ]
  [[ "$output" == *"integration jira unavailable"* ]]
}

@test "cache hit failed: stderr message includes original reason" {
  _write_failed_cache "gws" "token expired"

  cat > "${STUB_BIN}/gws" <<'EOF'
#!/usr/bin/env zsh
exit 99
EOF
  chmod +x "${STUB_BIN}/gws"

  run "$SCRIPT" gws
  [ "$status" -eq 1 ]
  [[ "$output" == *"token expired"* ]]
}

# ---------------------------------------------------------------------------
# (b) Cache miss — runs preflight
# ---------------------------------------------------------------------------

@test "cache miss: runs preflight and exits 0 on success" {
  # No cache file present — stub CLI succeeds
  cat > "${STUB_BIN}/gh" <<'EOF'
#!/usr/bin/env zsh
exit 0
EOF
  chmod +x "${STUB_BIN}/gh"

  run "$SCRIPT" gh
  [ "$status" -eq 0 ]
}

@test "cache miss: runs preflight and exits 1 on auth failure" {
  cat > "${STUB_BIN}/gh" <<'EOF'
#!/usr/bin/env zsh
echo "You are not logged into any GitHub hosts" >&2
exit 1
EOF
  chmod +x "${STUB_BIN}/gh"

  run "$SCRIPT" gh
  [ "$status" -eq 1 ]
  [[ "$output" == *"integration gh unavailable"* ]]
}

@test "cache miss: runs preflight and exits 1 when CLI missing from PATH" {
  # Override PATH to a directory that has the script but no 'gws' binary.
  # We create a minimal PATH that includes system utils the script needs
  # (python3, etc.) but explicitly excludes any real gws installation.
  local safe_path="${STUB_BIN}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin"
  # gws is not placed in STUB_BIN, so it won't be found
  run env PATH="$safe_path" "$SCRIPT" gws
  [ "$status" -eq 1 ]
  [[ "$output" == *"integration gws unavailable"* ]]
}

@test "cache miss: successful preflight writes healthy entry to cache" {
  cat > "${STUB_BIN}/gh" <<'EOF'
#!/usr/bin/env zsh
exit 0
EOF
  chmod +x "${STUB_BIN}/gh"

  run "$SCRIPT" gh
  [ "$status" -eq 0 ]

  cached_status=$(python3 -c "
import json, os
f = os.path.expanduser('~/.claude/plugins/data/workflow/integration-cache.json')
data = json.load(open(f))
print(data['gh']['status'])
")
  [ "$cached_status" = "healthy" ]
}

@test "cache miss: failed preflight writes failed entry to cache" {
  cat > "${STUB_BIN}/jira" <<'EOF'
#!/usr/bin/env zsh
echo "401 Unauthorized" >&2
exit 1
EOF
  chmod +x "${STUB_BIN}/jira"

  run "$SCRIPT" jira
  [ "$status" -eq 1 ]

  cached_status=$(python3 -c "
import json, os
f = os.path.expanduser('~/.claude/plugins/data/workflow/integration-cache.json')
data = json.load(open(f))
print(data['jira']['status'])
")
  [ "$cached_status" = "failed" ]
}

# ---------------------------------------------------------------------------
# (c) Cache expiry — expired entry re-runs preflight
# ---------------------------------------------------------------------------

@test "expired healthy cache: re-runs preflight (succeeds again)" {
  _write_expired_cache "gh" "healthy" ""

  # Stub succeeds — preflight should run and re-cache
  cat > "${STUB_BIN}/gh" <<'EOF'
#!/usr/bin/env zsh
exit 0
EOF
  chmod +x "${STUB_BIN}/gh"

  run "$SCRIPT" gh
  [ "$status" -eq 0 ]
}

@test "expired failed cache: re-runs preflight (can recover)" {
  _write_expired_cache "gh" "failed" "old error"

  # Stub now succeeds — expired failure should NOT block
  cat > "${STUB_BIN}/gh" <<'EOF'
#!/usr/bin/env zsh
exit 0
EOF
  chmod +x "${STUB_BIN}/gh"

  run "$SCRIPT" gh
  [ "$status" -eq 0 ]
}

@test "expired failed cache: re-runs preflight (still fails)" {
  _write_expired_cache "gh" "failed" "old error"

  cat > "${STUB_BIN}/gh" <<'EOF'
#!/usr/bin/env zsh
echo "still broken" >&2
exit 1
EOF
  chmod +x "${STUB_BIN}/gh"

  run "$SCRIPT" gh
  [ "$status" -eq 1 ]
  [[ "$output" == *"integration gh unavailable"* ]]
}

# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

@test "unknown tool: exits 1 with helpful message" {
  run "$SCRIPT" notreal
  [ "$status" -eq 1 ]
  [[ "$output" == *"Unknown tool"* ]]
}

@test "no argument: exits 1 with usage message" {
  run "$SCRIPT"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage"* ]]
}
