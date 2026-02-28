# Pipeline Patterns Catalog

Quick reference for choosing the right pipeline variant. For full streaming pipeline mechanics (pull protocol, idle handling, bottleneck detection, resource constraints), see `streaming-pipeline.md`.

## Pattern Selection

| Situation | Pattern | Stages | DDEV Needed |
|-----------|---------|--------|-------------|
| New issues, end-to-end | Full Pipeline | analyze -> develop -> validate | Yes (validate) |
| Patches exist, need testing | Validation-Only | validate | Yes |
| Triage / prioritization | Analysis-Only | analyze | No |
| Validation failed, needs fix | Fix-and-Verify Loop | fix -> re-validate | Yes |

## Full Pipeline (Default)

```
Issue A:  [ANALYZE] --> [DEVELOP] --> [VALIDATE] --> DONE
Issue B:       [ANALYZE] --> [DEVELOP] --> [VALIDATE] --> DONE
Issue C:            [ANALYZE] --> [DEVELOP] --> ...
```

- Each issue flows independently (no batch gates)
- Team: 1+ analyzers, 1+ developers, 1+ validators
- DDEV needed for validate stage only

## Validation-Only

```
Issue A:  [VALIDATE] --> DONE
Issue B:  [VALIDATE] --> DONE
Issue C:  [VALIDATE] --> DONE
```

- For existing patches/worktrees
- Team: validators only (1 per issue, max 3 for DDEV limit)
- Queue remaining if >3 issues

## Analysis-Only

```
Issue A:  [ANALYZE] --> Report
Issue B:  [ANALYZE] --> Report
...
Issue N:  [ANALYZE] --> Report
```

- For triage before committing to development
- Team: 2-3 analyzers in parallel
- No DDEV, no resource constraints
- Can handle 10+ issues per session

## Fix-and-Verify Loop

```
validate-A FAILS --> [FIX] --> [RE-VALIDATE] --> PASS (or loop again)
```

- On validation failure, create unblocked fix task + blocked re-validate task
- Track loop count in task metadata: `{"fix_loop": N}`
- Max 3 loops, then escalate to team-lead

## DDEV Slot Strategy

3 slots available. Allocate by priority:

1. Issues closest to DONE (fastest to free a slot)
2. Simplest expected validation (fast turnaround)
3. Issues with known test failures (need DDEV to debug)

**Slot lifecycle**: `FREE --> ddev start (~30s) --> tests (5-30 min) --> ddev stop (~10s) --> FREE`

**Two-phase split**: Phase 1 (static analysis) needs no DDEV. Phase 2 (runtime tests) needs DDEV. Start Phase 1 for all issues immediately; queue Phase 2 for DDEV slots.

## Pipeline Health Metrics

| Metric | Healthy | Warning | Action |
|--------|---------|---------|--------|
| Agent idle time | <10% | 10-25% | >25%: rebalance |
| DDEV utilization | 2-3 active | 1 active | 0: start instances |
| Backlog trend | Decreasing | Stable | Growing: add agents |
| Time per stage | <15 min | 15-30 min | >30 min: investigate |
| Fix loops | 0-1 | 2 | 3+: escalate |
