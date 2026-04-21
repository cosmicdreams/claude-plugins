#!/usr/bin/env zsh
# check-integration.sh <tool>
#
# Shared preflight circuit-breaker for workflow integrations.
#
# Usage:
#   check-integration.sh gws
#   check-integration.sh jira
#   check-integration.sh slack
#   check-integration.sh gh
#
# Exit 0  — integration healthy (or cache says healthy within TTL)
# Exit 1  — integration missing, unauthed, or cache says failed within TTL
#
# On failure, a human-readable reason is printed to stderr.
# On circuit-breaker open (cached failure), prefix is "integration <tool> unavailable: <reason>"

set -euo pipefail

TOOL="${1:-}"
if [[ -z "$TOOL" ]]; then
  print -u2 "Usage: check-integration.sh <tool>"
  exit 1
fi

CACHE_DIR="${HOME}/.claude/plugins/data/workflow"
CACHE_FILE="${CACHE_DIR}/integration-cache.json"
TTL=300  # 5 minutes in seconds

# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

_cache_read() {
  local tool="$1"
  [[ -f "$CACHE_FILE" ]] || return 1
  local entry
  entry=$(python3 -c "
import json, sys, time
data = json.load(open('${CACHE_FILE}'))
entry = data.get('${tool}')
if not entry:
    sys.exit(1)
age = time.time() - entry.get('ts', 0)
if age > ${TTL}:
    sys.exit(2)
print(json.dumps(entry))
" 2>/dev/null) || return $?
  echo "$entry"
}

_cache_write() {
  local tool="$1" health="$2" reason="$3"
  mkdir -p "$CACHE_DIR"
  python3 - "$tool" "$health" "$reason" "$CACHE_FILE" <<'PYEOF'
import json, sys, time, os

tool, health, reason, cache_file = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

data = {}
if os.path.exists(cache_file):
    try:
        data = json.load(open(cache_file))
    except Exception:
        data = {}

data[tool] = {"status": health, "reason": reason, "ts": time.time()}
json.dump(data, open(cache_file, "w"), indent=2)
PYEOF
}

# ---------------------------------------------------------------------------
# Auth checks per tool
# ---------------------------------------------------------------------------

_check_gws() {
  if ! command -v gws &>/dev/null; then
    echo "gws CLI not found on \$PATH — install with: brew install gws"
    return 1
  fi
  local out
  if ! out=$(gws calendar list-calendars --max-results 1 2>&1); then
    echo "gws auth failed: ${out}"
    return 1
  fi
  return 0
}

_check_jira() {
  if ! command -v jira &>/dev/null; then
    echo "jira CLI not found on \$PATH — install with: brew install jira-cli"
    return 1
  fi
  local out
  if ! out=$(jira me 2>&1); then
    echo "jira auth failed: ${out}"
    return 1
  fi
  return 0
}

_check_slack() {
  if ! command -v slack &>/dev/null; then
    echo "slack CLI not found on \$PATH"
    return 1
  fi
  local out
  if ! out=$(slack auth test 2>&1); then
    echo "slack auth failed: ${out}"
    return 1
  fi
  return 0
}

_check_gh() {
  if ! command -v gh &>/dev/null; then
    echo "gh CLI not found on \$PATH — install with: brew install gh"
    return 1
  fi
  local out
  if ! out=$(gh auth status 2>&1); then
    echo "gh auth failed: ${out}"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# 1. Check cache first
cache_entry=$(_cache_read "$TOOL") && cache_rc=$? || cache_rc=$?

if [[ $cache_rc -eq 0 ]]; then
  # Cache hit within TTL — read status
  cached_status=$(python3 -c "import json,sys; e=json.loads(sys.argv[1]); print(e['status'])" "$cache_entry")
  cached_reason=$(python3 -c "import json,sys; e=json.loads(sys.argv[1]); print(e.get('reason',''))" "$cache_entry")
  if [[ "$cached_status" == "healthy" ]]; then
    exit 0
  else
    # Circuit breaker open — skip immediately
    print -u2 "integration ${TOOL} unavailable: ${cached_reason}"
    exit 1
  fi
fi

# 2. Cache miss or expired — run preflight
reason=""
case "$TOOL" in
  gws)   reason=$(_check_gws)   && rc=0 || rc=1 ;;
  jira)  reason=$(_check_jira)  && rc=0 || rc=1 ;;
  slack) reason=$(_check_slack) && rc=0 || rc=1 ;;
  gh)    reason=$(_check_gh)    && rc=0 || rc=1 ;;
  *)
    print -u2 "Unknown tool: ${TOOL}. Supported: gws jira slack gh"
    exit 1
    ;;
esac

# 3. Write result to cache
if [[ $rc -eq 0 ]]; then
  _cache_write "$TOOL" "healthy" ""
  exit 0
else
  _cache_write "$TOOL" "failed" "$reason"
  print -u2 "integration ${TOOL} unavailable: ${reason}"
  exit 1
fi
