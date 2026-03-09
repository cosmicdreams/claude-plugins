---
name: board
description: Board-specific rules for the sprint Beads database (.beads/sprint.db). Use before creating, claiming, or interpreting any card in the sprint board. Provides lane definitions, card fields, DDEV slot rules, and agent role mappings. Trigger phrases include "create sprint card", "show sprint board", "sprint board columns", "add issue to sprint", "open sprint board", "launch sprint board". Always pair with sprint:kanban for universal kanban rules. Do NOT use for the retrospective-actions board -- use retro:kanban instead.
---

# Sprint-Board — Team Sprint Board

Board-specific rules for `.beads/sprint.db`. Read `sprint:kanban` first for universal standards that apply to all boards.

For sprint orchestration (spawning agents, running the pipeline): read `sprint:run`.

**Board database:** `.beads/sprint.db`
**Purpose:** Issues flowing through the analyze → develop → review pipeline during a team sprint.

---

## Board View

View the sprint board via bd CLI:

```bash
# All cards grouped by status
bd --db .beads/sprint.db list --json | jq 'group_by(.status)'

# Ready to claim (unblocked, unassigned)
bd --db .beads/sprint.db ready --json --unassigned

# In-progress work
bd --db .beads/sprint.db list -s in_progress --json

# Blocked work
bd --db .beads/sprint.db blocked

# Done (closed)
bd --db .beads/sprint.db list -s closed --json

# Filter by lane
bd --db .beads/sprint.db list -l lane-developing --json

# Filter by stage
bd --db .beads/sprint.db list -l stage-analyze --json
```

---

## Lane Definitions

| Lane Label | Status | Meaning | Who Works On It |
|------------|--------|---------|----------------|
| `lane-backlog` | `open` | Queued, not started | Nobody yet |
| `lane-analyzing` | `in_progress` | Issue analysis in progress | issue-analyzer |
| `lane-developing` | `in_progress` | Implementation in progress | implementer |
| `lane-needs-review` | `open` | Implementation done, awaiting reviewer | reviewer claims next |
| `lane-reviewing` | `in_progress` | Quality gates running | reviewer |
| `lane-review-failed` | `open` | Review failed, back to implementer | implementer |
| (closed) | `closed` | All stages complete, ready for MR | team-lead |

**Blocked cards**: Stay in their current lane with deps on other cards. Use `bd --db .beads/sprint.db blocked` to identify them — there is no separate blocked lane.

---

## Card Creation

Cards are created with `bd create`. The bd-assigned ID (e.g. `sprint-a1b2`) is the card's unique identifier.

```bash
bd --db .beads/sprint.db create "Issue #2901667: jQuery removal in toggleEditMode" \
  -p 2 -t task \
  --labels "lane-backlog,stage-develop,issue-2901667" \
  --acceptance "jQuery replaced with native JS; all tests pass; PHPCS clean" \
  --description "Remove jQuery dependency from Settings Tray toggleEditMode function.

## Narrative
- 2026-02-16: Card created as part of team sprint. Analysis pending. (by @team-lead)"
```

---

## Card Fields

| Field | bd Mechanism | Description |
|-------|-------------|-------------|
| id | Auto-assigned (e.g. `sprint-a1b2`) | Unique ID assigned by bd on create. |
| priority | `-p 1` (High) or `-p 2` (Normal) | High-priority cards get DDEV slots first. |
| blocked_by | `--deps "sprint-XXXX"` on create | Cards that must close before this one can advance. |
| assignee | `--claim` / `--assignee ""` | Agent who owns the card. |
| labels | `--labels`, `--add-label`, `--remove-label` | Lane, stage, issue number, topic tags. |
| issue | Label: `issue-2901667` | Drupal.org issue number. |
| stage | Label: `stage-analyze` / `stage-develop` / `stage-validate` | Pipeline phase. |
| ddev | `--set-metadata ddev=true` / `--unset-metadata ddev` | Whether card holds a DDEV slot. Max 3 at once. |
| review_scope | Label: `review-STATIC_ONLY` / `review-DYNAMIC_FULL` etc. | Scope of review work required. |
| fix_loop | Label: `fix-loop-N` | Fix-and-verify iteration count. Escalate at 3. |

---

## Full Pipeline (3 cards per issue)

One card per pipeline stage, chained with `--deps`:

```bash
# Card 1 — analyze (no blockers)
bd --db .beads/sprint.db create "Issue #NNN: analyze" -t task \
  --labels "lane-backlog,stage-analyze,issue-NNN"

# Card 2 — develop (blocked by card 1)
bd --db .beads/sprint.db create "Issue #NNN: implement" -t task \
  --labels "lane-backlog,stage-develop,issue-NNN" \
  --deps "sprint-XXXX"

# Card 3 — validate (blocked by card 2)
bd --db .beads/sprint.db create "Issue #NNN: validate" -t task \
  --labels "lane-backlog,stage-validate,issue-NNN,review-DYNAMIC_FULL" \
  --deps "sprint-YYYY"
```

Create all three up front. Downstream cards unblock automatically when upstream cards are closed.

**Validation-only:** 1 card, `stage-validate` label, no `--deps`.
**Analysis-only:** 1 card, `stage-analyze` label, no `--deps`.

---

## Agent Role Mapping

| Agent | Claims (label filter) | On Pass | On Fail |
|-------|----------------------|---------|---------|
| issue-analyzer | `stage-analyze` from ready queue | `bd close <id>` | Remove `lane-analyzing`, add `lane-backlog` |
| implementer | `stage-develop` from ready queue or `lane-review-failed` | Remove working lane, add `lane-needs-review`, set `--status open --assignee ""` | — |
| reviewer | `lane-needs-review` | `bd close <id>` | Remove `lane-reviewing`, add `lane-review-failed`, set `--status open --assignee ""` |

**Blocked cards**: Stay in their current lane with deps. Check `bd blocked` — there is no separate blocked lane.

---

## Narrative Record

Every card maintains a Narrative section — append-only log of decisions and outcomes.

```bash
bd --db .beads/sprint.db update <id> \
  --append-notes "2026-02-16: Analysis complete. Simple jQuery removal. (by @issue-analyzer)"
```

Never rewrite prior entries. Always append with ISO date and author.

---

## DDEV Slot Management

Max 3 concurrent DDEV instances across all cards on the board.

- **Claiming**: Count ddev metadata cards: `bd --db .beads/sprint.db list --metadata-field ddev=true --json | jq 'length'`. If < 3, `bd update <id> --set-metadata ddev=true`, run `ddev start`.
- **Releasing**: Run `ddev stop`, `bd update <id> --unset-metadata ddev`, append narrative.
- **Phase 1** (phpcs, phpstan): No DDEV needed — run immediately.
- **Phase 2** (phpunit, browser tests): DDEV required — queue if 3 slots full.

---

## Cross-References

- **Universal kanban rules:** `sprint:kanban`
- **Sprint orchestration:** `sprint:run`
- **Spawning mechanics:** `../protocols/SPAWNING.md`
- **Decision rules:** `../skills/run/references/decision-framework.md`
