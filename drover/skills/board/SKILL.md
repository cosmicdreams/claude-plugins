---
name: board
description: >
  Human-facing drover board viewer. Shows open errors grouped by lane with severity,
  environment, trust level, and occurrence counts. Supports filtering by severity,
  environment, or lane. Use to get a quick overview of what drover has found and what
  state each fix is in.
triggers:
  - "drover:board"
  - "show drover board"
  - "show errors"
  - "what errors did drover find"
  - "drover status"
allowed-tools: Bash, Read
---

# drover:board — Error board viewer + web UI

Displays the drover Beads board. For human use: launches a web UI at http://localhost:3748 with
auto-refresh. Also prints an ASCII summary to terminal for headless/agent contexts.

## Usage

```
/drover:board [--lane <lane>] [--severity <severity>] [--env <environment>] [--all] [--web-only] [--ascii-only]
```

Options:
- `--lane ready` — filter ASCII output to a specific lane
- `--severity error` — filter ASCII output to a specific severity
- `--env production` — filter ASCII output to a specific environment
- `--all` — include lane-done and lane-closed tickets
- `--web-only` — skip ASCII output, just open browser
- `--ascii-only` — skip web server, print ASCII only

## Step 1: Pre-flight

```bash
# Config check
[ -f .claude/drover-config.json ] || { echo "No drover config found. Run /drover:setup first."; exit 1; }

# DB existence check (must be before starting server)
DB_PATH=$(git rev-parse --show-toplevel 2>/dev/null)/.beads/drover.db
[ -f "$DB_PATH" ] || {
  echo "No drover board found at $DB_PATH"
  echo "Run /drover:triage first to create tickets, or /drover:setup to initialize."
  exit 1
}
```

## Step 2: Launch web server (unless --ascii-only)

```bash
PORT=3748
PID_FILE=/tmp/drover-kanban.pid

# Find server.js
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/local/drover/*/ 2>/dev/null | tail -1)
SERVER_JS="${PLUGIN_ROOT}tools/kanban-ui/server.js"

if ! lsof -ti:$PORT > /dev/null 2>&1; then
  # Start server with absolute DB path
  node "$SERVER_JS" "$DB_PATH" &
  echo $! > "$PID_FILE"

  # Verify it started (retry up to 3s)
  for i in 1 2 3 4 5 6; do
    sleep 0.5
    lsof -ti:$PORT > /dev/null 2>&1 && break
    if [ $i -eq 6 ]; then
      echo "WARNING: kanban-ui server failed to start on port $PORT"
    fi
  done
fi

# Check port conflict (occupied by different process than our PID)
if lsof -ti:$PORT > /dev/null 2>&1; then
  OUR_PID=$(cat "$PID_FILE" 2>/dev/null || echo "")
  ACTUAL_PID=$(lsof -ti:$PORT 2>/dev/null | head -1)
  if [ -n "$OUR_PID" ] && [ "$ACTUAL_PID" != "$OUR_PID" ]; then
    echo "WARNING: Port $PORT is in use by another process (PID $ACTUAL_PID)."
    echo "Check: lsof -i:$PORT"
  fi
fi

# Open browser
open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null || true
echo "Web board: http://localhost:$PORT (auto-refresh every 30s)"
```

## Step 3: Load board (for ASCII output)

```bash
export BD_DB=.beads/drover.db
bd list -l board-drover --json --flat 2>/dev/null || echo "[]"
```

Also load the latest state for "last triage" time:
```bash
tail -1 ~/.claude/drover.state.jsonl 2>/dev/null || echo "{}"
```

## Step 4: Group and filter

Parse the JSON ticket list. Apply any CLI filters from the invocation arguments.

By default, exclude `lane-done` and `lane-closed` unless `--all` was passed.

Group remaining tickets by lane in this display order:
1. `lane-triage` — accumulating, not yet promoted
2. `lane-ready` — ready for implementation
3. `lane-implementing` — currently being fixed
4. `lane-awaiting-review` — fix complete, needs human review
5. `lane-done` — (only shown with --all)
6. `lane-closed` — (only shown with --all)

## Step 5: Format output

```python
import json, sys, re, collections
from datetime import datetime, timezone

tickets = json.loads(sys.stdin.read())
# ... group by lane, format each ticket ...
```

For each ticket, extract from its body:
- `fp` hash (from `**Fingerprint:** \`{hash}\`` line)
- First seen / Last seen timestamps
- Total occurrences
- Environments line
- Effective trust

Format each ticket as one line:
```
  [{severity_icon}] {title[:65]}
      fp:{fp} | {total_occurrences}x | {environments_short} | {age}
```

Severity icons:
- `emergency` → `🚨`
- `critical` → `🔴`
- `alert` → `🟠`
- `error` → `🟡`
- `warning` → `🔵`
- `notice`/`info`/`debug` → `⚪`

Age: time since **First seen** — e.g. `2h ago`, `3d ago`

Environments short: e.g. `local(3) prod(7)` — name and occurrence count parsed from
the **Environments:** line in the ticket body.

## Step 6: Render board

```
━━━ drover board — {project} ━━━━━━━━━━━━━━━━━━━━━━━━
Last triage: {N} min ago  |  Open: {N}  |  Ready: {N}  |  In-flight: {N}

── LANE-TRIAGE ({N}) ─────────────────────────────────
  [🟡] [php] PDOException: SQLSTATE[HY000] General error...
       fp:a3f2b1c4d5e6 | 3x | local(3) | 2h ago

── LANE-READY ({N}) ──────────────────────────────────
  [🔴] [php] TypeError: Cannot access offset on value of type null
       fp:b4c3d2e1f0a9 | 8x | prod(8) | 1d ago

── LANE-IMPLEMENTING ({N}) ───────────────────────────
  (none)

── LANE-AWAITING-REVIEW ({N}) ────────────────────────
  [🟡] [javascript] Uncaught ReferenceError: myModule is not defined
       fp:c5d4e3f2a1b0 | 2x | prod(2) | 3d ago
       Worktree: worktrees/drover-c5d4e3f2a1b0/
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

For tickets in `lane-awaiting-review`, also extract and display the worktree path
from the ## Merge Case section if present.

If a lane is empty: show `  (none)` rather than omitting the lane header entirely.

## Filtering output

When filters are applied, show only the matching tickets and prepend:
```
(filtered: --severity error --env production)
```

## Summary line commands

After the board, print available commands:
```
Commands:
  /drover:watch        — start/run triage loop
  /drover:implement    — process one lane-ready ticket
  /drover:setup        — reconfigure

To review a fix:
  git diff worktrees/drover-{fp}/ worktrees/main/
  cd worktrees/drover-{fp}/ && git log --oneline
```
