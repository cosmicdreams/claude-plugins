#!/usr/bin/env bash
# drover/scripts/verify-deps.sh
# Checks that all required tools are available for drover:watch.
# Accumulates all failures before reporting — shows every missing dep in one pass.
#
# Usage: verify-deps.sh [no-acquia]
#   no-acquia — skip Acquia CLI check (use when no Acquia environments configured)
#
# Exit 0 = all required deps present
# Exit 1 = at least one required dep missing

set -u

FAILURES=""

add_failure() {
  FAILURES+="$1"$'\n'
}

# 1) bd (Beads CLI) — required
if ! command -v bd >/dev/null 2>&1; then
  add_failure "bd (Beads CLI) not found. Install: brew install beads"
fi

# 2) python3 — required
if ! command -v python3 >/dev/null 2>&1; then
  add_failure "python3 not found. Install: brew install python3"
fi

# 3) Node.js >= 18 — required for kanban-ui; numeric comparison
NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')
if [[ -z "${NODE_MAJOR:-}" ]]; then
  add_failure "Node.js not found (required for /drover:board). Install Node.js 18+: brew install node"
elif ! [[ "$NODE_MAJOR" -ge 18 ]]; then
  add_failure "Node.js 18+ required for /drover:board (found: $(node --version)). Upgrade: brew upgrade node"
fi

# 4) .claude/drover-config.json — required
if [[ ! -f .claude/drover-config.json ]]; then
  add_failure ".claude/drover-config.json not found. Run /drover:setup first."
fi

# 5) .beads/drover.db — required
if [[ ! -e .beads/drover.db ]]; then
  add_failure ".beads/drover.db not found. Run /drover:setup first."
fi

# 6) Acquia API credentials — checked only if Acquia envs are configured (skip with 'no-acquia')
#    Credentials stored in ~/.acquia/cloud_api.conf (API key + secret).
#    Run /drover:setup to configure, or create manually.
if [[ "${1:-}" != "no-acquia" ]]; then
  HAS_ACQUIA=$(python3 -c "
import json, sys
try:
    cfg = json.load(open('.claude/drover-config.json'))
    envs = [e for e in cfg.get('environments', []) if e.get('type') == 'acquia']
    print('yes' if envs else 'no')
except Exception:
    print('no')
" 2>/dev/null || echo "no")

  if [[ "$HAS_ACQUIA" == "yes" ]]; then
    if [[ ! -f "$HOME/.acquia/cloud_api.conf" ]]; then
      add_failure "Acquia API credentials not found at ~/.acquia/cloud_api.conf. Run /drover:setup to configure."
    else
      CRED_OK=$(python3 -c "
import json, sys
try:
    c = json.load(open('$HOME/.acquia/cloud_api.conf'))
    k = c.get('acli_key','')
    s = c.get('keys',{}).get(k,{}).get('secret','')
    print('yes' if k and s else 'no')
except: print('no')
" 2>/dev/null || echo "no")
      if [[ "$CRED_OK" != "yes" ]]; then
        add_failure "Acquia credentials file exists but is missing key or secret. Run /drover:setup to reconfigure."
      fi
    fi
  fi
fi

# 7) websockets (Python) — required for Acquia logstream
if [[ "${HAS_ACQUIA:-no}" == "yes" ]]; then
  if ! python3 -c "import websockets" 2>/dev/null; then
    add_failure "Python 'websockets' package not found (required for Acquia log streaming). Install: pip install websockets"
  fi
fi

# 8) gws slack — warning only (non-fatal: Slack notify is optional)
if ! command -v gws >/dev/null 2>&1; then
  echo "WARNING: gws (Google Workspace CLI) not found — Slack notifications will be skipped." >&2
fi

# Report and exit
if [[ -n "$FAILURES" ]]; then
  echo "drover dependency check FAILED:" >&2
  while IFS= read -r line; do
    [[ -n "$line" ]] && echo "  ✗ $line" >&2
  done <<<"$FAILURES"
  echo "Run the above installations and retry." >&2
  exit 1
fi

echo "drover dependency check OK"
exit 0
