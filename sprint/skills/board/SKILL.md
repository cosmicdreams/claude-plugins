---
name: board
description: Use before creating, moving, or interpreting any card in kanban/sprint-run/. Required reading before any sprint board operation. Also use when you need lane definitions, card frontmatter fields, or board conventions for the team-sprint pipeline. Always pair with sprint:kanban for universal rules.
triggers:
  - "create sprint card"
  - "show sprint board"
  - "work sprint ticket"
  - "advance sprint card"
  - "sprint board columns"
  - "add issue to sprint"
  - "open sprint board"
  - "launch sprint board"
  - "show sprint kanban"
allowed-tools:
  - Bash
---

# Sprint-Board — Team Sprint Board

Board-specific rules for `kanban/sprint-run/`. Read `sprint:kanban` first for universal standards that apply to all boards.

For sprint orchestration (spawning agents, running the pipeline): read `sprint:run`.

**Board path:** `kanban/sprint-run/`
**Purpose:** Issues flowing through the analyze → develop → review pipeline during a team sprint.

---

## UI Mode

Launch the sprint kanban board UI for visual management of sprint-run cards.

### Launch command

```bash
SPRINT_VERSION=$(ls ~/.claude/plugins/cache/local/sprint/ 2>/dev/null | sort -V | tail -1)
KANBAN_SERVER=~/.claude/plugins/cache/local/sprint/$SPRINT_VERSION/tools/kanban-ui/server.js

BOARD_DIR="$(pwd)/kanban/sprint-run"

node "$KANBAN_SERVER" \
  --dir "$BOARD_DIR" \
  --name "Sprint Board" \
  --lanes "1_backlog,2_analyzing,3_developing,4_needs-review,5_reviewing,6_review-failed,7_done" \
  --port 3748 &
```

---

## Directory Structure

```
kanban/sprint-run/
├── 1_backlog/        ← Queued, not yet started
├── 2_analyzing/      ← Issue analysis in progress (issue-analyzer)
├── 3_developing/     ← Implementation in progress (implementer)
├── 4_needs-review/   ← Implementation done, awaiting reviewer
├── 5_reviewing/      ← Quality gates running (reviewer)
├── 6_review-failed/  ← Review failed, returned to implementer
└── 7_done/           ← All stages complete, ready for MR (terminal)
```

Numbered prefixes make `ls` output reflect workflow order. New cards always start in `1_backlog/`.

---

## Card Naming Convention

```
{issue-number}-{short-desc}-{stage}.md
```

Examples:
- `2901667-toggle-edit-mode-develop.md` — develop card for issue 2901667
- `3345989-loading-indicator-validate.md` — validate card for issue 3345989

---

## Card Format

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

---

## Card Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique integer. Scan all directories in `kanban/sprint-run/` (1_backlog through 7_done), take max + 1. |
| `priority` | No | `High` or `Normal` (default). High-priority cards get DDEV slots first. |
| `blocked_by` | No | List of card IDs that must reach `done/` before this card can advance. `[]` if unblocked. |
| `assignee` | No | Agent name who owns the card (e.g., `implementer-1`). Clear when handing off. |
| `tags` | No | Labels for filtering (e.g., `[settings-tray, jquery, wcag]`). |
| `issue` | No | Drupal.org issue number. Links card to worktree and analysis report. |
| `stage` | No | Pipeline phase: `analyze`, `develop`, `validate`. |
| `ddev` | No | `true` if this card holds a DDEV slot. Max 3 cards with `ddev: true` at once. |
| `review_scope` | No | Scope of review work required (e.g., `STATIC_ONLY`, `FULL`, `DDEV_REQUIRED`). |
| `fix_loop` | No | Number of fix-and-verify iterations. Escalate to team-lead at 3. |

No `status:` field — the directory IS the status.

> **Backward compatibility:** Cards created before v1.3.0 may use `validation_scope` — this is accepted as an alias for `review_scope`.

---

## Full Pipeline (3 cards per issue)

One card per pipeline stage, chained with `blocked_by`:

```
Card 1 — analyze  (no blockers) → starts in 1_backlog/
Card 2 — develop  (blocked_by: [card1-id]) → starts in 1_backlog/
Card 3 — validate (blocked_by: [card2-id]) → starts in 1_backlog/
```

Create all three up front. Downstream cards unlock automatically when upstream cards reach `7_done/`.

**Validation-only:** 1 card, `stage: validate`, no blockers.
**Analysis-only:** 1 card, `stage: analyze`, no blockers.

---

## Agent Role Mapping

| Agent | Claims From | Moves To (pass) | Moves To (fail) |
|-------|------------|----------------|----------------|
| issue-analyzer | `1_backlog/` (stage: analyze) | `7_done/` | `1_backlog/` |
| implementer | `1_backlog/` (stage: develop) or `6_review-failed/` | `4_needs-review/` | — |
| reviewer | `4_needs-review/` | `5_reviewing/` → `7_done/` | `6_review-failed/` |

**Blocked cards**: Stay in their current directory with a non-empty `blocked_by`. Check `blocked_by` to identify blocked cards — there is no separate blocked directory.

---

## Narrative Record

Every card maintains a `## Narrative` section — append-only log of decisions and outcomes.

```markdown
## Narrative
- 2026-02-16: Analysis complete. Simple jQuery removal. (by @issue-analyzer)
- 2026-02-16: Implementation done in worktrees/2901667/. (by @implementer-1)
- 2026-02-16: Review passed. All green. Ready for MR. (by @reviewer)
```

Never rewrite prior entries. Always append with ISO date and author.

---

## DDEV Slot Management

Max 3 concurrent DDEV instances across all cards on the board.

- **Claiming**: Count `ddev: true` cards in all directories. If < 3, set `ddev: true`, run `ddev start`.
- **Releasing**: Run `ddev stop`, set `ddev: false`, append to Narrative.
- **Phase 1** (phpcs, phpstan): No DDEV needed — run immediately.
- **Phase 2** (phpunit, browser tests): DDEV required — queue if 3 slots full.

---

## Board Scripts

```bash
PLUGIN_DIR=$(ls -d ~/.claude/plugins/cache/local/sprint/*/ | sort -V | tail -1)

# View full board
bash "$PLUGIN_DIR/skills/run/scripts/view_board.sh" kanban/sprint-run/

# Pipeline status (DDEV slots, stage counts)
bash "$PLUGIN_DIR/skills/run/scripts/pipeline_status.sh" kanban/sprint-run/

# Show blocked cards
bash "$PLUGIN_DIR/skills/run/scripts/show_blocked.sh" kanban/sprint-run/

# Search by tag
bash "$PLUGIN_DIR/skills/run/scripts/search_by_tag.sh" kanban/sprint-run/ <tag>

# Search card content
bash "$PLUGIN_DIR/skills/run/scripts/search_content.sh" kanban/sprint-run/ "<term>"

# List all cards
bash "$PLUGIN_DIR/skills/run/scripts/list_all_cards.sh" kanban/sprint-run/
```

---

## Cross-References

- **Universal kanban rules:** `sprint:kanban`
- **Sprint orchestration:** `sprint:run`
- **Spawning mechanics:** `../protocols/SPAWNING.md`
- **Decision rules:** `../skills/run/references/decision-framework.md`
