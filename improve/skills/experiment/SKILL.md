---
name: experiment
description: >
  Run an uncertain process improvement using the ratchet pattern: measure baseline, make a
  change, measure again, keep if better, revert if worse. For process improvements where
  the outcome is uncertain and you need evidence before committing. Do NOT use for known
  fixes — use improve:fix for those.
triggers:
  - "experiment with this process"
  - "try improving"
  - "test this change"
  - "improve:experiment"
---

# Experiment: Ratchet-Based Process Improvement

When you think a change might improve a process but you're not sure, run an experiment. Measure before, change, measure after, decide.

## When to Use This

- You have a hypothesis ("this agent would be faster on haiku")
- The outcome is uncertain ("will the quality hold?")
- The change is reversible ("we can switch back to sonnet")
- There's something observable to measure ("task completion time, error rate, output quality")

If you're certain the change is an improvement → use `improve:fix` instead.
If you're just watching for patterns → use `improve:lint` instead.

## The Ratchet Pattern

```
1. State the hypothesis
2. Define what "better" means (the metric)
3. Measure baseline
4. Make the change
5. Measure again
6. Compare: better, same, or worse?
7. Keep if better. Revert if worse. Note if same.
8. Record the result.
```

## Step 1: Hypothesis

Write it down explicitly before doing anything:
```
Hypothesis: <what you think will improve>
Change: <what you'll change and where>
Expected effect: <what you expect to see>
Risk: <what could go wrong>
Reversibility: <how to undo it>
```

## Step 2: Define "Better"

Process improvements can be measured in multiple ways:

| Metric type | Examples | How to measure |
|---|---|---|
| **Quantitative** | Error count, retry rate, task time, token cost | Logs, JSONL, timestamps |
| **Behavioral** | Agent follows instructions, stops retrying | Transcript analysis |
| **Structural** | Prompt is clearer, fewer steps needed | Before/after diff review |
| **Outcome** | Better results, fewer failures | Human judgment |

Not everything reduces to a number. For subjective metrics, state the evaluation criteria upfront so the comparison is fair.

## Step 3: Measure Baseline

Before changing anything, capture the current state:
- Run the process (or wait for its next natural run)
- Record the metric values
- Save baseline data to your working context

## Step 4: Make the Change

Use `improve:fix` to make the change. Note exactly what was changed and where so you can revert.

## Step 5: Measure Again

Run the process again (or wait for its next natural run) under the same conditions. Record the new metric values.

## Step 6: Compare and Decide

| Result | Action |
|---|---|
| **Clearly better** | Keep the change. Record as a successful improvement. Consider creating a lint rule. |
| **Marginally better** | Keep, but note the margin. May need more data. |
| **No difference** | Revert — unnecessary changes add complexity for no gain. |
| **Worse** | Revert immediately. Record what happened and why the hypothesis was wrong. |
| **Mixed** | Better on some metrics, worse on others. Surface to human for judgment. |

## Step 7: Record the Result

```markdown
## Experiment: <name>
**Date:** <ISO date>
**Hypothesis:** <what you tested>
**Change:** <what was changed, where>
**Baseline:** <metric values before>
**Result:** <metric values after>
**Decision:** kept | reverted | escalated
**Learning:** <what this tells you about the process>
```

Store in the relevant domain's improvement knowledge, or in `improve:lint` as a new rule if the learning is generalizable.

## Experiment Ethics

- Never experiment on a process during critical work without telling the human
- Always have a revert plan before starting
- If an experiment causes a failure, revert first, analyze second
- One variable at a time — don't change the model AND the prompt AND the tools simultaneously

## Available Measurement Harnesses

| Target | Skill | Key scores |
|---|---|---|
| Web frontend performance | `improve:perf-measure --frontend` | `lighthouse_performance`, LCP, TBT, CLS |
| CLI command benchmarking | `improve:perf-measure --cli` | `hyperfine_mean_ms`, stddev, min, max |
| Accessibility | `improve:accessibility-scan` | `lighthouse`, `axe_critical`, `pa11y_errors` |
| PHP/Drupal page performance | `drupal-lab:perf-measure --xhprof` | `wall_time_ms`, `memory_peak_mb` |
| DB query profiling | `drupal-lab:perf-measure --db` | `db_queries`, `db_time_ms`, slow query list |

All harnesses output a `scores` object. Save baseline to `/tmp/*-baseline.json`, run after
change, compare `scores` directly. `callgraph_top_10` (xhprof) is for hypothesis generation,
not ratchet comparison.
