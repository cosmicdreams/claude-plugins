---
name: experiment
description: >
  Use when the user says "hill climb", "climb this", or "run an experiment": a metric-driven
  keep-or-revert loop. Not for scoring a single claim (research-lab:interrogate).
triggers:
  - "hill climb"
  - "climb this"
  - "run an experiment"
  - "research-lab:experiment"
allowed-tools: Bash, Read, Write, Edit, Workflow, mcp__t3-code__delegate_task
---

# Experiment: Iterative Optimization Loop

Pick a metric, measure it, try something, measure again, keep if better, revert if worse,
repeat. The skill owns **loop mechanics**: ratchet, futility stopping, git discipline, JSON Lines
logging. Domain knowledge lives in the methodology document.

Read before starting:
- `${CLAUDE_PLUGIN_ROOT}/skills/experiment/references/iteration-protocol.md` — JSONL schema, git protocol, ratchet rules
- `${CLAUDE_PLUGIN_ROOT}/skills/experiment/references/methodology-spec.md` — methodology.md format
- `${CLAUDE_PLUGIN_ROOT}/skills/experiment/references/judged-metrics.md` — judged runs only

`JUDGED` below means `python3 ${CLAUDE_PLUGIN_ROOT}/skills/experiment/scripts/judged.py`.

## Golden Rule: Worktree = Branch

Work in an exclusively owned, linked experiment worktree — never the primary checkout or
`main`/`master`. Apply **Trial Ownership** in the iteration protocol before changing files. Do
not clear unrelated changes automatically to satisfy that preflight.

## Input contract and Preflight

**Requires:** a hypothesis and a metric (the methodology carries both), a results path, and a
working directory (a dedicated worktree). Optional: a measurement harness path.

1. Use a methodology already in play in context.
2. Else take the methodology path, results path and working directory from the args.
3. Else **FAIL FAST**: "Need a measurable hypothesis and a target metric — point me at a
   methodology file." Stop.

## Step 0 — Resume

**Scripted:** apply the **Measurement Validity** resume guard: read the engagement notes and
inspect the worktree and commit for unresolved failed measurements. A results log alone does not
prove the current code was measured. Recover a pending trial's recorded ownership values; never
guess its commit from HEAD. If `results.jsonl` exists, report the ratchet (best `metric_after`
of `keep` records) and iteration count, but reconcile pending state before continuing.

**Judged:** the whole loop is: run `JUDGED next`, perform its one action as
`judged-metrics.md` specifies, repeat. The first call is the resume. On `pause`, report the gate
or rule and reason, and wait for Chris's `resolve`. On `stop`, go to Step 3.

## Step 1 — Read Methodology

Extract: `metric_type` (`scripted` when absent), objective, target metric (exactly ONE number),
direction, ranked hypotheses, iteration budget, futility threshold, measurement protocol,
correctness checks, scope constraints.

- Scripted: two metrics, mixed qualitative and quantitative criteria, or no clear direction →
  STOP and ask for the methodology to be fixed.
- Judged: confirm `mcp__t3-code__delegate_task` is available (else refuse: judged runs need
  T3), then run `JUDGED validate --host t3`. Any error → STOP and report; warnings (unmonitored
  drift) go to Chris. No Step 1.5: calibration is the baseline, and Step 2 runs only as `next`
  directs (2a–2c on `propose`; 2d–2g are its capture, open, score, checks and log actions).

## Step 1.5 — Baseline Survey (scripted, mandatory)

Measure across the FULL sample the methodology defines. Apply **Measurement Validity**: a failed
or incomplete baseline does not initialize the ratchet or start candidates; follow the
methodology's recovery policy or pause. Log only a valid baseline, as iteration 0:

```json
{"iteration": 0, "timestamp": "...", "change": "Baseline survey", "gate": "pass",
 "metric_before": null, "metric_after": MEASURED, "ratchet": MEASURED, "decision": "keep",
 "reason": "Baseline established across N pages."}
```

## Step 2 — The Loop

Until budget exhausted, target achieved, or futility triggered.

**Parallel trials (scripted only):** independent changes may fan out with Workflow `parallel()`
in pre-created sibling worktrees; the ratchet stays sequential. Refused for judged runs, which
are strictly sequential.

### 2a. Propose
From the ranked hypotheses and results so far. Judged: also read `propose`'s `diagnostics`
(incumbent critiques, critiques already tried, review notes); a change drawn from one names its
source eval in `change`, at most `max_batch` critiques per trial.

### 2b. Cheap Gate
Redundant with a previous discard, or contradicts a proven keep → skip, log reason. Judged:
log the skip with the iteration `propose` returned; no `trial begin`.

### 2c. Implement
Stage only this change's files. Commit `perf(<engagement>): <description>`. Follow **Trial
Ownership**: record root, branch and base before the change; record the trial commit and verify
its single parent is that base before measuring. Judged: `JUDGED trial begin --worktree W
--change TEXT` before editing, `JUDGED trial commit --worktree W` after.

### 2d. Measure
Confirm the clean tip is still the recorded trial on the recorded branch and worktree, else
pause. Run the harness; median of N runs for noisy metrics. Apply **Measurement Validity**: a
failed command or invalid sample supplies no metric. Keep baseline and ratchet, report, follow
the recovery policy or pause. Never manufacture a keep/discard record.

### 2e. Validate
Run correctness checks. Improved metric with failed correctness = **Stale Success** → discard.

### 2f. Decide
- Strictly better than ratchet AND correctness passes → **KEEP** (update ratchet)
- Equal, worse, or correctness fails → **DISCARD**

Recheck trial ownership first. Discard only through `discard-trial.py` with the recorded root,
branch, base and trial ID (**Revert on Discard**); never HEAD as a substitute. Helper refusal or
Git failure → trial unresolved: report and pause; do not log a discard.

### 2g. Log
```bash
${CLAUDE_PLUGIN_ROOT}/scripts/log-iteration.sh "$RESULTS_PATH" \
  ITERATION "DESCRIPTION" "pass" RATCHET_BEFORE MEASURED NEW_RATCHET "keep_or_discard" "WHY"
```
Judged runs log only the `args` that `next` returns.

## Step 3 — Termination

Stop on target, budget, or futility (consecutive discards). Judged: on `stop target`, Chris
reviews the artifacts; a rejection is `JUDGED resolve --decision reject` and the climb continues.

Report: iterations (keeps vs discards), final ratchet vs baseline, pattern of failures; for
scripted runs the improvement percentage, for judged runs the latest calibrated or confirmed
*M*, judge requests spent, and whether drift was monitored.

## Standalone Mode

Ask for: methodology file, working directory, measurement command. Run the loop. Offer a chart
(`scripts/generate-chart.py`), a summary, or a vault archive.
