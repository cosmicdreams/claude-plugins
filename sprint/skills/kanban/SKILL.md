---
name: kanban
description: >
  Universal kanban conventions covering every board here — card format, lane moves, state
  queries. Required reading before touching any board, then read the board-specific skill
  (sprint:board or retro:kanban) for lane definitions. Never sufficient on its own.
---

# Kanban — Universal Standards

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Universal kanban standards that apply to every board in this project. Use when creating a card, moving a card between lanes, querying card state, or understanding kanban conventions. This is required reading before touching any kanban board. Trigger phrases include "work a ticket", "advance a card", "update the board", "create a card", "kanban rules", "card format". After reading this, also read the board-specific skill (sprint:board for sprint, retro:kanban for retrospective-actions) for lane definitions. Do NOT use this as the sole reference for a specific board -- always pair with the board-specific skill.

All kanban boards in this project follow these rules. Board-specific rules
(card format, naming, lifecycle details) are documented alongside each board.

---

## Core Mechanic

Cards are Beads issues. **Status is a field (`open`, `in_progress`, `closed`). Lane is a label (`lane-backlog`, `lane-in-progress`, etc.).**

Moving a card between lanes = updating labels:

```bash
bd --db <board.db> update <id> --remove-label lane-<old> --add-label lane-<new>
```

Claiming a card (sets assignee and status to `in_progress`):

```bash
BD_ACTOR=<your-name> bd --db <board.db> update <id> --claim --add-label lane-<working-lane>
```

Completing a card:

```bash
bd --db <board.db> close <id> --reason "Review passed."
```

No directory structure is needed — the database is the source of truth.

---

## Universal Lifecycle

Every board uses Beads statuses (`open`, `in_progress`, `closed`) combined with lane labels to represent workflow stages. The specific lane labels and their meaning are defined in each board's documentation.

### Lane Label Convention

All lane labels use the `lane-` prefix:

```
lane-backlog          ← Entry point for new cards
lane-<stage>          ← Intermediate stages (board-specific)
...
closed                ← Terminal state (no lane label needed)
```

**Why labels:** Labels are queryable (`bd list -l lane-backlog`), composable (a card can have multiple lane and metadata labels), and don't require filesystem operations to change.

**Rule:** Every formal pipeline stage uses a `lane-` prefixed label. Boards may define as many intermediate lane labels as needed in their own documentation.

---

## Hard Rules (apply to every board)

1. **Claim before working** — use `bd update <id> --claim` before starting. This is how the team knows work is claimed.
2. **`closed` is terminal** — only close a card (`bd close`) when the work is fully verified, not just completed.
3. **Rejected cards are deleted** — there is no archive state. Cards not worth pursuing are removed.
4. **Narrative is append-only** — every card with a Narrative section must only have entries appended via `--append-notes`, never rewritten or deleted.
   - Format: `YYYY-MM-DD: Note. (by @name)`
   - Record decisions and discoveries, not just status changes.
5. **One card, one owner** — `--claim` sets the assignee. Use `--assignee ""` to clear when handing off.

---

## Board Locations

| Board | Database | Board-specific docs |
|-------|----------|---------------------|
| Team sprint | `bd` | `sprint:board` |
| Retrospective actions | `bd` | `retro:kanban` |
