# Streaming Pipeline

A pull-based Kanban pipeline for coordinating multiple agents working on independent issues. Each issue flows independently through a single slice-worker — no batch gates, no handoffs between roles.

## Core Concept

```
BACKLOG --> IN-PROGRESS (slice-worker) --> CROSS-REVIEW (optional) --> DONE
             (pull)                          (pull)
```

Every issue is owned end-to-end by a single slice-worker. The slice-worker analyzes, implements, tests, and validates within one context window. When done, the card either goes to cross-review (if flagged) or closes directly.

**Anti-pattern (batch model -- avoid):**
```
[ALL items through Stage 1] --wait-- [ALL items through Stage 2] --wait-- [DONE]
```

Batch gates cause 30% idle time. Measured in 2026-02-13 session.

## Card-Based State Management

Board state lives in `.beads/sprint.db` as Beads issues. This provides:
- **Cross-session persistence**: cards survive when Claude exits
- **Narrative trail**: append-only decision log for retrospectives
- **CLI queryable**: `bd list`, `bd ready`, `bd blocked`

See `sprint:board` for card format and field definitions.

## Pipeline Setup

### 1. Define Lanes

| Lane | Status | Agent Role | Output |
|------|--------|------------|--------|
| `lane-backlog` | `open` | — | Queued |
| `lane-in-progress` | `in_progress` | slice-worker | End-to-end: analysis + patch + tests + validation |
| `lane-needs-cross-review` | `open` | — | Awaiting cross-review |
| `lane-cross-reviewing` | `in_progress` | cross-reviewer | Independent validation |
| (closed) | `closed` | — | Done |

### 2. Create Cards

One card per issue. Dependencies between issues only (not between phases of the same issue).

```bash
bd create "Issue #NNN: <title>" --prefix sprint \
  --labels "board-sprint,lane-backlog,issue-NNN,cross-review-<yes|no>" \
  --description "<card body with phase checklist>"
```

### 3. Agent Pull Protocol

Slice-workers follow this loop:

```
1. Query board: bd ready -l board-sprint --json --unassigned
2. Claim the first available card:
   - bd update <id> --claim --add-label lane-in-progress
3. Work end-to-end: analyze → implement → test → validate
4. On completion:
   - If cross-review-yes: move to lane-needs-cross-review
   - If cross-review-no: bd close <id>
   - Append SUMMARY to narrative
5. Go to step 1
```

**Rules:**
- Always claim by writing assignee before starting (prevents double-assignment)
- Prefer lowest card ID when multiple are available (maintains order)
- Always append to Narrative on status changes
- When no cards are available, notify team-lead

### 4. Cross-Review Flow

When a slice-worker completes and the card has `cross-review-yes`:

```
Slice-worker moves card to lane-needs-cross-review
  → Cross-reviewer claims from lane-needs-cross-review
  → Runs independent validation
  → APPROVED: bd close <id>
  → REJECTED: move back to lane-in-progress, notify slice-worker
```

## Idle Protocol

When a slice-worker has no cards available:

1. Check `bd ready -l board-sprint --json --unassigned` for any card
2. If no work at all, notify team-lead: `slice-N available | no pending tasks`

Cross-reviewers idle when no cards in `lane-needs-cross-review`. They can be spawned late and shut down early.

## Bottleneck Detection

| Signal | Meaning | Action |
|--------|---------|--------|
| Many cards in backlog, agents idle | Agents not pulling | Check for blocked cards, spawn more if needed |
| All agents busy, cards flowing | Healthy pipeline | Monitor |
| Cards stuck in `lane-needs-cross-review` | Cross-reviewer bottleneck | Spawn additional cross-reviewer |
| `fix_loop >= 3` on any card | Repeated failures | Spawn deep-debugger, escalate |
| DDEV slots full, agents waiting | Resource contention | Static analysis first, queue runtime tests |

## Resource Constraints (DDEV Slots)

DDEV instances are a shared resource with max 3 concurrent. Each slice-worker self-manages:

### Two-Phase Split

- **Phase 1** (phpcs, phpstan): No DDEV needed. Run immediately.
- **Phase 2** (phpunit, functional tests): DDEV needed. Queue if slots full.

### Tracking with Card Metadata

```bash
# Check slot count
bd list -l board-sprint --metadata-field ddev=true --json | jq 'length'

# Claim slot
bd update <id> --set-metadata ddev=true

# Release slot
bd update <id> --unset-metadata ddev
```

### Slot Lifecycle

```
SLOT FREE -> claim (ddev: true) -> ddev start (~30s) -> tests (5-30 min) -> ddev stop -> release (ddev: false) -> SLOT FREE
```

## Pipeline Variants

### Full Pipeline (default)
One card per issue, slice-worker handles end-to-end. Optional cross-review.

### Validation-Only
Pre-existing patches — slice-worker skips analysis, focuses on test + validate.

### Analysis-Only
Triage run — slice-workers analyze only, no implementation. No DDEV needed.

## Quick Reference

```
SETUP:
  1. bd init --prefix sprint
  2. Create cards with bd create (one per issue)
  3. Set cross-review-yes/no labels

AGENT LOOP (slice-worker):
  1. bd ready -l board-sprint --json --unassigned
  2. Claim: bd update <id> --claim --add-label lane-in-progress
  3. Analyze → Implement → Test → Validate
  4. SUMMARY → Close or move to cross-review
  5. Repeat

CROSS-REVIEW:
  1. bd list -l lane-needs-cross-review --json
  2. Claim: bd update <id> --claim --add-label lane-cross-reviewing
  3. Validate independently
  4. APPROVED: close | REJECTED: return to lane-in-progress

BOARD OPS:
  - View:     bd list -l board-sprint --json
  - Ready:    bd ready -l board-sprint --json --unassigned
  - Blocked:  bd blocked
  - DDEV:     bd list --metadata-field ddev=true --json | jq 'length'
```
