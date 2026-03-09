---
name: run
description: >
  Orchestrates a multi-agent team sprint: spawns parallel agents, manages a file-based Kanban
  pipeline, and coordinates implementers, analyzers, and reviewers across multiple issues.
  Use when asked to run a team sprint, spin up agents, work on multiple issues in parallel,
  kick off the sprint pipeline, or start parallel agent work. Trigger phrases: "run a team
  sprint", "spin up agents", "work on these issues as a team", "team validate these patches",
  "start the sprint", "let's kick off the pipeline". Do NOT use for: planning which issues
  to tackle (sprint:plan), observing pipeline quality (sprint:observe), reading the board
  (sprint:board), or running a retrospective (retro:session).
---

# Team Sprint

Orchestrate multiple agents working on multiple Drupal issues using a persistent Beads database with streaming pipeline coordination.

Board state lives in `.beads/sprint.db` (Beads database). Cards are Beads issues with status (`open`, `in_progress`, `closed`) and lane labels (`lane-backlog`, `lane-developing`, etc.). Agents coordinate via the pull protocol and communicate via `../protocols/team-comms-protocol.md`.

## Kanban Board

## Context Awareness
**Important**: All relative paths (e.g. `./worktrees/...`) assume you are executing from the **Project Root** (e.g. `~/OpenSource/SAME_PAGE_PREVIEW`).
- The Project Root is the folder that *contains* the `worktrees/` and `.beads/` directories.
- If you are inside a worktree (e.g. `.../worktrees/1234`), you must `cd ../..` to return to the Project Root before running commands.

### Card Storage

Cards are Beads issues stored in `.beads/sprint.db`. Each issue has a status field (`open`, `in_progress`, `closed`) and labels that encode the lane (`lane-backlog`, `lane-analyzing`, etc.) and stage (`stage-analyze`, `stage-develop`, `stage-validate`).

```
Sprint Lanes (encoded as labels):
  lane-backlog        ← queued, not started
  lane-analyzing      ← issue analysis in progress
  lane-developing     ← implementation in progress
  lane-needs-review   ← implementation done, awaiting reviewer
  lane-reviewing      ← quality gates running
  lane-review-failed  ← review failed, back to implementer
  (closed)            ← all stages complete, ready for MR
```

A blocked card is expressed via `--deps` (dependency on another issue), not as a separate lane — a blocked card stays in its current lane until unblocked.

### Card Format

Cards are created with `bd create`:

```bash
bd create "Issue #2901667: jQuery removal in toggleEditMode" \
  --prefix sprint \
  -p 2 -t task \
  --labels "board-sprint,lane-backlog,stage-analyze" \
  --acceptance "jQuery replaced with native JS; all tests pass; PHPCS clean" \
  --description "Remove jQuery dependency from Settings Tray toggleEditMode function.

## Narrative
- 2026-02-16: Card created as part of team sprint. Analysis pending. (by @team-lead)"
```

### Card Fields

| Field | bd equivalent | Description |
|-------|---------------|-------------|
| id | Auto-assigned by bd (e.g. `sprint-a1b2`) | Unique ID. |
| priority | `-p 1` (High) or `-p 2` (Normal, default) | High-priority cards get DDEV slots first. |
| blocked_by | `--deps "sprint-a1b2"` on create | Issues that must close before this card can advance. Use `bd blocked` to see. |
| assignee | `--claim` sets to `BD_ACTOR`; `--assignee ""` clears | Agent name who owns the card. |
| tags | `--labels "board-sprint,tag1,tag2"` | Labels for filtering (lane, stage, issue number, topic tags). |
| issue | Label: `issue-2901667` | Drupal.org issue number encoded as a label. |
| stage | Label: `stage-analyze`, `stage-develop`, `stage-validate` | Pipeline phase. |
| ddev | `--set-metadata ddev=true` | Whether this card holds a DDEV slot. Max 3 cards with ddev=true at once. |
| fix_loop | Label: `fix-loop-N` | Number of fix-and-verify iterations. Escalate at 3. |
| review_scope | Label: `review-DYNAMIC_FULL` etc. | Scope of review: `STATIC_ONLY`, `STATIC_PLUS_DDEV`, `DYNAMIC_FULL`. |

### Status and Lane Mapping

| Lane | `--status` | Label |
|------|-----------|-------|
| Backlog | `open` (default) | `lane-backlog` |
| Analyzing | `in_progress` (via `--claim`) | `lane-analyzing` |
| Developing | `in_progress` (via `--claim`) | `lane-developing` |
| Needs Review | `open` | `lane-needs-review` |
| Reviewing | `in_progress` (via `--claim`) | `lane-reviewing` |
| Review Failed | `open` | `lane-review-failed` |
| Done | `closed` (via `bd close`) | (none) |

### Narrative Record (Required)

Every card maintains a Narrative section in its description — an append-only log of decisions, discoveries, and outcomes. This is the card's story.

**Rules:**
- Never rewrite or delete prior narrative entries
- Append new entries with `--append-notes` using ISO date and author
- Focus on reasons, insights, and decisions — not just lane moves
- When closing a card, add enough detail for a future reader to understand the outcome

```bash
bd update <id> \
  --append-notes "2026-02-16: Analysis complete. Simple jQuery removal, once() can be replaced with native addEventListener. (by @issue-analyzer)"
```

### Placement Guidance (for multi-file update cards)

When a card requires inserting a new section into multiple agent definition files, include placement guidance in the card description specifying where to insert the new content. Card authors should always specify insertion points when the card touches 2+ agent files. Implementers should not have to guess placement.

## Board Operations

All board queries use `bd` CLI commands — no shell scripts or file scanning needed.

### View the Board

```bash
bd list --json
```

### Show Blocked Cards

```bash
bd blocked
```

### Filter by Label

```bash
bd list -l stage-analyze --json
```

### Ready Work (unblocked, open)

```bash
bd ready --json
```

### Unassigned Ready Work

```bash
bd ready --json --unassigned
```

### Pipeline Status

```bash
bd list --json | jq 'group_by(.status)'
```

### DDEV Slot Count

```bash
bd list --metadata-field ddev=true --json | jq 'length'
```

## Sprint Workflow

### Step 0: Pre-Sprint Planning (recommended)

Run the `sprint:plan` skill before creating cards if you have a list of issues to prioritize. It checks for existing analysis reports, sequences issues by dependencies and complexity, and proposes agent assignments. Saves you from discovering mid-sprint that issues are unanalyzed or misordered.

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

This serves as the retro folder for the entire sprint. The SubagentStop hook writes agent interviews here at shutdown. Creating it now (rather than waiting for the hook) means mid-sprint observations can be written here and confirms TeamCreate was called.

**Third — initialize the Beads database (if not already present):**

```bash
bd init --prefix sprint
```

This creates `.beads/sprint.db` in the current directory (project root).

**Fourth — pre-flight checks:**

```bash
# Check DDEV health (active instances only; timeout prevents hang)
timeout 10 ddev list -A 2>/dev/null && echo "DDEV healthy" || echo "DDEV unhealthy -- only assign ddev:false cards"

# Check existing worktrees
ls ./worktrees/

# Check for existing board state
bd ready --json 2>/dev/null || echo "Empty board -- will create cards"
```

Resolve before proceeding:
- DDEV unhealthy (command hangs or errors) -> only assign cards without ddev metadata this session; add `review-STATIC_ONLY` label on all validate-stage cards; note in agent spawn prompts
- 3+ DDEV instances running -> stop unused ones
- No `.beads/` directory -> run `bd init --prefix sprint`

### Step 2: Create Cards (team-lead only)

The team-lead creates and manages all cards. For each issue, create one card per pipeline stage with blocking dependencies.

**Full pipeline (3 cards per issue):**

```bash
# For issue 2901667:
# Card 1: analyze (no blockers)
bd create "Issue #2901667: analyze jQuery removal" \
  --prefix sprint \
  -p 2 -t task \
  --labels "board-sprint,lane-backlog,stage-analyze,issue-2901667" \
  --acceptance "Analysis report written with complexity, files, and approach" \
  --description "Analyze jQuery dependency in Settings Tray toggleEditMode.

## Narrative
- 2026-02-16: Card created. Analysis pending. (by @team-lead)"

# Card 2: develop (blocked by card 1)
bd create "Issue #2901667: implement jQuery removal" \
  --prefix sprint \
  -p 2 -t task \
  --labels "board-sprint,lane-backlog,stage-develop,issue-2901667" \
  --deps "sprint-XXXX" \
  --acceptance "jQuery replaced with native JS; all tests pass; PHPCS clean" \
  --description "Implement jQuery removal based on analysis report.

## Narrative
- 2026-02-16: Card created. Blocked on analysis. (by @team-lead)"

# Card 3: validate (blocked by card 2)
bd create "Issue #2901667: validate jQuery removal" \
  --prefix sprint \
  -p 2 -t task \
  --labels "board-sprint,lane-backlog,stage-validate,issue-2901667,review-DYNAMIC_FULL" \
  --deps "sprint-YYYY" \
  --acceptance "All quality gates pass; no regressions" \
  --description "Validate jQuery removal implementation.

## Narrative
- 2026-02-16: Card created. Blocked on implementation. (by @team-lead)"
```

Replace `sprint-XXXX` and `sprint-YYYY` with the actual IDs returned by the previous `bd create` commands.

**Validation-only (1 card per issue):**
Create only validate cards with no `--deps`.

**Analysis-only (1 card per issue):**
Create only analyze cards with no `--deps`.

### Step 3: Team Sizing and Agent Spawning

## You Are the Team Lead

When you invoke this skill, YOU run the team-lead function. Do not spawn a team-lead agent.

TEAM-LEAD LOOP (run every turn):
1. TaskList -> who has no in_progress task right now?
2. Scan the board: `bd ready --json --unassigned` for available work. For in-progress status: `bd list -s in_progress --json`.
3. Match idle agents to available cards -> SendMessage with task assignment (card ID only) immediately
4. If an agent's role has no remaining cards -> run GRACEFUL SHUTDOWN SEQUENCE (see below)
   ⚠ Exception: process-improvement stays alive until ALL sprint work is done (Step 7). Do not shut it down mid-sprint.
5. If an agent is unresponsive 2+ turns -> reassign or replace (does NOT apply to process-improvement)

**Card Summary Format** — the lightweight summary team-lead builds from bd output for orchestration decisions:
```
{id} | {title} | {stage-label} | {assignee} | {deps}
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

### Graceful Shutdown Sequence (mandatory before every agent shutdown)

When an agent has no remaining work, follow this sequence **in order**:

1. **Confirm no more work**: Verify no unblocked cards exist for this agent's role on the board
2. **Shutdown**: SendMessage shutdown_request

**The retrospective interview is agent-driven.** Sprint agents (implementer, reviewer) are responsible for writing their own interview file before approving the shutdown. Their agent definitions include the questions and the file path. The team-lead does not need to send questions or save answers — just send the `shutdown_request` and the agent will complete the interview before approving.

**Shutdown message template** — always include this in the `content` of every `shutdown_request`, regardless of agent role. It acts as a backstop for agents (e.g. fixer) whose definitions may not embed the interview path:

```
Before approving this shutdown, write your retrospective interview to:
  analysis-reports/retro-session/<YYYY-MM-DD>+<team-name>/interviews/<agent-name>.md
Then approve the shutdown_request.
```

Replace `<YYYY-MM-DD>+<team-name>` with the current sprint folder (e.g. `2026-02-21+my-project-sprint-1`) and `<agent-name>` with the agent's Task `name` parameter.

**process-improvement is NOT subject to mid-sprint shutdown.** It persists until all sprint work is complete. Shut it down as the final step of Step 7, after all other agents are done. It is the most valuable retro interviewee — it has observed the entire sprint.

Expected output per agent: `analysis-reports/retro-session/<YYYY-MM-DD>+<team-name>/interviews/{agent-name}.md`
The SubagentStop hook resolves the sprint folder automatically from the team config (no discovery needed by agents).
The folder is date-prefixed (e.g. `2026-02-21+my-project-sprint-1/`) — matching the SubagentStop hook output.
Read `skills/run/references/decision-framework.md` for autonomous vs. escalate rules.

| Issues | Analyzers | Developers | Validators |
|--------|-----------|------------|------------|
| 1-2    | 1         | 1          | 1          |
| 3-5    | 1         | 2          | 2-3        |
| 6-10   | 2         | 2          | 3          |
| 10+    | Batch in waves of 5 |

Spawn `process-improvement` once at sprint start and leave it alone. It does NOT use a DDEV slot and does NOT count against the 3-slot limit:

```
Task(subagent_type="sprint:process-improvement", name="process-improvement",
     team_name="<team-name>",
     prompt="You are observing a team sprint for process quality.
Board: bd (use bd list/ready/blocked to observe board state — read-only observation).
export BD_ACTOR=process-improvement
You operate in ping-response mode: do one initial state snapshot, then wait for task_completed_ping
messages from team-lead. On each ping, run /sprint:retro-transcript to review the agent's session log,
check the board state via bd, and report to team-lead ONLY if you find an actionable issue.
Silence means the review passed — do not send confirmations.
You are NOT part of the task queue. Do NOT respond to task assignments.
You shut down only when the user asks — not when team-lead sends shutdown_request.")
```

**Ping format** — team-lead sends this after each task completion:
```json
{"type":"task_completed_ping","task_id":"<bd-id>","task_subject":"<subject>","owner":"<agent-name>"}
```

**Resolve card state before sending ping**: By the time team-lead sends a `task_completed_ping`, the card may have already been moved. Always query the card's actual state immediately before composing the ping:

```bash
bd show <id> --json
```

Use the current state from `bd show` for the ping. Never use stale data from the original assignment.

**Before spawning any implementer** — check for QA-passed worktrees that touch the same files as the target issue. Implementers starting from `main` will miss changes that are QA-passed but not yet merged, risking re-introduction of regressions those changes fixed.

```bash
# Show changed files per open worktree
for wt in worktrees/*/; do
  changed=$(git -C "$wt" diff --name-only HEAD 2>/dev/null)
  [ -n "$changed" ] && echo "$wt:" && echo "$changed"
done
```

If a QA-passed worktree overlaps files with the target issue, add to the implementer spawn prompt:
> "Before writing code, read `worktrees/{other-issue}/` and compare it to `worktrees/main/` for [overlapping file]. Port those changes to your worktree first before implementing the new feature."

Spawn the other worker agents from `.claude/agents/` definitions. **Every agent must include `team_name` — without it, SendMessage won't work and agents go permanently idle after their first turn.**

```
Task(subagent_type="<role>", name="<name>", team_name="<team-name>",
     prompt="You are part of a team sprint.
export BD_ACTOR=<your-agent-name>
Board: bd
Pipeline: Streaming (pull from board, don't wait for batches).
DDEV limit: 3 concurrent (check ddev metadata on cards).
Retro folder: analysis-reports/retro-session/<YYYY-MM-DD>+<team-name>/interviews/{your-agent-name}.md
  (The SubagentStop hook writes this automatically — just answer the interview questions when prompted.)
Comms: ~/.claude/plugins/cache/local/sprint/<ver>/protocols/team-comms-protocol.md

Your assigned card: <bd-card-id>
Read the full card yourself at task start: bd show <bd-card-id> --json
The team-lead provides only the card ID, not the full content.

ALLOWED FILES (you may ONLY write to these paths):
- <list exact file paths here — team-lead fills this in at spawn time>
Any edit to a file not in this list is strictly forbidden.
If the card spec requires editing a file not listed, STOP and message team-lead before proceeding.

AGENT LOOP (for analyzers, developers, validators):
1. Read your assigned card: bd show <id> --json
2. Scan for available work: bd ready --json --unassigned | filter by your stage label
3. Claim: BD_ACTOR=<your-name> bd update <id> --claim --add-label lane-<your-lane>
4. Do the work
5. Transition to next lane:
   bd update <id> --status open --assignee "" \
     --remove-label lane-<current> --add-label lane-<next>
   OR close: bd close <id> --reason 'Done.'
6. Append narrative: bd update <id> --append-notes '...'
7. Repeat

## Context Retrieval (opt-in)
When the card does not specify exact file paths, use the iterative retrieval pattern:
1. **Dispatch**: Broad Glob/Grep to find candidate files related to the task
2. **Evaluate**: Score each candidate — does it contain the logic/data you need?
3. **Refine**: Run narrower searches based on what the broad pass found
4. **Loop**: Repeat steps 2-3 until you have the right context (max 3 iterations)
Skip this if the card or team-lead already specifies exact file paths.
See: sprint/protocols/ITERATIVE-RETRIEVAL.md for the full pattern and examples.
```

### Step 4: Streaming Pipeline (Pull Protocol)

Consult `references/streaming-pipeline.md` for full specification. Key rules:

1. **No batch gates**: Each issue flows independently through stages.
2. **Pull system**: Agents query the board with `bd ready --json --unassigned` and filter by their stage label for available cards. No central assignment needed.
3. **Claim before working**: Use `bd update <id> --claim --add-label lane-<working-lane>` before starting work.
4. **Flow on completion**: When done, transition the card to the next lane. Downstream cards with deps pointing to this card become unblocked when this card is closed.
5. **Narrative on every transition**: Append notes with `bd update <id> --append-notes "..."` when moving a card between lanes.

### QA Lane Protocol

The card's `review-*` label determines whether QA runs inline (implementer self-validates with cross-review) or through the dedicated needs-review lane:

| Review Scope Label | QA Routing | Who Validates |
|--------------------|------------|---------------|
| `review-STATIC_ONLY` (and a cross-reviewer is available) | **Inline QA** -- implementer may close the card directly after cross-review sign-off. No transit through needs-review. | Implementer + cross-reviewer |
| `review-RUNTIME` or `review-DYNAMIC_FULL` | **Dedicated QA** -- card must transit through needs-review lane and be claimed by a reviewer agent. | reviewer |
| `review-STATIC_PLUS_DDEV` | **Dedicated QA** -- same as RUNTIME/DYNAMIC_FULL. | reviewer |

**Inline QA requirements** (all must be true for a card to skip needs-review):
1. Card has `review-STATIC_ONLY` label
2. A cross-reviewer (another implementer or the team-lead) is available to review
3. Cross-reviewer appends sign-off to the card's Narrative before the card is closed

If any condition is not met, route through needs-review regardless of review scope.

### Agent Role Mapping

The main agent (you) owns the board and runs the team-lead loop directly. Do not spawn a team-lead agent.

| Agent | Responsibility | Board Permissions |
|-------|---------------|-------------------|
| issue-analyzer | Claims `stage-analyze` cards from ready queue, transitions to `lane-analyzing`, closes on completion (or back to `lane-backlog` if issue needs more work) | Moves own assigned cards only |
| implementer | Claims `stage-develop` cards from ready queue or `lane-review-failed`, transitions to `lane-developing`, then to `lane-needs-review` on completion | Moves own assigned cards only |
| reviewer | Claims cards with `lane-needs-review`, transitions to `lane-reviewing`, closes on pass or moves to `lane-review-failed` on fail | Moves own assigned cards only |
| process-improvement | Independent observer. Watches pipeline patterns, detects inefficiencies, creates skills, updates memory. Spawned once at sprint start -- NOT managed by team-lead, NOT shut down by team-lead. Only the user shuts it down. | Read-only on board (bd list/ready/blocked). Sends unsolicited recommendations to team-lead. |

### Idle Protocol (Fallback Work)

When no primary cards available:

| Role | Fallback 1 | Fallback 2 |
|------|-----------|-----------|
| issue-analyzer | Pre-read next issues from d.o | Code review in-progress patches |
| implementer | Fix validation failures | Static code review |
| reviewer | Phase 1 static review (no DDEV) | Help with issue analysis |

### Step 5: DDEV Instance Management

Max 3 DDEV instances. Track with `ddev` metadata on cards.

**Two-phase validation:**
- Phase 1 (static analysis): No DDEV needed. Start immediately for all issues.
- Phase 2 (runtime tests): DDEV needed. Queue if 3 slots full.

**Claiming a DDEV slot:**
1. Count cards with ddev metadata: `bd list --metadata-field ddev=true --json | jq 'length'`
2. If < 3: `bd update <id> --set-metadata ddev=true`, run `ddev start`
3. If = 3: do Phase 1 work while waiting, check again after another card completes

**Releasing a DDEV slot:**
1. Run `ddev stop` in the worktree
2. `bd update <id> --unset-metadata ddev`
3. Append narrative: `bd update <id> --append-notes "DDEV slot released"`

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

You monitor pipeline health and rebalance work. Run `bd list --json | jq 'group_by(.status)'` to check health. The process-improvement agent may recommend rebalancing actions but does not modify cards directly.

| Signal | Action |
|--------|--------|
| Reviewers idle, no cards with `lane-reviewing` | Assign Phase 1 review on cards with `lane-developing` |
| 3+ cards queued with `lane-needs-review` | Release finished DDEV slots, rotate |
| Analyzer idle, cards with `lane-backlog` and `stage-analyze` | Assign next issue |
| Fix loop >= 3 on a card (label `fix-loop-3`) | Escalate: pause card, report to user for decision |
| Agent idle 2+ turns, no remaining cards for their role | Run Graceful Shutdown Sequence (does NOT apply to process-improvement mid-sprint) |
| All cards for a stage are closed | Run Graceful Shutdown Sequence for agents in that stage (does NOT apply to process-improvement mid-sprint) |
| All cards across ALL stages are closed | Run Graceful Shutdown Sequence for process-improvement as the final act of Step 7 |
| Agent sends status report with no blocker | Acknowledge + push next task in same response |

### Step 7: Results and Release Notes

When sprint completes:

1. Run `bd list -s closed --json` for final board state
2. For each closed card: append an entry to `analysis-reports/RELEASE-NOTES.md` (see format below)
3. Update `.claude/memory/MEMORY.md` with learnings
4. For each completed issue, run `issue-summary` skill to generate a drupal.org contribution comment ready to post
5. Run Graceful Shutdown Sequence for `process-improvement` — it has observed the full sprint and is the most valuable retro interviewee. Shut it down last.
6. Call `TeamDelete` — removes the team directory (`~/.claude/teams/{team-name}/`) and its inboxes, preventing stale inbox matches in future sprints for recurring agent names like `process-improvement`.

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
| Filter by label | `bd list -l stage-analyze --json` |
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

**DDEV slot contention**: Run `bd list --metadata-field ddev=true --json | jq 'length'` to see DDEV allocation. Release finished slots.

**Agent can't find work**: Run `bd ready --json --unassigned` and filter by stage label. If none, do fallback work.

**Validation keeps failing**: Check fix-loop label count. If >= 3, escalate. Check PHP version (use DDEV, not host).

**Board out of sync with reality**: The Beads database is the source of truth. If work was done outside the board, create/update cards to match.
