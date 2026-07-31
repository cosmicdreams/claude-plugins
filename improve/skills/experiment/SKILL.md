---
name: experiment
description: >
  Run an uncertain process improvement on the ratchet pattern: baseline, change, measure
  again, keep if better and revert if worse. For when you need evidence before committing.
  Not for known fixes (improve:fix).
triggers:
  - "experiment with this process"
  - "try improving"
  - "test this change"
  - "improve:experiment"
---

# Experiment: Ratchet-Based Process Improvement

Measure before, change, measure after, decide.

## When to use

- You have a hypothesis, the outcome is uncertain, the change is reversible, and there's something observable to measure.
- If you're certain the change is an improvement → `improve:fix`.
- If you're watching for patterns → `improve:lint`.

## The Ratchet Pattern

```
1. State the hypothesis
2. Define what "better" means (the metric)
3. Measure baseline
4. Make the change (via improve:fix)
5. Measure again
6. Compare; keep if better, revert if not
7. Record the result
```

## Hypothesis template

```
Hypothesis: <what you think will improve>
Change: <what and where>
Expected effect: <what you expect>
Risk: <what could go wrong>
Reversibility: <how to undo>
```

## Metric types

| Type | Examples | How to measure |
|---|---|---|
| Quantitative | Error count, retry rate, task time, token cost | Logs, JSONL, timestamps |
| Behavioral | Agent follows instructions, stops retrying | Transcript analysis |
| Structural | Prompt is clearer, fewer steps needed | Before/after diff |
| Outcome | Better results, fewer failures | Human judgment |

For subjective metrics, state evaluation criteria upfront so the comparison is fair.

## Decision table

| Result | Action |
|---|---|
| Clearly better | Keep. Consider creating a lint rule. |
| Marginally better | Keep, note the margin. |
| No difference | Revert — unnecessary complexity. |
| Worse | Revert immediately. Record why hypothesis was wrong. |
| Mixed | Surface to human. |

## Result record

```markdown
## Experiment: <name>
**Date:** <ISO date>
**Hypothesis:** <what you tested>
**Change:** <what, where>
**Baseline:** <metric values before>
**Result:** <metric values after>
**Decision:** kept | reverted | escalated
**Learning:** <what this tells you>
```

## Experiment ethics

- Never experiment on a process during critical work without telling the human
- Always have a revert plan before starting
- Revert first, analyze second if an experiment causes a failure
- One variable at a time

## Available measurement harnesses

| Target | Skill | Key scores |
|---|---|---|
| Web frontend | `improve:perf-measure --frontend` | `lighthouse_performance`, LCP, TBT, CLS |
| CLI benchmarking | `improve:perf-measure --cli` | `hyperfine_mean_ms`, stddev, min, max |
| Token cost | `improve:perf-measure --tokens` | `rtk_tokens_saved`, `headroom_compression_ratio` |
| Accessibility | `improve:accessibility-scan` | `lighthouse`, `axe_critical`, `pa11y_errors` |
| PHP/Drupal page | `drupal-lab:perf-measure --xhprof` | `wall_time_ms`, `memory_peak_mb` |
| DB query | `drupal-lab:perf-measure --db` | `db_queries`, `db_time_ms` |

All harnesses output a `scores` object. Save baseline to `/tmp/*-baseline.json`; compare `scores` after change.
