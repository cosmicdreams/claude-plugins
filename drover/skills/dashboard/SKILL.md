---
name: dashboard
description: >
  Launches the drover ops dashboard — a Datadog/Splunk-style observability UI at
  http://localhost:3749. Shows environment health tiles, error volume timeline,
  triage cycle stats, filterable error table with expandable stack traces, and a
  full kanban board view with drag-and-drop and ticket modals. Live-updates via
  SSE when the board or state file changes.
triggers:
  - "drover:dashboard"
  - "open drover dashboard"
  - "show dashboard"
  - "drover ops"
  - "observability dashboard"
allowed-tools: Bash, Read
---

# drover:dashboard — Ops observability dashboard

Launches a zero-dependency Node.js server at http://localhost:3749 serving a
Datadog/Splunk-style dashboard for the drover error monitoring pipeline.

Two views:
- **Dashboard** — environment health tiles, error volume sparkline chart, last
  triage cycle stats, filterable/searchable error table with expandable rows
- **Board** — kanban columns with drag-and-drop, card modals, advance buttons

Live updates via Server-Sent Events — no polling, no page refresh.

## Step 1: Pre-flight

```bash
# Config check — this project's drover-config.json gives the server ddev
# and acquia context. Not required in virtual-central mode but strongly
# recommended; a running dashboard with no config is a flat board view.
[ -f .claude/drover-config.json ] || echo "Note: no .claude/drover-config.json in cwd — dashboard will still run in virtual-central mode across all registered projects."

# projects.json determines which boards are visible in virtual-central
# mode. If it's empty, the dashboard will show nothing until you run
# /drover:add-project for at least one project.
PROJECTS_FILE="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/drover-fallback}/projects.json"

# Node.js version check
NODE_VER=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
[ "${NODE_VER:-0}" -ge 18 ] || {
  echo "Node.js >= 18 required. Current: $(node --version 2>/dev/null || echo 'not found')"
  exit 1
}
```

## Step 2: Kill existing process on port 3749

```bash
PORT=3749
if lsof -ti:$PORT > /dev/null 2>&1; then
  echo "Killing existing process on port $PORT..."
  kill $(lsof -ti:$PORT) 2>/dev/null || true
  sleep 0.5
fi
```

## Step 3: Launch server

```bash
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/local/drover/*/ 2>/dev/null | tail -1)
SERVER_JS="${PLUGIN_ROOT}tools/dashboard/server.js"

# Default to virtual-central mode: dashboard merges cards from every
# registered project's .beads/drover.db and fans out file watchers so
# updates from any project show up in real time regardless of which
# directory the user invoked /drover:dashboard from.
#
# Single-project mode precedence (highest first):
#   1. DROVER_DB_OVERRIDE — explicit path override
#   2. dashboard.db_path   in the nearest .claude/drover-config.json
#   3. --all-projects      (virtual-central)
#
# sprint-06p: we no longer rely on `git rev-parse --show-toplevel` to
# discover drover-config.json because in worktree-style layouts the same
# project has multiple .beads/ directories — the git root pointed at one
# (AHRI repo root = 37 cards) while the user was cd'd in a worktree
# (worktrees/main = 2 cards), producing inconsistent dashboards.
# Instead walk up from $PWD looking for the first .claude/drover-config.json.
PROJECT_ROOT=$(python3 - <<'PY'
import os, sys
cur = os.getcwd()
for _ in range(8):
    cfg = os.path.join(cur, '.claude', 'drover-config.json')
    if os.path.isfile(cfg):
        print(cur); sys.exit(0)
    parent = os.path.dirname(cur)
    if parent == cur:
        break
    cur = parent
print(os.getcwd())
PY
)
STATE_PATH="$HOME/.claude/drover.state.jsonl"
CONFIG_PATH="${PROJECT_ROOT}/.claude/drover-config.json"

# Resolve db_path from config (if present) — relative paths are resolved
# against PROJECT_ROOT so a config value of ".beads/drover.db" works.
CONFIG_DB_PATH=""
if [ -f "$CONFIG_PATH" ]; then
  CONFIG_DB_PATH=$(python3 - "$CONFIG_PATH" "$PROJECT_ROOT" <<'PY'
import json, os, sys
try:
    cfg = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
p = (cfg.get('dashboard') or {}).get('db_path') or ''
if not p:
    sys.exit(0)
if not os.path.isabs(p):
    p = os.path.join(sys.argv[2], p)
if os.path.exists(p):
    print(p)
PY
)
fi

if [ -n "${DROVER_DB_OVERRIDE:-}" ]; then
  ARGS="--db $DROVER_DB_OVERRIDE"
elif [ -n "$CONFIG_DB_PATH" ]; then
  ARGS="--db $CONFIG_DB_PATH"
else
  ARGS="--all-projects"
fi
[ -f "$STATE_PATH" ] && ARGS="$ARGS --state $STATE_PATH"
[ -f "$CONFIG_PATH" ] && ARGS="$ARGS --config $CONFIG_PATH"

# Launch in background
node "$SERVER_JS" $ARGS &
PID=$!
echo $PID > /tmp/drover-dashboard.pid
```

## Step 4: Wait for startup

```bash
for i in 1 2 3 4 5 6; do
  sleep 0.5
  if lsof -ti:3749 > /dev/null 2>&1; then
    break
  fi
  if [ $i -eq 6 ]; then
    echo "WARNING: dashboard server failed to start on port 3749"
  fi
done
```

## Step 5: Open browser

```bash
open "http://localhost:3749" 2>/dev/null || xdg-open "http://localhost:3749" 2>/dev/null || true
echo "Dashboard: http://localhost:3749 (live via SSE)"
echo "PID: $(cat /tmp/drover-dashboard.pid 2>/dev/null)"
```

## Stopping the server

```bash
kill $(cat /tmp/drover-dashboard.pid 2>/dev/null) 2>/dev/null || kill $(lsof -ti:3749) 2>/dev/null
```
