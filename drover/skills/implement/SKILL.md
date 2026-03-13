---
name: implement
description: >
  Drover's autonomous fix pipeline. Checks the drover board for tickets in lane-ready,
  selects the highest-priority unassigned ticket, and spawns drover:implementer-agent to
  create a worktree and implement the fix. Designed to run on a /loop 30m schedule.
  Safe to call manually to process one ticket.
triggers:
  - "drover:implement"
  - "implement fixes"
  - "fix errors"
  - "process ready tickets"
allowed-tools: Bash, Read, Write, Agent
---

# drover:implement — Autonomous fix pipeline

Processes one `lane-ready` ticket per invocation: claims it, spawns an implementer agent,
and waits for the fix to complete.

Designed to run via `/loop 30m /drover:implement`. Cancel with `CronDelete`.

## Step 1: Pre-flight checks

```bash
[ -f .claude/drover-config.json ] || { echo "drover not configured. Run /drover:setup first."; exit 1; }
[ -f .beads/drover.db ] || { echo "Drover board not initialized. Run /drover:setup first."; exit 1; }
```

Check enabled:
```bash
python3 -c "
import json
cfg = json.load(open('.claude/drover-config.json'))
if not cfg.get('enabled', True):
    print('DISABLED')
"
```

## Step 2: Find highest-priority ready ticket

```bash
export BD_DB=.beads/drover.db
bd list -l board-drover -l lane-ready --json --unassigned 2>/dev/null || echo "[]"
```

If the result is empty: print "drover:implement — no lane-ready tickets. Nothing to do." and stop.

Priority ordering (pick the first match in this order):
1. `severity-emergency`
2. `severity-critical`
3. `severity-alert`
4. `severity-error`
5. `severity-warning`

Within the same severity: oldest first (lowest ticket ID or earliest `first_seen` in body).

Select the single highest-priority ticket.

## Step 3: Validate git state

Before spawning the implementer, verify we're at the project root with a clean git state:

```bash
ls worktrees/main/.git > /dev/null 2>&1 || { echo "ERROR: Not at project root (worktrees/main/.git not found)"; exit 1; }

# Check for stale drover worktrees for this fingerprint
TICKET_BODY="$(bd get {TICKET_ID} --db .beads/drover.db --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('body',''))")"
FP=$(echo "$TICKET_BODY" | python3 -c "
import sys, re
body = sys.stdin.read()
m = re.search(r'\"fp\":\s*\"([a-f0-9]{12})\"', body)
print(m.group(1) if m else '')
")

if [ -n "$FP" ]; then
  WORKTREE_PATH="worktrees/drover-${FP}"
  if [ -d "$WORKTREE_PATH" ]; then
    echo "WARNING: Worktree already exists at $WORKTREE_PATH — may be resuming previous attempt"
  fi
fi
```

## Step 4: Spawn implementer agent

Build the implementer prompt:

```
export BD_DB=.beads/drover.db
export BD_ACTOR=implementer-agent

TICKET_ID: {selected_ticket_id}
TICKET_BODY: {full_ticket_body}
CONFIG: {full_drover_config_json}

Follow the drover:implementer-agent protocol to claim this ticket, create the worktree,
implement the fix, run quality checks, write the merge case, and move to lane-awaiting-review.
```

Spawn the agent and wait for it to complete.

## Step 5: Output result

After the agent completes, query the ticket status:

```bash
bd get {TICKET_ID} --db .beads/drover.db --json 2>/dev/null | python3 -c "
import json,sys
t=json.load(sys.stdin)
labels=t.get('labels',[])
lane=[l for l in labels if l.startswith('lane-')]
print(lane[0] if lane else 'unknown')
"
```

Output:
```
drover:implement complete
  Ticket:   {TICKET_ID} — {ticket_title[:60]}
  Result:   {lane_status}
  Worktree: worktrees/drover-{fp}/  (if created)

Next lane-ready tickets: {N remaining}
```

## Running on a loop

```
/loop 30m /drover:implement
```

This processes one ticket per 30-minute cycle. If you have a backlog,
run `/drover:implement` multiple times manually to drain it faster,
or reduce the interval temporarily: `/loop 5m /drover:implement`.

Cancel with `CronDelete` using the job ID returned by `/loop`.
