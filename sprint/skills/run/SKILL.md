---
name: run
description: Use when asked to run a team sprint, work on multiple issues in parallel, spin up agents for a set of issues, or coordinate a Kanban-driven pipeline. Invoke after sprint:plan when ready to start parallel agent work. Trigger phrases: "run a team sprint", "spin up agents", "work on these issues as a team", "team validate these patches".
---

# Team Sprint

Orchestrate multiple agents working on multiple Drupal issues using a persistent, file-based Kanban board with streaming pipeline coordination.

Board state lives in `kanban/sprint-run/` as Markdown card files organized in status directories. Moving a card between directories changes its status. Cards persist across sessions. Agents coordinate via the pull protocol and communicate via `../protocols/team-comms-protocol.md`.

## Kanban Board

## Context Awareness
**Important**: All relative paths (e.g. `./worktrees/...`) assume you are executing from the **Project Root** (e.g. `~/OpenSource/SAME_PAGE_PREVIEW`).
- The Project Root is the folder that *contains* the `worktrees/` and `kanban/` directories.
- If you are inside a worktree (e.g. `.../worktrees/1234`), you must `cd ../..` to return to the Project Root before running commands.

### Card Storage

Cards are `.md` files organized in status directories under `kanban/sprint-run/`. Each file is one card. The card's directory IS its status -- no `status` field in frontmatter is needed. Moving a card = moving the file to a different directory.

```
kanban/sprint-run/
  1_backlog/        ← queued, not started
  2_analyzing/      ← issue analysis in progress
  3_developing/     ← implementation in progress
  4_needs-review/   ← implementation done, awaiting reviewer
  5_reviewing/      ← quality gates running
  6_review-failed/  ← review failed, back to implementer
  7_done/           ← all stages complete, ready for MR
```

Directories use plain names that read naturally as workflow states. A `blocked` state is expressed via the `blocked_by` field on the card, not as a separate directory -- a blocked card stays in its current directory until unblocked.

**Card naming**: `{issue-number}-{short-desc}-{stage}.md`
Example: `3345989-loading-indicator-develop.md`

### Card Format

```markdown
---
id: 1
priority: Normal
blocked_by: []
assignee: ""
tags: [settings-tray, jquery]
issue: 2901667
stage: analyze
ddev: false
fix_loop: 0
review_scope: DYNAMIC_FULL
---

# Issue #2901667: jQuery removal in toggleEditMode

Remove jQuery dependency from Settings Tray toggleEditMode function.

## Acceptance Criteria
- jQuery replaced with native JS
- All existing tests pass
- PHPCS clean
- No regressions in Settings Tray functionality

## Narrative
- 2026-02-16: Card created as part of team sprint. Analysis pending. (by @team-lead)
```

### Card Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique integer. Scan all directories in `kanban/sprint-run/`, take max + 1. |
| `priority` | No | `High` or `Normal` (default). High-priority cards get DDEV slots first. |
| `blocked_by` | No | List of card IDs that must reach `7_done/` before this card can advance. `[]` if unblocked. |
| `assignee` | No | Agent name or user who owns the card (e.g., `@reviewer`, `@implementer`). |
| `tags` | No | Labels for filtering (e.g., `[settings-tray, jquery, wcag]`). |
| `issue` | No | Drupal.org issue number. Links card to worktree and analysis report. |
| `stage` | No | Pipeline stage: `analyze`, `develop`, `validate`. Tracks which phase this card represents. |
| `ddev` | No | `true` if this card currently holds a DDEV slot. Max 3 cards with `ddev: true` at once. |
| `fix_loop` | No | Number of fix-and-verify iterations. Escalate at 3. |
| `review_scope` | No | For `stage: validate` cards. `STATIC_ONLY` (PHPCS + PHPStan + pattern review, no DDEV) \| `STATIC_PLUS_DDEV` (+ PHPUnit kernel/unit) \| `DYNAMIC_FULL` (+ FunctionalJavascript, default). Auto-set to `STATIC_ONLY` when DDEV is offline at sprint start. |

Note: There is no `status` field in frontmatter. The card's directory IS its status.

### Status Directories

| Directory | Meaning | Who Works On It |
|-----------|---------|----------------|
| `1_backlog/` | Queued, not started | Nobody yet |
| `2_analyzing/` | Issue analysis in progress | issue-analyzer |
| `3_developing/` | Implementation in progress | implementer |
| `4_needs-review/` | Implementation done, awaiting reviewer | reviewer claims next |
| `5_reviewing/` | Quality gates running | reviewer |
| `6_review-failed/` | Review failed, back to implementer | implementer |
| `7_done/` | All stages complete, ready for MR -- delete card when submitted | team-lead |

**Blocked cards**: A card waiting on a dependency stays in its current directory with a non-empty `blocked_by` field. There is no separate `blocked` directory -- check `blocked_by` to identify blocked cards.

### Narrative Record (Required)

Every card maintains a `## Narrative` section -- an append-only log of decisions, discoveries, and outcomes. This is the card's story.

**Rules:**
- Never rewrite or delete prior narrative entries
- Append new entries with ISO date and author
- Focus on reasons, insights, and decisions -- not just directory moves
- When moving to `7_done/`, add enough detail for a future reader to understand the outcome

```markdown
## Narrative
- 2026-02-16: Analysis complete. Simple jQuery removal, once() can be replaced with native addEventListener. (by @issue-analyzer)
- 2026-02-16: Implementation done in worktrees/2901667/. Replaced $.once() with data attribute guard. (by @implementer)
- 2026-02-16: Review passed. phpcs clean, phpunit all green, no regressions. Ready for MR. (by @reviewer)
```

### Placement Guidance (for multi-file update cards)

When a card requires inserting a new section into multiple agent definition files, include a `## Placement Guidance` section in the card body specifying where to insert the new content:

```markdown
## Placement Guidance
Insert new sections before any existing shutdown/lifecycle sections (e.g., "Shutdown Protocol",
"Interview Templates"). For agents without these sections, append to end of file.
```

**Why this matters**: Some agent files have a specific structure where lifecycle sections (shutdown, interview) must remain at the end. For example, `process-improvement.md` has a "Shutdown Protocol" section that must stay last -- new content must be inserted before it.

Card authors should always specify insertion points when the card touches 2+ agent files. Implementers should not have to guess placement.

## Board Operations

All board scripts read frontmatter only — they never load card bodies. This is intentional: the team-lead needs only metadata (id, assignee, stage, blocked_by) for orchestration decisions, saving significant context tokens per scan cycle.

### View the Board

```bash
bash ~/.claude/plugins/cache/local/sprint/<ver>/skills/run/scripts/view_board.sh kanban/sprint-run/
```

### Show Blocked Cards

```bash
bash ~/.claude/plugins/cache/local/sprint/<ver>/skills/run/scripts/show_blocked.sh kanban/sprint-run/
```

### Search by Tag

```bash
bash ~/.claude/plugins/cache/local/sprint/<ver>/skills/run/scripts/search_by_tag.sh kanban/sprint-run/ settings-tray
```

### Search Content

```bash
bash ~/.claude/plugins/cache/local/sprint/<ver>/skills/run/scripts/search_content.sh kanban/sprint-run/ "jQuery"
```

### List All Cards

```bash
bash ~/.claude/plugins/cache/local/sprint/<ver>/skills/run/scripts/list_all_cards.sh kanban/sprint-run/
```

### Pipeline Status (DDEV slots, stage counts)

```bash
bash ~/.claude/plugins/cache/local/sprint/<ver>/skills/run/scripts/pipeline_status.sh kanban/sprint-run/
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

**Third — pre-flight checks:**

```bash
# Check DDEV health (active instances only; timeout prevents hang)
timeout 10 ddev list -A 2>/dev/null && echo "DDEV healthy" || echo "DDEV unhealthy -- only assign ddev:false cards"

# Check existing worktrees
ls ./worktrees/

# Check for existing kanban board
ls kanban/sprint-run/ 2>/dev/null || echo "No board yet -- will create kanban/sprint-run/"
```

Resolve before proceeding:
- DDEV unhealthy (command hangs or errors) -> only assign `ddev: false` cards this session; set `review_scope: STATIC_ONLY` on all validate-stage cards; note in agent spawn prompts
- 3+ DDEV instances running -> stop unused ones
- No `kanban/` directory -> create it: `mkdir -p kanban/sprint-run/{1_backlog,2_analyzing,3_developing,4_needs-review,5_reviewing,6_review-failed,7_done}`

### Step 2: Create Cards (team-lead only)

The team-lead creates and manages all cards. For each issue, create one card per pipeline stage with blocking dependencies.

**Full pipeline (3 cards per issue):**

```bash
# For issue 2901667:
# Card 1: analyze (no blockers)
# Card 2: develop (blocked by card 1)
# Card 3: validate (blocked by card 2)
```

Write each card as a `.md` file in `kanban/sprint-run/1_backlog/`. Use the card format above. Set `stage` to track which pipeline phase the card represents. Set `blocked_by` to chain stages. Cards start in `1_backlog/` and are moved to the appropriate directory as they progress.

**Validation-only (1 card per issue):**
Create only validate cards with no blockers.

**Analysis-only (1 card per issue):**
Create only analyze cards with no blockers.

### Step 3: Team Sizing and Agent Spawning

## You Are the Team Lead

When you invoke this skill, YOU run the team-lead function. Do not spawn a team-lead agent.

TEAM-LEAD LOOP (run every turn):
1. TaskList -> who has no in_progress task right now?
2. Scan kanban/sprint-run/ frontmatter only (`id`, `assignee`, `blocked_by`, `stage`, `ddev`, `fix_loop`). Do NOT read card bodies — agents read full content themselves.
3. Match idle agents to available cards -> SendMessage with task assignment (card path only) immediately
4. If an agent's role has no remaining cards -> run GRACEFUL SHUTDOWN SEQUENCE (see below)
   ⚠ Exception: process-improvement stays alive until ALL sprint work is done (Step 7). Do not shut it down mid-sprint.
5. If an agent is unresponsive 2+ turns -> reassign or replace (does NOT apply to process-improvement)

**Card Summary Format** — the lightweight summary team-lead builds from frontmatter for orchestration decisions:
```
{id} | {filename} | {stage} | {assignee} | {blocked_by}
```

**Frontmatter-only extraction** — use grep to read card metadata without loading the body:
```bash
# Extract frontmatter fields without loading card body
grep -m1 "^id:" kanban/sprint-run/3_developing/some-card.md
grep -m1 "^assignee:" kanban/sprint-run/3_developing/some-card.md
grep -m1 "^blocked_by:" kanban/sprint-run/3_developing/some-card.md
grep -m1 "^stage:" kanban/sprint-run/3_developing/some-card.md
grep -m1 "^ddev:" kanban/sprint-run/3_developing/some-card.md
grep -m1 "^fix_loop:" kanban/sprint-run/3_developing/some-card.md
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
     prompt="You are observing a team sprint for process quality. Board: kanban/sprint-run/ — read-only.
You operate in ping-response mode: do one initial state snapshot, then wait for task_completed_ping
messages from team-lead. On each ping, run /sprint:retro-transcript to review the agent's session log,
check the kanban card, and report to team-lead ONLY if you find an actionable issue.
Silence means the review passed — do not send confirmations.
You are NOT part of the task queue. Do NOT respond to task assignments.
You shut down only when the user asks — not when team-lead sends shutdown_request.")
```

**Ping format** — team-lead sends this after each task completion:
```json
{"type":"task_completed_ping","task_id":<id>,"task_subject":"<subject>","owner":"<agent-name>","kanban_card_path":"kanban/sprint-run/<current-dir>/<filename>"}
```

**Resolve card path before sending ping**: By the time team-lead sends a `task_completed_ping`, the card may have already been moved by QA (e.g., from `4_needs-qa/` to `7_done/`). Always resolve the card's actual filesystem path immediately before composing the ping:

```bash
find kanban/sprint-run -name "<card-filename>"
```

Use the path returned by `find` as the `kanban_card_path` value. Never use the path from the original assignment — it may be stale.

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
     prompt="Your are part of a team sprint. Board: kanban/sprint-run/ (directory-per-status structure)
Pipeline: Streaming (pull from board, don't wait for batches).
DDEV limit: 3 concurrent (check ddev field on cards).
Retro folder: analysis-reports/retro-session/<YYYY-MM-DD>+<team-name>/interviews/{your-agent-name}.md
  (The SubagentStop hook writes this automatically — just answer the interview questions when prompted.)
Comms: ~/.claude/plugins/cache/local/sprint/<ver>/protocols/team-comms-protocol.md

Your assigned card: kanban/sprint-run/{directory}/{filename}
Read the full card yourself at task start — the team-lead provides only the card path, not the full content.

ALLOWED FILES (you may ONLY write to these paths):
- <list exact file paths here — team-lead fills this in at spawn time>
Any edit to a file not in this list is strictly forbidden.
If the card spec requires editing a file not listed, STOP and message team-lead before proceeding.

AGENT LOOP (for analyzers, developers, validators):
1. Read your assigned card in full (team-lead sends only the path)
2. Scan kanban/sprint-run/ directories matching your role for available cards
3. Find unblocked cards with no assignee
4. Claim: set assignee to your name, move card to the appropriate directory
5. Do the work
6. Move card to the next directory, append Narrative
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
2. **Pull system**: Agents scan the appropriate `kanban/sprint-run/` directories for available cards matching their role. No central assignment needed.
3. **Claim before working**: Set `assignee` and move the card to the appropriate directory before starting work.
4. **Flow on completion**: When done, move the card to the next directory. Downstream cards with `blocked_by` pointing to this card become unblocked when this card reaches `7_done/`.
5. **Narrative on every transition**: Append to `## Narrative` when moving a card between directories.

### QA Lane Protocol

The card's `review_scope` field determines whether QA runs inline (implementer self-validates with cross-review) or through the dedicated `4_needs-review` lane:

| `review_scope` | QA Routing | Who Validates |
|---------------------|------------|---------------|
| `STATIC_ONLY` (and a cross-reviewer is available) | **Inline QA** -- implementer may move the card directly to `7_done/` after cross-review sign-off. No transit through `4_needs-review/`. | Implementer + cross-reviewer |
| `RUNTIME` or `DYNAMIC_FULL` | **Dedicated QA** -- card must transit through `4_needs-review/` and be claimed by a reviewer agent. | reviewer |
| `STATIC_PLUS_DDEV` | **Dedicated QA** -- same as RUNTIME/DYNAMIC_FULL. | reviewer |

**Inline QA requirements** (all must be true for a card to skip `4_needs-review/`):
1. `review_scope` is `STATIC_ONLY`
2. A cross-reviewer (another implementer or the team-lead) is available to review
3. Cross-reviewer appends sign-off to the card's Narrative before the card moves to `7_done/`

If any condition is not met, route through `4_needs-review/` regardless of `review_scope`.

### Agent Role Mapping

The main agent (you) owns the board and runs the team-lead loop directly. Do not spawn a team-lead agent.

| Agent | Responsibility | Board Permissions |
|-------|---------------|-------------------|
| issue-analyzer | Claims `stage: analyze` cards from `1_backlog/`, moves to `2_analyzing/`, moves to `7_done/` on completion (or back to `1_backlog/` if issue needs more work) | Moves own assigned cards only |
| implementer | Claims `stage: develop` cards from `1_backlog/`, moves to `3_developing/`, moves to `4_needs-review/` on completion | Moves own assigned cards only |
| reviewer | Claims cards from `4_needs-review/`, moves to `5_reviewing/`, moves to `7_done/` on pass or `6_review-failed/` on fail | Moves own assigned cards only |
| process-improvement | Independent observer. Watches pipeline patterns, detects inefficiencies, creates skills, updates memory. Spawned once at sprint start -- NOT managed by team-lead, NOT shut down by team-lead. Only the user shuts it down. | Read-only on cards. Sends unsolicited recommendations to team-lead. |

### Idle Protocol (Fallback Work)

When no primary cards available:

| Role | Fallback 1 | Fallback 2 |
|------|-----------|-----------|
| issue-analyzer | Pre-read next issues from d.o | Code review in-progress patches |
| implementer | Fix validation failures | Static code review |
| reviewer | Phase 1 static review (no DDEV) | Help with issue analysis |

### Step 5: DDEV Instance Management

Max 3 DDEV instances. Track with `ddev` field on cards.

**Two-phase validation:**
- Phase 1 (static analysis): No DDEV needed. Start immediately for all issues.
- Phase 2 (runtime tests): DDEV needed. Queue if 3 slots full.

**Claiming a DDEV slot:**
1. Count cards with `ddev: true` across all directories in `kanban/sprint-run/`
2. If < 3: set `ddev: true` on your card, run `ddev start`
3. If = 3: do Phase 1 work while waiting, check again after another card completes

**Releasing a DDEV slot:**
1. Run `ddev stop` in the worktree
2. Set `ddev: false` on the card
3. Append to Narrative: "DDEV slot released"

**DDEV setup per worktree:**
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

You monitor pipeline health and rebalance work. Run `bash ~/.claude/plugins/cache/local/sprint/<ver>/skills/run/scripts/pipeline_status.sh kanban/sprint-run/` to check health. The process-improvement agent may recommend rebalancing actions but does not modify cards directly.

| Signal | Action |
|--------|--------|
| Reviewers idle, no cards in `5_reviewing/` | Assign Phase 1 review on cards in `3_developing/` |
| 3+ cards queued in `5_reviewing/` | Release finished DDEV slots, rotate |
| Analyzer idle, issues in `1_backlog/` | Assign next issue |
| Fix loop >= 3 on a card | Escalate: pause card, report to user for decision |
| Agent idle 2+ turns, no remaining cards for their role | Run Graceful Shutdown Sequence (does NOT apply to process-improvement mid-sprint) |
| All cards for a stage are in `7_done/` | Run Graceful Shutdown Sequence for agents in that stage (does NOT apply to process-improvement mid-sprint) |
| All cards across ALL stages are in `7_done/` | Run Graceful Shutdown Sequence for process-improvement as the final act of Step 7 |
| Agent sends status report with no blocker | Acknowledge + push next task in same response |

### Step 7: Results and Release Notes

When sprint completes:

1. Run `bash ~/.claude/plugins/cache/local/sprint/<ver>/skills/run/scripts/view_board.sh kanban/sprint-run/` for final board state
2. For each card in `7_done/`: append an entry to `analysis-reports/RELEASE-NOTES.md` (see format below), then delete the card file
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
| View board | `bash ~/.claude/plugins/cache/local/sprint/<ver>/skills/run/scripts/view_board.sh kanban/sprint-run/` |
| Pipeline status | `bash ~/.claude/plugins/cache/local/sprint/<ver>/skills/run/scripts/pipeline_status.sh kanban/sprint-run/` |
| Show blocked | `bash ~/.claude/plugins/cache/local/sprint/<ver>/skills/run/scripts/show_blocked.sh kanban/sprint-run/` |
| Search by tag | `bash ~/.claude/plugins/cache/local/sprint/<ver>/skills/run/scripts/search_by_tag.sh kanban/sprint-run/ <tag>` |
| Search content | `bash ~/.claude/plugins/cache/local/sprint/<ver>/skills/run/scripts/search_content.sh kanban/sprint-run/ "<term>"` |
| List all cards | `bash ~/.claude/plugins/cache/local/sprint/<ver>/skills/run/scripts/list_all_cards.sh kanban/sprint-run/` |
| Start sprint | Create directories via `mkdir -p kanban/sprint-run/{1_backlog,2_analyzing,3_developing,4_needs-review,5_reviewing,6_review-failed,7_done}`, create cards in `1_backlog/`, spawn agents, execute steps 1-7 |
| Resume sprint | Scan all `kanban/sprint-run/` directories, check board state, continue from current status |
| Add issue | Create new cards in `kanban/sprint-run/1_backlog/` with blocking deps |
| End sprint | Let in-progress finish, write release notes, delete `7_done/` cards, run step 7 |

## Troubleshooting

**Cards not advancing**: Check `blocked_by` -- are blocking cards in `7_done/`? Run `show_blocked.sh`.

**DDEV slot contention**: Run `pipeline_status.sh` to see DDEV allocation. Release finished slots.

**Agent can't find work**: Check board for unassigned cards matching role. If none, do fallback work.

**Validation keeps failing**: Check `fix_loop` count. If >= 3, escalate. Check PHP version (use DDEV, not host).

**Board out of sync with reality**: Cards are the source of truth. If work was done outside the board, create/update cards to match.
