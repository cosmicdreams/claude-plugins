---
name: ideas-funnel:supervise
description: >
  Fable-owned supervisory loop for the ideas-funnel. Reads backlog, recent raw
  notes, stats, conflicts, and domain health; decides what should run next;
  emits a bounded plan for cheaper worker agents. Trigger phrases:
  "supervise the funnel", "/ideas-funnel:supervise", "review funnel health".
triggers:
  - /ideas-funnel:supervise
  - supervise the funnel
  - review funnel health
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

**Used by:** pipeline Workflow at the start of every run + human for manual health review.

# ideas-funnel:supervise

Use Fable as the strategist, not the bulk worker.

## Inputs

Read:

1. `~/Vaults/Neurons/wiki-schema.md`
2. `~/Vaults/Neurons/CRITICAL_FACTS.md`
3. `~/Vaults/Neurons/_meta/stats.md`
4. `~/Vaults/Neurons/_meta/conflicts.md`
5. `~/Vaults/Neurons/Raw/.manifest.json`
6. `~/.config/ideas-funnel/domains/*.yaml`
7. Recent root daily notes: `Raw/YYYY-MM-DD.md` for the last 3 days.

Use `bd list --label ideas-funnel --limit 0 --json` when `bd` is available to
measure lane pressure.

## Decide

Return a JSON plan with:

```json
{
  "run_ingest": true,
  "domains": ["ai-workflows"],
  "max_items_per_domain": 12,
  "priority_terms": ["Fable", "subagents", "GPT-5.5"],
  "run_refinery": true,
  "run_lint": true,
  "run_decay": true,
  "run_rescue": true,
  "budget": {
    "max_worker_tasks": 8,
    "max_expensive_tasks": 2,
    "preferred_worker_model": "gpt-5.5",
    "cheap_worker_model": "sonnet-or-local"
  },
  "unknowns": [
    "What source cluster is underrepresented?",
    "What stale belief needs contradiction checks?"
  ],
  "notes": "One paragraph rationale."
}
```

## Policy

- Fable keeps the loop coherent: priorities, unknown discovery, conflicts,
  model-routing decisions, and final synthesis.
- Worker agents do expensive or repetitive work: source extraction, dedupe,
  clustering, URL fetches, backlink counting, and validation.
- Backpressure beats completeness. If raw or Beads backlog is high, pick the
  top-N items by expected value instead of trying to clear everything.
- Prefer surfacing fewer, higher-quality items over adding more cards.
- Do not write wiki pages. Emit the plan only; workers and Refinery write.
