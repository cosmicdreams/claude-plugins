---
name: ideas-funnel:delegate
description: >
  Model-routing policy for ideas-funnel work. Classifies each task as Fable,
  GPT-5.5/expensive worker, cheap/local worker, or deterministic shell work.
  Trigger phrases: "route funnel work", "/ideas-funnel:delegate",
  "choose worker model".
triggers:
  - /ideas-funnel:delegate
  - route funnel work
  - choose worker model
allowed-tools:
  - Read
---

**Used by:** `ideas-funnel:supervise`, pipeline Workflow prompts, and humans when changing model policy.

# ideas-funnel:delegate

Use the cheapest model that can do the job without compromising the memory graph.

## Routing Matrix

| Task | Route |
|---|---|
| Loop design, unknown discovery, conflict arbitration, final synthesis | Fable |
| Large article extraction, multi-source clustering, long-context comparison, source-quality judgment | GPT-5.5 worker |
| RSS/title filtering, obvious duplicate detection, manifest checks, backlink counts, file inventory | cheap/local worker or shell |
| Shared `Concepts/`, `Entities/`, `Bridges/`, `Conflicts/` writes | Refinery only |
| Human-facing promotion decisions | Fable recommendation, human final call |

## Budget Rules

- Default daily cap: `max_worker_tasks: 8`, `max_expensive_tasks: 2`.
- Escalate to GPT-5.5 only when the task needs long context, nuanced synthesis,
  or expensive comparison across many sources.
- Do not use Fable for bulk extraction, feed polling, manifest repair, or
  mechanical linting.
- Record every routed task in `_meta/stats.md` or the Workflow output with:
  `task`, `route`, `reason`, `model`, and estimated cost if available.

## Output

Return JSON:

```json
{
  "task": "cluster recent Fable sources",
  "route": "gpt-5.5-worker",
  "reason": "Long-context comparison across multiple source notes",
  "max_items": 12,
  "requires_refinery": true
}
```
