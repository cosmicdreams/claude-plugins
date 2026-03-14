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
# Config check
[ -f .claude/drover-config.json ] || { echo "No drover config found. Run /drover:setup first."; exit 1; }

# DB existence check
DB_PATH=$(git rev-parse --show-toplevel 2>/dev/null)/.beads/drover.db
[ -f "$DB_PATH" ] || {
  echo "No drover board found at $DB_PATH"
  echo "Run /drover:triage first to create tickets, or /drover:setup to initialize."
  exit 1
}

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

# Resolve paths
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
DB_PATH="${PROJECT_ROOT}/.beads/drover.db"
STATE_PATH="$HOME/.claude/drover.state.jsonl"
CONFIG_PATH="${PROJECT_ROOT}/.claude/drover-config.json"

# Build args
ARGS="--db $DB_PATH"
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
