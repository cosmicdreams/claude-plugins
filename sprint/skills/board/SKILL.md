---
name: board
description: Board-specific rules for the sprint Beads database (.beads/sprint.db). Use before creating, claiming, or interpreting any card in the sprint board. Provides lane definitions, card fields, DDEV slot rules, and agent role mappings. Trigger phrases include "create sprint card", "show sprint board", "sprint board columns", "add issue to sprint", "open sprint board", "launch sprint board". Always pair with sprint:kanban for universal kanban rules. Do NOT use for the retrospective-actions board -- use retro:kanban instead.
---

# Sprint-Board — Team Sprint Board

Board-specific rules for `.beads/sprint.db`. Read `sprint:kanban` first for universal standards that apply to all boards.

For sprint orchestration (spawning agents, running the pipeline): read `sprint:run`.

**Board database:** `.beads/sprint.db`
**Purpose:** Issues flowing through the vertical slice pipeline during a team sprint. One card per issue, one agent per issue end-to-end.

---

## Board View

View the sprint board via bd CLI:

```bash
# All cards grouped by status
bd list -l board-sprint --json | jq 'group_by(.status)'

# Ready to claim (unblocked, unassigned)
bd ready -l board-sprint --json --unassigned

# In-progress work
bd list -l board-sprint -s in_progress --json

# Blocked work
bd blocked

# Done (closed)
bd list -l board-sprint -s closed --json

# Filter by lane
bd list -l board-sprint -l lane-in-progress --json

# Cards needing cross-review
bd list -l board-sprint -l lane-needs-cross-review --json
```

---

## Lane Definitions

| Lane Label | Status | Meaning | Who Works On It |
|------------|--------|---------|----------------|
| `lane-backlog` | `open` | Queued, unassigned | Nobody yet |
| `lane-in-progress` | `in_progress` | Slice-worker owns it end-to-end | slice-worker |
| `lane-needs-cross-review` | `open` | Slice done, awaiting cross-review (if required) | — |
| `lane-cross-reviewing` | `in_progress` | Cross-reviewer validating | cross-reviewer |
| (closed) | `closed` | Done | — |

**Blocked cards**: Stay in their current lane with deps on other cards. Use `bd blocked` to identify them — there is no separate blocked lane.

---

## Card Creation

Cards are created with `bd create`. The bd-assigned ID (e.g. `sprint-a1b2`) is the card's unique identifier.

One card per issue. The slice-worker handles all phases (analyze, implement, test, validate) within a single card.

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

---

## Card Fields

| Field | bd Mechanism | Description |
|-------|-------------|-------------|
| id | Auto-assigned (e.g. `sprint-a1b2`) | Unique ID assigned by bd on create. |
| priority | `-p 1` (High) or `-p 2` (Normal) | High-priority cards get DDEV slots first. |
| blocked_by | `--deps "sprint-XXXX"` on create | Cards that must close before this one can advance. |
| assignee | `--claim` / `--assignee ""` | Agent who owns the card. |
| labels | `--labels`, `--add-label`, `--remove-label` | Lane, issue number, cross-review flag, topic tags. |
| issue | Label: `issue-2901667` | Drupal.org issue number. |
| cross-review | Label: `cross-review-yes` / `cross-review-no` | Whether cross-review is required (risk-based). |
| ddev | `--set-metadata ddev=true` / `--unset-metadata ddev` | Whether card holds a DDEV slot. Max 3 at once. |
| fix_loop | Label: `fix-loop-N` | Fix-and-verify iteration count. Escalate at 3. |

---

## Agent Role Mapping

| Agent | Claims | On Complete | On Cross-Review Fail |
|-------|--------|-------------|---------------------|
| slice-worker | `lane-backlog` from ready queue | If `cross-review-yes`: move to `lane-needs-cross-review`. If `cross-review-no`: `bd close <id>` | Resume work on returned card |
| cross-reviewer | `lane-needs-cross-review` | `bd close <id>` | Remove `lane-cross-reviewing`, add `lane-in-progress`, set `--status open --assignee ""` |

**Blocked cards**: Stay in their current lane with deps. Check `bd blocked` — there is no separate blocked lane.

---

## Narrative Record

Every card maintains a Narrative section — append-only log of decisions and outcomes.

```bash
bd update <id> \
  --append-notes "2026-03-18: Root cause identified — jQuery once() used where addEventListener suffices. (by @slice-1)"
```

Never rewrite prior entries. Always append with ISO date and author.

---

## DDEV Slot Management

Max 3 concurrent DDEV instances across all cards on the board. See `lib:ddev` for general DDEV lifecycle and troubleshooting.

Each slice-worker self-manages DDEV slots:

- **Check availability**: `bd list -l board-sprint --metadata-field ddev=true --json | jq 'length'`. If < 3, claim.
- **Claiming**: `bd update <id> --set-metadata ddev=true`, run `ddev start`.
- **Releasing**: Run `ddev stop`, `bd update <id> --unset-metadata ddev`, append narrative.
- **Static analysis first** (phpcs, phpstan): No DDEV needed — run immediately even if slots full.
- **Runtime tests** (phpunit, browser tests): DDEV required — do static analysis first if slots full, then poll or notify team-lead.

---

## Cross-References

- **Universal kanban rules:** `sprint:kanban`
- **Sprint orchestration:** `sprint:run`
