# Step 3 — Dedup and Score Against the Profile

## Dedup against the vault baseline

Compare fetched titles/summaries against the baseline headlines from step 1:
- Core topic matches an existing entry (same tool, announcement, concept) → **duplicate**, skip.
- Adds new detail to an existing entry → **augment** (update in place).
- No match → **net-new**.

Err toward net-new when uncertain. Honor the dedup horizon from config (`scout.dedup_horizon`,
default: today's note + the last 7 days of `Raw/*-scout.md`).

## Score relevance against the interest profile

This is the filter that makes scout better than a plain aggregator. For each net-new item, score
against the **interest profile** (from step 1), not from scratch:

- **+** for each `interests` topic it matches.
- **−** for each `anti_interests` topic it matches (suppress).
- Apply **feedback weights**: multiply by the source weight and any `topic:` weights from
  `feedback_weights` (sources/topics you marked useful boost; muted ones drop toward zero).

Then sanity-check the survivors with three lenses (tie-breakers, not the primary filter):

| Lens | Question |
|---|---|
| **Pragmatist** | Actionable in my workflow today? |
| **Trends** | Signals where the ecosystem is heading? |
| **Builder** | Would I build something differently because of this? |

**Verdict:**
- **Keep** — clears the profile score threshold (default: any positive score with no anti-interest), or 1 lens strongly yes.
- **Watch** — directionally relevant, no immediate action.
- **Skip** — net-negative or no lens finds value.

Record, per kept item, **why it matched** (which interest topic / which source weight) — step 4
surfaces this so the filtering is inspectable.

## Source candidates

Any `[SOURCE CANDIDATE]` from step 2 that produced a **Keep** carries forward to step 4 for review.

Proceed to `steps/04-store-output.md` with: kept items (each with its match reason), augments, skip
count, source candidates.
