# Step 3 — Diff and Debate

## Diff against vault baseline

Compare fetched story titles and summaries against the baseline headlines from Step 1.

**Dedup rules:**
- Core topic matches a vault entry (same tool, announcement, concept) → **duplicate**, skip
- Adds new detail to an existing vault entry → **augment** (update in place)
- No match → **net-new**

Err toward net-new when uncertain.

## Debate relevance

For each net-new story, score using three lenses:

| Lens | Question |
|---|---|
| **Pragmatist** | Is this actionable today in my workflow? |
| **Trends** | Does this signal where the ecosystem is heading? |
| **Builder** | Would I build something differently because of this? |

**User workflow context:** Claude Code-heavy, multi-agent sprints, Claude-Plugins system
(`~/Tools/CLAUDE-PLUGINS`), octo skills, Obsidian vault, recurring research loops.

**Verdict:**
- **Keep** — 2+ lenses say yes, or 1 lens says strongly yes
- **Watch** — directionally relevant but no immediate action
- **Skip** — no lens finds value

## Watch item hits

If any active watch item from Step 1 matches a fetched story, flag it with `[WATCH HIT]`.

Proceed to `steps/04-store-output.md` with: kept stories, augments, watch hits, skip count.
