---
name: ideas-funnel:stats
description: >
  Writes _meta/stats.md with pipeline health, backlog counts, model-routing
  usage, confidence distribution, stale raw counts, and recent outcomes.
  Trigger phrases: "funnel stats", "/ideas-funnel:stats".
triggers:
  - /ideas-funnel:stats
  - funnel stats
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

**Used by:** pipeline Workflow at the end of every run + Fable supervisor on the next run.

# ideas-funnel:stats

Update `~/Vaults/Neurons/_meta/stats.md` so supervision has evidence.

## Capture

- Raw inbox counts per domain.
- Beads lane counts for `ideas-funnel` labels when `bd` is available.
- Sources/concepts/entities written this run.
- Density signals, refinery promotions, conflicts, bridges.
- Lint health: errors, warnings, stale raw items.
- Decay state counts: fresh, stable, at_risk, archived, hardened.
- Model-routing counts: Fable decisions, GPT-5.5 worker tasks, cheap/local tasks.
- Budget notes: capped items, skipped items, expensive-task count.

## Format

Overwrite `_meta/stats.md` with a compact current snapshot plus append a dated
entry under `## History`.

Use this shape:

```markdown
# Ideas Funnel Stats

last_updated: YYYY-MM-DD

## Current
- raw_inbox_total: N
- bd_lane_inbox: N
- bd_lane_ready: N
- confidence: fresh=N stable=N at_risk=N archived=N hardened=N
- models: fable=N gpt-5.5=N cheap=N shell=N
- overall: HEALTHY | NEEDS_ATTENTION | UNHEALTHY

## History
### YYYY-MM-DD
- ...
```
