---
name: run
description: >
  Executes a team sprint using the vertical slice model: spawns parallel slice-workers that each own
  an issue end-to-end (analyze, implement, test, validate), with optional cross-review.
  Use when the user wants to START EXECUTING work — agents are being spawned, cards are being
  worked, and the pipeline is actively running. Trigger phrases: "run a team sprint", "spin up
  agents", "work on these issues as a team", "team validate these patches", "start the sprint",
  "let's kick off the pipeline", "run these issues in parallel".
  Do NOT use for: deciding which issues to tackle or sequencing the backlog (use sprint:plan),
  reading board state only
  (sprint:board), or running a retrospective (retro:session).
  Key distinction from sprint:plan — sprint:run EXECUTES; sprint:plan DECIDES. If the user
  is asking "what should we work on?" or "prioritize these issues" → sprint:plan. If the user
  is asking "do the work" or "start the agents" → sprint:run.
---

# Team Sprint

Orchestrate multiple agents working on multiple Drupal issues using the vertical slice model. One agent per issue, end-to-end. No handoffs.

Board state lives in `.beads/sprint.db` (Beads database). Cards are Beads issues with status (`open`, `in_progress`, `closed`) and lane labels (`lane-backlog`, `lane-in-progress`, etc.). Agents coordinate via the pull protocol and communicate via `../protocols/team-comms-protocol.md`.

## Context Awareness
**Important**: All relative paths (e.g. `./worktrees/...`) assume you are executing from the **Project Root** (e.g. `~/OpenSource/SAME_PAGE_PREVIEW`).
- The Project Root is the folder that *contains* the `worktrees/` and `.beads/` directories.
- If you are inside a worktree (e.g. `.../worktrees/1234`), you must `cd ../..` to return to the Project Root before running commands.

### Card Structure

See `sprint:board` for lane definitions, card fields, status mapping, and narrative rules. Cards are created with `bd create`:

```bash
bd create "Issue #2901667: jQuery removal in toggleEditMode" \
  --prefix sprint \
  -p 2 -t task \
  --labels "board-sprint,lane-backlog,issue-2901667,cross-review-yes" \
  --description "$(cat <<'EOF'
## Phase Checklist
- [ ] Analyzed — root cause identified
- [ ] Implemented — fix written in worktree
- [ ] Tests written — failing test first, then passing
- [ ] phpcs/phpstan — clean
- [ ] phpunit — passing

## Issue
- d.o link: https://www.drupal.org/project/drupal/issues/2901667
- Module: settings_tray

## What to change
- File: core/modules/settings_tray/js/settings_tray.js
  - Remove jQuery dependency from toggleEditMode function

## What NOT to change
- Do not modify the PHP side of Settings Tray

## Acceptance Criteria
- AC-1: Given the toggleEditMode function, When it is called, Then it uses native JS instead of jQuery
- AC-2: Given all existing tests, When phpunit runs, Then all tests pass

## Narrative
- 2026-03-18: Card created. (by @team-lead)
EOF
)"
```


## Prerequisites

Launch this session before invoking sprint:run:

```bash
claude --dangerously-skip-permissions --agent team-lead
```

- `--agent team-lead` gives the main thread the team-lead agent identity and tools list (TeamCreate, CronCreate, CronDelete, CronList, Agent, Skill, and all coordination tools). Without this flag, the main thread has no defined tools list and may silently lack required tools.
- `--dangerously-skip-permissions` enables unattended pipeline operation. Safety boundary is the agent definition's tools list — keep it narrow and well-audited.

## Sprint Workflow

### Step 0: Pre-Sprint Planning (recommended)

Run the `sprint:plan` skill before creating cards if you have a list of issues to prioritize. It checks for existing analysis reports, sequences issues by dependencies and complexity, and assesses cross-review need. Saves you from discovering mid-sprint that issues are misordered.

### Step 1: Create Team + Pre-flight Check

**First — create the team. This is mandatory before spawning any agents.**

Agents spawned without a team cannot receive `SendMessage` and will go permanently idle after their first turn.

```
TeamCreate(team_name="<project>-sprint-<N>", description="Session N sprint")
```

**Second — create the sprint retrospective folder** using the date and team name as the sprint ID:

```bash
mkdir -p "analysis-reports/retro-session/$(date '+%Y-%m-%d')+<team-name>/interviews"
```

**Third — initialize the Beads database (if not already present):**

```bash
bd init --prefix sprint
```

**Fourth — pre-flight checks:**

```bash
# Check DDEV health (active instances only; timeout prevents hang)
timeout 10 ddev list -A 2>/dev/null && echo "DDEV healthy" || echo "DDEV unhealthy -- slice-workers can still do analysis + implementation, just not phpunit"

# Check existing worktrees
ls ./worktrees/

# Check for existing board state
bd ready --json 2>/dev/null || echo "Empty board -- will create cards"
```

Resolve before proceeding:
- DDEV unhealthy → slice-workers can still analyze and implement, but skip phpunit; note in spawn prompts
- 3+ DDEV instances running → stop unused ones
- No `.beads/` directory → run `bd init --prefix sprint`

### Step 2: Create Cards (team-lead only)

The team-lead creates and manages all cards. **One card per issue.**

```bash
bd create "Issue #2901667: jQuery removal in toggleEditMode" \
  --prefix sprint \
  -p 2 -t task \
  --labels "board-sprint,lane-backlog,issue-2901667,cross-review-yes" \
  --description "<card body with phase checklist, issue details, ACs>"
```

Dependencies are between **issues** only (not phases). Use `--deps` when issue B genuinely depends on issue A's code changes.

### Step 3: Team Sizing and Agent Spawning

### You Are the Team Lead

When you invoke this skill, YOU run the team-lead function. Do not spawn a team-lead agent.

TEAM-LEAD LOOP (run every turn):
1. TaskList → who has no in_progress task right now?
2. Scan the board: `bd ready --json --unassigned` for available work. For in-progress: `bd list -s in_progress --json`.
3. Match idle agents to available cards → SendMessage with task assignment (card ID only) immediately
4. If an agent has no remaining cards → run GRACEFUL SHUTDOWN SEQUENCE (see below)
   ⚠ Exception: process-engineer stays alive until ALL sprint work is done (Step 7). Do not shut it down mid-sprint.
5. If an agent is unresponsive 2+ turns → reassign or replace (does NOT apply to process-engineer)

**Card Summary Format** — the lightweight summary team-lead builds from bd output for orchestration decisions:
```
{id} | {title} | {lane-label} | {assignee} | {deps}
```

**Board scan** — use bd to query card metadata without loading full descriptions:
```bash
# All open unassigned work ready to claim
bd ready --json --unassigned

# In-progress work (who's working on what)
bd list -s in_progress --json

# Blocked work
bd blocked
```

You push work. You do NOT collect reports and wait.

### Anti-Patterns (team-lead)

- Do NOT ask agents "are you ready?" — assume yes and send the task immediately
- Do NOT spawn one agent and wait for it to finish before spawning the next
- Do NOT keep agents alive when they have no remaining cards
- Do NOT send a status-check message when you should be sending a work assignment
- Do NOT wait for all agents to check in before assigning next work
- Do NOT use a team-lead agent — you are the team-lead

### Graceful Shutdown Sequence (mandatory before every agent shutdown)

When an agent has no remaining work, follow this sequence **in order**:

1. **Confirm no more work**: Verify no unblocked cards exist for this agent on the board
2. **Shutdown**: SendMessage shutdown_request

**The retrospective interview is agent-driven.** Sprint agents are responsible for writing their own interview file before approving the shutdown.

**Shutdown message template** — always include this in the `content` of every `shutdown_request`:

```
Before approving this shutdown, write your retrospective interview to:
  analysis-reports/retro-session/<YYYY-MM-DD>+<team-name>/interviews/<agent-name>.md
Then approve the shutdown_request.
```

**process-engineer is NOT subject to mid-sprint shutdown.** Shut it down as the final step of Step 7.

### Agent Sizing

| Issues | Slice-workers | Cross-reviewers | Deep-debugger |
|--------|--------------|-----------------|---------------|
| 1 | 1 | 0-1 (risk-based) | On demand |
| 2-3 | 2-3 | 1-2 | On demand |
| 4-6 | 4-6 | 2-3 | On demand |
| 7+ | Batch in waves (DDEV cap) | 2-3 | On demand |

Cross-reviewers can be spawned late — only needed when slices start completing.

Optionally spawn `process-engineer` at sprint start. It does NOT use a DDEV slot and does NOT count against the 3-slot limit:

```
Task(subagent_type="improve:process-engineer", name="process-engineer",
     team_name="<team-name>",
     prompt="You are attached to a team sprint as the process engineer.
Board: bd (use bd list/ready/blocked to observe board state).
export BD_ACTOR=process-engineer
Your job: improve how the sprint agents work — fix prompt issues, model mismatches, tool gaps,
and process friction as you observe them. Use improve:attach to map the sprint topology,
improve:lint to check against known patterns, and improve:fix for directed changes.
You are NOT part of the task queue. Do NOT respond to task assignments.
You shut down only when the user asks — not when team-lead sends shutdown_request.")
```

**Before spawning any slice-worker** — check for QA-passed worktrees that touch the same files as the target issue:

```bash
# Show changed files per open worktree
for wt in worktrees/*/; do
  changed=$(git -C "$wt" diff --name-only HEAD 2>/dev/null)
  [ -n "$changed" ] && echo "$wt:" && echo "$changed"
done
```

If a QA-passed worktree overlaps files with the target issue, add to the slice-worker spawn prompt:
> "Before writing code, read `worktrees/{other-issue}/` and compare it to `worktrees/main/` for [overlapping file]. Port those changes to your worktree first."

Spawn slice-workers from `sprint/agents/slice-worker.md`. **Every agent must include `team_name` — without it, SendMessage won't work and agents go permanently idle after their first turn.**

```
Task(subagent_type="sprint:slice-worker", name="slice-1", team_name="<team-name>",
     prompt="You are part of a team sprint. You own this issue end-to-end.

export BD_ACTOR=slice-1
Board: bd
Your name: slice-1
Your assigned card: <bd-card-id>
Issue: <d.o URL>

Read the full card yourself at task start: bd show <bd-card-id> --json
Claim it: bd update <bd-card-id> --claim --add-label lane-in-progress

DDEV limit: 3 concurrent (check ddev metadata on cards).
Retro folder: analysis-reports/retro-session/<YYYY-MM-DD>+<team-name>/interviews/slice-1.md
Comms: ~/.claude/plugins/cache/local/sprint/<ver>/protocols/team-comms-protocol.md

ALLOWED FILES (you may ONLY write to these paths):
- <list exact file paths here — team-lead fills this in at spawn time>
Any edit to a file not in this list is strictly forbidden.

## Context Retrieval (opt-in)
When the card does not specify exact file paths, use the iterative retrieval pattern:
1. **Dispatch**: Broad Glob/Grep to find candidate files related to the task
2. **Evaluate**: Score each candidate — does it contain the logic/data you need?
3. **Refine**: Run narrower searches based on what the broad pass found
4. **Loop**: Repeat steps 2-3 until you have the right context (max 3 iterations)
See: sprint/protocols/ITERATIVE-RETRIEVAL.md")
```

### Step 4: Pipeline Execution

Consult `references/streaming-pipeline.md` for full specification. Key rules:

1. **No batch gates**: Each issue flows independently through its slice-worker.
2. **Pull system**: Slice-workers query the board with `bd ready --json --unassigned` for available cards after completing their first assignment.
3. **Claim before working**: Use `bd update <id> --claim --add-label lane-in-progress` before starting work.
4. **Completion flow**: Slice-worker completes → card moves to `lane-needs-cross-review` (if `cross-review-yes`) or closes directly.
5. **Cross-review**: Team-lead spawns cross-reviewer when cards arrive in `lane-needs-cross-review`. Pass → close. Fail → return to `lane-in-progress`, notify slice-worker.
6. **Narrative on every transition**: Append notes with `bd update <id> --append-notes "..."` when moving a card.

### Cross-Review Phase

When slice-workers start completing cards with `cross-review-yes`:

1. Spawn cross-reviewer instances (or assign idle slice-workers as cross-reviewers)
2. Cross-reviewer claims from `lane-needs-cross-review`
3. Runs independent validation (phpcs, phpstan, phpunit)
4. APPROVED → close card. REJECTED → return to `lane-in-progress`, notify slice-worker.

Cross-review assignment pattern: slice-A's work reviewed by cross-reviewer-1 (or by idle slice-B).

### Agent Role Mapping

The main agent (you) owns the board and runs the team-lead loop directly. Do not spawn a team-lead agent.

| Agent | Responsibility | Board Permissions |
|-------|---------------|-------------------|
| slice-worker | Owns an issue end-to-end: analyze, implement, test, validate. Claims from `lane-backlog`, works in `lane-in-progress`, moves to `lane-needs-cross-review` or closes. | Moves own assigned cards only |
| cross-reviewer | Fresh-eyes validation of completed slices. Claims from `lane-needs-cross-review`, closes on pass or returns to `lane-in-progress` on fail. | Moves own assigned cards only |
| deep-debugger | Escalation specialist. Spawned when a slice-worker hits 3-fix limit. | Operates on the escalated card only |
| process-engineer | Process engineer (from `improve` plugin). Watches pipeline patterns, identifies friction, makes autonomous improvements. Spawned once at sprint start — NOT managed by team-lead, NOT shut down by team-lead. Only the user shuts it down. | Read-only on board. Makes changes to agent definitions, skills, and process config. |

### Step 5: DDEV Instance Management

Max 3 DDEV instances. Each slice-worker self-manages within the cap.

**Two-phase validation:**
- Phase 1 (static analysis): No DDEV needed. Start immediately.
- Phase 2 (runtime tests): DDEV needed. Queue if 3 slots full.

**DDEV self-management by slice-workers:**
```bash
SLOTS=$(bd list -l board-sprint --metadata-field ddev=true --json | jq 'length')
if [ "$SLOTS" -lt 3 ]; then
  bd update <id> --set-metadata ddev=true
  # start DDEV, run phpunit
  ddev stop
  bd update <id> --unset-metadata ddev
fi
```
If full: do phpcs/phpstan first, poll or notify team-lead.

**DDEV setup per worktree:**
```bash
cp -r ./worktrees/main/.ddev \
  ./worktrees/{ISSUE}/
cat > ./worktrees/{ISSUE}/.ddev/config.local.yaml << EOF
name: drupal-{ISSUE}
EOF
cd ./worktrees/{ISSUE} && ddev start
```

### Step 6: Monitor and Rebalance

You monitor pipeline health and rebalance work. Run `bd list --json | jq 'group_by(.status)'` to check health.

| Signal | Action |
|--------|--------|
| Cards in `lane-needs-cross-review` piling up | Spawn additional cross-reviewer |
| Fix loop >= 3 on a card (label `fix-loop-3`) | Spawn deep-debugger with context |
| Agent idle 2+ turns, no remaining cards | Run Graceful Shutdown Sequence (does NOT apply to process-engineer mid-sprint) |
| All cards closed | Run Graceful Shutdown Sequence for process-engineer as the final act of Step 7 |
| Agent sends status report with no blocker | Acknowledge + push next task in same response |
| Slice-worker blocked on DDEV | Ensure they've done static analysis first; rotate slots |

### Step 7: Results and Release Notes

When sprint completes:

1. Run `bd list -s closed --json` for final board state
2. For each closed card: append an entry to `analysis-reports/RELEASE-NOTES.md` (see format below)
3. Update `.claude/memory/MEMORY.md` with learnings
4. For each completed issue, run `issue-summary` skill to generate a drupal.org contribution comment ready to post
5. Run Graceful Shutdown Sequence for `process-engineer` — it has observed the full sprint and is the most valuable retro interviewee. Shut it down last.
6. Call `TeamDelete` — removes the team directory (`~/.claude/teams/{team-name}/`) and its inboxes, preventing stale inbox matches in future sprints for recurring agent names like `process-engineer`.

**Release notes format** (`analysis-reports/RELEASE-NOTES.md` is an append-only log):

```markdown
## YYYY-MM-DD — Issue #NNNNNN: Short Title

- **What changed**: One-sentence summary of the fix or feature
- **Files touched**: List key files modified
- **Approach**: One paragraph on the technical approach taken
- **MR/patch**: Link or reference when submitted
```

Prepend new entries at the top so the file reads newest-first.

## Quick Reference

| Action | Command |
|--------|---------|
| View board | `bd list --json` |
| Ready work | `bd ready --json` |
| Unassigned ready work | `bd ready --json --unassigned` |
| Show blocked | `bd blocked` |
| Filter by lane | `bd list -l lane-in-progress --json` |
| Pipeline status | `bd list --json \| jq 'group_by(.status)'` |
| DDEV slot count | `bd list --metadata-field ddev=true --json \| jq 'length'` |
| In-progress work | `bd list -s in_progress --json` |
| Closed (done) | `bd list -s closed --json` |
| Show card details | `bd show <id> --json` |
| Init board | `bd init --prefix sprint` |
| Start sprint | Init board, create cards with `bd create`, spawn agents, execute steps 1-7 |
| Resume sprint | `bd list --json` to scan board state, continue from current status |
| Add issue | `bd create ...` with appropriate labels and deps |
| End sprint | Let in-progress finish, write release notes, run step 7 |

## Troubleshooting

**Cards not advancing**: Check deps — are blocking cards closed? Run `bd blocked`.

**DDEV slot contention**: Run `bd list --metadata-field ddev=true --json | jq 'length'` to see DDEV allocation. Ensure slice-workers do static analysis first. Release finished slots.

**Agent can't find work**: Run `bd ready --json --unassigned`. If none, check for blocked cards.

**Slice-worker keeps failing**: Check fix-loop label count. If >= 3, spawn deep-debugger. Check PHP version (use DDEV, not host).

**Board out of sync with reality**: The Beads database is the source of truth. If work was done outside the board, create/update cards to match.
