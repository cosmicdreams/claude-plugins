---
name: kanban
description: Use when creating a card, moving a card between lanes, reading card frontmatter, or understanding Kanban board conventions. Always read before touching any kanban board. Trigger phrases: "work a ticket", "advance a card", "update the board", "create a card". Then read the board-specific skill (sprint:board or sprint:retro-kanban) for lane definitions.
---

# Kanban — Universal Standards

All kanban boards in this project follow these rules. Board-specific rules
(card format, naming, lifecycle details) are documented alongside each board.

---

## Core Mechanic

Cards are `.md` files. **The directory a card lives in is its status.**
Moving a card = moving the file.

```
mv kanban/{board}/{from-status}/{card}.md kanban/{board}/{to-status}/{card}.md
```

No `status:` field in frontmatter is needed — the directory is the source of truth.

---

## Universal Lifecycle

Every board has at minimum an entry directory, optional intermediate stages, and a terminal `done` directory. The specific names and number of stages are defined in the board's own documentation.

### Numbered Prefix Convention

All formal pipeline stages use numeric prefixes:

```
1_<entry>/        ← Entry point for new cards
2_<stage>/        ← Intermediate stages (board-specific)
...
N_done/           ← Terminal state
```

**Why:** `ls` output is alphabetically sorted. Numeric prefixes make the directory listing reflect actual workflow order.

**Rule:** Every formal pipeline stage is numbered. Boards may add as many intermediate numbered stages as needed. Those are defined in each board's own documentation.

---

## Hard Rules (apply to every board)

1. **Claim before working** — move a card to your board's in-progress directory before starting. This is how the team knows work is claimed.
2. **`N_done/` is terminal** — only move a card to the board's final done directory when the work is fully verified, not just completed.
3. **Rejected cards are deleted** — there is no archive directory. Cards not worth pursuing are removed.
4. **Narrative is append-only** — every card with a `## Narrative` section must only have entries appended, never rewritten or deleted.
   - Format: `- YYYY-MM-DD: Note. (by @name)`
   - Record decisions and discoveries, not just status changes.
5. **One card, one owner** — set `assignee` when claiming. Clear it if you hand off.

---

## Board Locations

| Board | Path | Board-specific docs |
|-------|------|---------------------|
| Team sprint | `kanban/sprint-run/` | `sprint:board` |
| Retrospective actions | `kanban/retrospective-actions/` | `sprint:retro-kanban` |
