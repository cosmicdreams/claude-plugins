# Streaming Pipeline

A pull-based Kanban pipeline for coordinating multiple agents working on independent work items through sequential stages. Each item flows independently -- no batch gates. State is stored as persistent Markdown card files in `kanban/`.

## Core Concept

```
BACKLOG --> ANALYZING --> DEVELOPING --> VALIDATING --> DONE
             (pull)        (pull)         (pull)
```

Every work item moves through stages independently. When an agent finishes one item, it pulls the next available item from the board. No stage waits for all items to clear the previous stage.

**Anti-pattern (batch model -- avoid):**
```
[ALL items through Stage 1] --wait-- [ALL items through Stage 2] --wait-- [DONE]
```

Batch gates cause 30% idle time. Measured in 2026-02-13 session.

## Card-Based State Management

Board state lives in `kanban/` as Markdown files with YAML frontmatter. This replaces in-memory task tracking and provides:
- **Cross-session persistence**: cards survive when Claude exits
- **User visibility**: users can browse/edit cards directly as `.md` files
- **Narrative trail**: append-only decision log for retrospectives
- **Shell scripts**: board visualization without consuming API tokens

See the main SKILL.md for card format and field definitions.

## Setting Up a Pipeline

### 1. Define Stages

Each stage maps to a card `status` value and is worked by a specific agent role.

**Full pipeline (default):**

| Stage | Card Status | Agent Role | Output |
|-------|------------|------------|--------|
| Analyze | `analyzing` | issue-analyzer | Analysis report |
| Develop | `developing` | implementer | Patch in worktree |
| Validate | `reviewing` | reviewer | Pass/fail report |

### 2. Create Cards with Dependencies

For each work item, create one card per stage. Link with `blocked_by` so work flows in order.

**For a 3-stage pipeline with items A, B, C:**

```
Card #1: Analyze A       (blocked_by: [])      <- starts immediately
Card #2: Develop A       (blocked_by: [1])     <- waits for #1
Card #3: Validate A      (blocked_by: [2])     <- waits for #2

Card #4: Analyze B       (blocked_by: [])      <- starts immediately
Card #5: Develop B       (blocked_by: [4])     <- waits for #4
Card #6: Validate B      (blocked_by: [5])     <- waits for #5
```

Key: Analysis cards have NO blockers. They start immediately. Each downstream card is blocked only by its own predecessor, not by other items.

### 3. Agent Pull Protocol

Agents follow this loop by scanning card files in `kanban/`:

```
1. Scan kanban/*.md for cards matching my role (by stage field)
2. Find cards that are:
   - status: backlog (unstarted)
   - assignee: empty (unclaimed)
   - blocked_by: all blocking cards have status "done"
3. Claim the lowest-ID matching card:
   - Set assignee to my agent name
   - Set status to active stage (analyzing/developing/validating)
   - Append to Narrative: "Claimed by @{agent}. Starting work."
4. Do the work
5. On completion:
   - Set status to "done"
   - Clear assignee
   - Append to Narrative: result summary
6. Go to step 1
```

**Rules:**
- Always claim by writing assignee before starting (prevents double-assignment)
- Prefer lowest card ID when multiple are available (maintains order)
- Always append to Narrative on status changes
- When no cards are available, perform fallback work (see Idle Protocol)

### 4. Stage Transition

When an agent completes a card and sets it to `done`, downstream cards' blockers are resolved. The next agent scanning the board sees the downstream card as available.

```
Agent completes "Analyze A" (card #1) -> status = done
  -> Card #2 ("Develop A") has blocked_by: [1]
  -> Card #1 is now done -> blocker satisfied
  -> Next developer scanning the board claims card #2
```

No manual handoff needed. The dependency chain handles flow through card files.

## Idle Protocol (Dynamic Role Fallback)

When an agent has no primary cards available, it should not sit idle.

### Fallback Work by Role

| Role | Primary | Fallback 1 | Fallback 2 |
|------|---------|-----------|-----------|
| issue-analyzer | Analyze issues | Pre-read next issues from d.o | Code review in-progress patches |
| implementer | Implement fixes | Fix validation failures | Static code review |
| reviewer | Run quality gates | Phase 1 static review (no DDEV) | Help with issue analysis |

### Idle Detection

An agent is idle when scanning `kanban/` returns no cards matching:
- Stage matches agent role
- Status is `backlog`
- Assignee is empty
- All `blocked_by` cards are `done`

### Idle Actions

1. Check `kanban/` for ANY available card (not just primary role)
2. If fallback work available, claim it with a Narrative entry
3. If no work at all, notify team-lead via message

## Bottleneck Detection

Monitor pipeline health using `pipeline_status.sh` or by scanning cards.

### Signals

| Signal | Meaning | Action |
|--------|---------|--------|
| Many cards in `backlog`, none `analyzing` | Analyzer bottleneck | Add analyzer agents |
| Many `analyzing`/`developing`, none `validating` | Validators idle | Assign Phase 1 static review |
| All agents busy, cards flowing | Healthy pipeline | Monitor |
| Cards stuck in `blocked` | Dependency stall | Resolve blockers |
| `fix_loop >= 3` on any card | Repeated failures | Escalate to team-lead |

### Health Check

Run periodically:

```bash
bash .claude/skills/sprint-run/scripts/pipeline_status.sh kanban/
```

Or scan manually:
```
Scan kanban/ -> categorize by status:
  backlog + unblocked = AVAILABLE (should be claimed)
  backlog + blocked = WAITING (normal)
  analyzing/developing/validating = ACTIVE (being worked)
  done = COMPLETE

Healthy: AVAILABLE is low (items get claimed quickly)
Warning: AVAILABLE > 2x active agents (agents not pulling)
Problem: Multiple agents idle + AVAILABLE > 0 (agents not finding work)
```

### Rebalancing

1. **Move agents across stages**: idle Stage 3 agent picks up Stage 1 fallback
2. **Prioritize near-done items**: focus DDEV slots on cards closest to `done`
3. **Escalate structural issues**: DDEV full, environment broken -> notify team-lead

## Resource Constraints (DDEV Slots)

DDEV instances are a shared resource with max 3 concurrent.

### Two-Phase Split

- **Phase 1** (code review, static analysis): No DDEV needed. Run for all cards immediately.
- **Phase 2** (phpunit, functional tests): DDEV needed. Queue if slots full.

### Tracking with Card Fields

Use the `ddev` field on cards:
- `ddev: true` = this card holds a DDEV slot
- `ddev: false` = no slot held
- Count cards with `ddev: true` -- must be <= 3

### Slot Lifecycle

```
SLOT FREE -> claim (ddev: true) -> ddev start (~30s) -> tests (5-30 min) -> ddev stop -> release (ddev: false) -> SLOT FREE
```

## Pipeline Variants

### Full Pipeline (default)
All stages, 3 cards per issue. For end-to-end issue resolution.

### Validation-Only
1 card per issue, `stage: validate`, no blockers. For existing patches.

### Analysis-Only
1 card per issue, `stage: analyze`, no blockers. For triage. No DDEV needed.

### Fix-and-Verify Loop
When validation fails:
1. Increment `fix_loop` on the validate card
2. Create new develop card (no blockers) for the fix
3. Create new validate card blocked by the fix card
4. Max 3 loops, then escalate

## Quick Reference

```
SETUP:
  1. mkdir -p kanban/archived
  2. Create cards as .md files with YAML frontmatter
  3. Analysis cards start with blocked_by: []

AGENT LOOP:
  1. Scan kanban/ for cards matching my role
  2. Find unblocked, unassigned cards
  3. Claim: set assignee + update status
  4. Work
  5. Complete: set status to done, append Narrative
  6. Repeat (or fallback if nothing available)

FLOW:
  - Items flow independently (no batch gates)
  - blocked_by resolves when blocking card reaches done
  - Agents pull by scanning card files (persistent, cross-session)

IDLE:
  - Do fallback work for other roles
  - Notify team-lead if truly nothing to do

BOARD OPS:
  - View:     bash scripts/view_board.sh kanban/
  - Status:   bash scripts/pipeline_status.sh kanban/
  - Blocked:  bash scripts/show_blocked.sh kanban/
  - Tags:     bash scripts/search_by_tag.sh kanban/ <tag>
  - Search:   bash scripts/search_content.sh kanban/ "<term>"
```
