---
name: rescue
description: >
  Recovers stalled or weak memory: stale raw inbox items, orphan domain pages,
  at-risk concepts, and unlinked mentions. Trigger phrases: "rescue funnel",
  "/ideas-funnel:rescue".
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

1. For stale raw items: group by source/domain and recommend top-N for next coordinator-supervised ingest. Exclude terminal `skipped` and `rejected` items. Do not blindly process the whole backlog.
2. For orphans: search non-excluded wiki pages (`Sources/`, `Concepts/`, `Entities/`, `Domains/`) for exact title mentions and propose up to 15 high-confidence wikilink insertions per run so rescue actively reduces orphan count. Never add links inside `Research-Lab/` or `Archive/`.
3. For `at_risk` pages: add them to the review lane or write a compact `log.md` rescue line if Beads is unavailable.
4. For repeated stale themes, feed timeouts, or skipped opaque redirects (`_meta/ideas-funnel-pull.json`): emit a concrete recommendation for `ideas-funnel:supervise` to add a priority term, suppress a noisy feed, or remove an unfetchable redirect feed.

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

Scheduled and manual writes follow `ideas-funnel:dispatch` durable ownership; workers propose and only the coordinator applies changes. Runtime routing follows `ideas-funnel:delegate`, superseding legacy generated model instructions.
