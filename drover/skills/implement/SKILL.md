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
allowed-tools: Bash, Read, Write, Agent, TeamCreate, TeamDelete, SendMessage
---

# drover:implement — Autonomous fix pipeline

Processes one `lane-ready` ticket per invocation: claims it, spawns an implementer agent,
and waits for the fix to complete.

> **Note (1.8.0+):** Live error *detection* moved from `/loop 3m /drover:watch`
> to the umbrella monitor. `drover:implement` is the last remaining
> `/loop`-driven skill in the pipeline. A future pass will convert it to a
> monitor that arms on `lane-ready` ticket transitions, removing the last
> time-based cadence.

Designed to run via `/loop 30m /drover:implement`. Cancel with `CronDelete`.

## Step 1: Pre-flight checks

```bash
[ -f .claude/drover-config.json ] || { echo "drover not configured. Run /drover:setup first."; exit 1; }
[ -d .beads/drover.db ] || { echo "Drover board not initialized. Run /drover:setup first."; exit 1; }
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
bd list -l board-drover -l lane-ready --json --flat --no-assignee 2>/dev/null || echo "[]"
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
TICKET_BODY="$(bd show {TICKET_ID} --db .beads/drover.db --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('body',''))")"
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

## Step 4: Create agent team and spawn implementer

Create an agent team before spawning any agents — this gives the implementer a shared
communication channel so it can report back while working:

```
TeamCreate(
  team_name = "drover-implement-{fp}",
  description = "Implementing fix for drover ticket {TICKET_ID}: {ticket_title}"
)
```

Build the implementer prompt:

```
Your name is implementer-agent. You are part of team "drover-implement-{fp}".

export BD_DB=.beads/drover.db
export BD_ACTOR=implementer-agent

TICKET_ID: {selected_ticket_id}
TICKET_BODY: {full_ticket_body}
CONFIG: {full_drover_config_json}

Follow the drover:implementer-agent protocol to claim this ticket, create the worktree,
implement the fix, run quality checks, write the merge case, and move to lane-awaiting-review.

When complete, send a final status message to team-lead:
  SendMessage(type="message", recipient="team-lead", content="Done: {TICKET_ID} → {lane_status}")
```

Spawn the agent into the team and wait for its completion message:

```
Agent(
  subagent_type = "drover:implementer-agent",
  team_name     = "drover-implement-{fp}",
  name          = "implementer-agent",
  prompt        = {above prompt}
)
```

After the agent sends its completion message, send a shutdown request and delete the team:
```
SendMessage(type="shutdown_request", recipient="implementer-agent", content="Work complete. Shut down.")
```

```
TeamDelete(team_name="drover-implement-{fp}")
```

## Step 5: Output result

After the agent completes, query the ticket status:

```bash
bd show {TICKET_ID} --db .beads/drover.db --json 2>/dev/null | python3 -c "
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
