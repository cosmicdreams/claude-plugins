---
name: ideas-funnel:rescue
description: >
  Recovers stalled or weak memory: stale raw inbox items, orphan domain pages,
  at-risk concepts, and unlinked mentions. Trigger phrases: "rescue funnel",
  "/ideas-funnel:rescue".
triggers:
  - /ideas-funnel:rescue
  - rescue funnel
allowed-tools:
  - Bash
  - Read
  - Edit
  - Grep
  - Glob
---

**Used by:** nightly pipeline after lint/decay + human when backlog or graph health degrades.

# ideas-funnel:rescue

Recover useful material without promoting noise.

## Inputs

- Lint report from the current run.
- `_meta/stats.md`
- Pages with `state: at_risk`.
- Raw files older than 7 days and not in `Raw/.manifest.json`.
- Domain pages with `backlink_density: 0`.

## Actions

1. For stale raw items: group by source/domain and recommend top-N for next
   Fable-supervised ingest. Do not blindly process the whole backlog.
2. For orphans: search for exact title mentions and add candidate links only
   when confidence is high.
3. For `at_risk` pages: add them to the review lane or write a compact
   `log.md` rescue line if Beads is unavailable.
4. For repeated stale themes: emit a recommendation for `ideas-funnel:supervise`
   to add a priority term or suppress a noisy feed.

## Output

Return JSON:

```json
{
  "stale_raw_candidates": [],
  "orphans_linked": 0,
  "at_risk_reviewed": 0,
  "feed_adjustment_recommendations": []
}
```
