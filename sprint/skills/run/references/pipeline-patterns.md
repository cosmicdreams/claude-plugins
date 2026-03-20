# Pipeline Patterns Catalog

Quick reference for choosing the right pipeline variant. For full streaming pipeline mechanics (pull protocol, idle handling, bottleneck detection, resource constraints), see `streaming-pipeline.md`.

## Pattern Selection

| Situation | Pattern | Cards | DDEV Needed |
|-----------|---------|-------|-------------|
| New issues, end-to-end | Vertical Slice | 1 per issue | Yes (test phase) |
| Patches exist, need testing | Validation-Only | 1 per issue | Yes |
| Triage / prioritization | Analysis-Only | 1 per issue | No |
| Slice-worker hits 3-fix limit | Escalation | Same card + deep-debugger | Yes |

## Vertical Slice (Default)

```
Issue A:  [SLICE-WORKER: analyze → implement → test → validate] --> CROSS-REVIEW? --> DONE
Issue B:  [SLICE-WORKER: analyze → implement → test → validate] --> CROSS-REVIEW? --> DONE
Issue C:  [SLICE-WORKER: analyze → implement → test → validate] --> ...
```

- One card per issue, one agent per issue end-to-end
- No handoffs between roles — context preserved across all phases
- Team: N slice-workers + cross-reviewers as needed
- DDEV needed during test phase only
- Cross-review is risk-based (`cross-review-yes` / `cross-review-no` label)

## Validation-Only

```
Issue A:  [SLICE-WORKER: test → validate] --> DONE
Issue B:  [SLICE-WORKER: test → validate] --> DONE
Issue C:  [SLICE-WORKER: test → validate] --> DONE
```

- For existing patches/worktrees that need quality gates
- Slice-workers skip analysis and implementation phases
- DDEV needed for runtime tests

## Analysis-Only

```
Issue A:  [SLICE-WORKER: analyze] --> Report
Issue B:  [SLICE-WORKER: analyze] --> Report
...
Issue N:  [SLICE-WORKER: analyze] --> Report
```

- For triage before committing to development
- Slice-workers analyze only, write root cause to card narrative
- No DDEV, no resource constraints
- Can handle 10+ issues per session

## Escalation (3-Fix Limit)

```
slice-worker hits 3-fix limit --> deep-debugger takes over --> slice-worker resumes (or card escalated to user)
```

- When a slice-worker fails 3 times on the same issue
- Deep-debugger receives the full context (card narrative, attempts, hypotheses)
- Deep-debugger either resolves or escalates to team-lead/user

## DDEV Slot Strategy

3 slots available. Each slice-worker self-manages:

1. Do static analysis (phpcs, phpstan) first — no DDEV needed
2. Check slot count before claiming DDEV
3. If full: wait or notify team-lead
4. Release immediately after tests complete

**Slot lifecycle**: `FREE --> ddev start (~30s) --> tests (5-30 min) --> ddev stop (~10s) --> FREE`

## Pipeline Health Metrics

| Metric | Healthy | Warning | Action |
|--------|---------|---------|--------|
| Agent idle time | <10% | 10-25% | >25%: check board, spawn more |
| DDEV utilization | 2-3 active | 1 active | 0: agents may be stuck on static analysis |
| Backlog trend | Decreasing | Stable | Growing: add slice-workers |
| Time per issue | <30 min | 30-60 min | >60 min: investigate complexity |
| Fix loops | 0-1 | 2 | 3: escalate to deep-debugger |
| Cross-review queue | 0-1 waiting | 2-3 waiting | >3: spawn additional cross-reviewer |
