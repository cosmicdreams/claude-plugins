---
name: experiment
description: >
  Iterative optimization loop: propose, cheap-gate, implement via git commit, measure,
  validate, keep or discard on a ratchet — with futility stopping and JSON Lines logging.
  Needs a measurable hypothesis and a target metric.
triggers:
  - "run an experiment"
  - "iterate on this"
  - "optimize with methodology"
  - "autoresearch loop"
  - "research-lab:experiment"
allowed-tools: Bash, Read, Write, Edit, Workflow
---

# Experiment: Iterative Optimization Loop

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Iterative optimization loop: propose changes, cheap gate, implement via git commit, measure, validate correctness, keep/discard with ratchet pattern. Includes futility stopping and JSON Lines logging. Use standalone for any measurable optimization task. Say "run an experiment", "iterate on this", "optimize with methodology", or "autoresearch loop". Needs a measurable hypothesis and a target metric.

Execute a methodology-driven iteration loop with ratchet-based keep/discard decisions.

## Design Principle

This skill implements the autoresearch pattern: pick a metric, measure it, try something, measure
again, keep if better, revert if worse, repeat. The skill owns **loop mechanics** — ratchet,
futility stopping, git discipline, JSON Lines logging. Domain knowledge lives in the methodology
document.

Read before starting:
- `${CLAUDE_PLUGIN_ROOT}/skills/experiment/references/iteration-protocol.md` — JSONL schema, git protocol, ratchet rules
- `${CLAUDE_PLUGIN_ROOT}/skills/experiment/references/methodology-spec.md` — methodology.md format

---

## Golden Rule: Worktree = Branch

Work in an exclusively owned, linked experiment worktree — never the primary
checkout or `main`/`master`. Apply **Trial Ownership** in
`references/iteration-protocol.md` before changing files. Do not clear unrelated
changes automatically to satisfy that preflight.

---

## Input contract

- **Requires:** a hypothesis + a metric (the methodology document carries both).
- **Resolves from:** context → arg (methodology file path).

## Preflight

1. Check context for a methodology already in play. If present, use it.
2. Else check for an arg: a methodology file path, results path, and working directory.
3. Else **FAIL FAST**: "Need a measurable hypothesis and a target metric — point me at a methodology file." Stop.

**Required inputs:** methodology path, results path, working directory (a dedicated worktree).
**Optional:** measurement harness path (may be defined in methodology).

### Parallel candidate trials

When several candidate changes are independent, map them to a Workflow `parallel()` — pre-create
sibling worktrees per the project convention before fanning out so mutating trials don't collide.
The ratchet itself stays sequential: keep/discard against one moving best-metric. Re-run the measurement harness yourself on a trial's commit before keeping it. A metric a subagent reports is a claim until you reproduce it.

---

## Step 0 — Resume Detection

Before proposing a new change, apply the **Measurement Validity** resume guard in
`references/iteration-protocol.md`: read the engagement notes and inspect the
current worktree/commit for unresolved failed measurements. A results log alone
does not establish that the current code has been measured.
Recover any pending trial's recorded ownership values as well; do not guess its
commit from the current HEAD.

If `results.jsonl` exists, find the current ratchet by scanning for `decision: keep` records and
taking the best `metric_after`. Report the ratchet value and iteration count,
but do not continue until any pending measurement state has been reconciled.

---

## Step 1 — Read Methodology

Extract: objective, target metric (exactly ONE number), direction (higher or lower is better),
ranked hypotheses, iteration budget, futility threshold, measurement protocol, correctness checks,
scope constraints.

If the methodology has two metrics, mixed qualitative/quantitative criteria, or no clear direction
— STOP and ask for the methodology to be fixed before proceeding.

---

## Step 1.5 — Baseline Survey (mandatory)

Measure the metric across the FULL page sample defined in the methodology before the first
iteration. Apply **Measurement Validity** in `references/iteration-protocol.md`:
if the baseline fails or is incomplete, do not initialize the ratchet or begin
candidate changes. Follow the methodology's recovery policy or pause for guidance.
Only a valid baseline is logged as iteration 0:

```json
{"iteration": 0, "timestamp": "...", "change": "Baseline survey", "gate": "pass",
 "metric_before": null, "metric_after": MEASURED, "ratchet": MEASURED, "decision": "keep",
 "reason": "Baseline established across N pages."}
```

The ratchet seed = this measured baseline.

---

## Step 2 — The Loop

For each iteration until budget exhausted, target achieved, or futility triggered:

### 2a. Propose
Based on ranked hypotheses and results so far, propose the next change.

### 2b. Cheap Gate
Can this change plausibly improve the metric?
- Obviously redundant with a previous discard → skip, log reason.
- Contradicts a proven keep → skip, log reason.

### 2c. Implement

Stage only files related to the current iteration's change. Commit: `perf(<engagement>): <description>`.
Follow **Trial Ownership** in the iteration protocol: record root, branch and
base before the change, then record the successful trial commit and verify its
single parent matches that base before measuring.

### 2d. Measure

Confirm the clean tip is still the recorded trial on the recorded branch and
worktree; otherwise pause instead of attributing measurements to changed code.
Then run the methodology-defined harness. Take the median of N runs for noisy metrics.

Apply **Measurement Validity** in `references/iteration-protocol.md` before
validation or comparison. A failed command or invalid/incomplete sample supplies
no metric: preserve the baseline and ratchet, report the failure, and follow the
engagement's recovery policy or pause. Do not manufacture a numeric keep/discard
record or advance to the decision step while the measurement is unresolved.

### 2e. Validate

Run correctness checks. A metric improvement with failed correctness = **Stale Success** → discard.

### 2f. Decide

- Better than ratchet AND correctness passes → **KEEP** (update ratchet)
- Worse than or equal to ratchet → **DISCARD**
- Better but correctness fails → **DISCARD**

Before applying either decision, recheck trial ownership. On discard, invoke
`discard-trial.py` with the recorded root, branch, base and trial ID as specified
in **Revert on Discard** in the iteration protocol. Do not use the current HEAD
as a substitute. If the helper refuses or Git fails, leave the trial unresolved,
report the state, and pause rather than logging a completed discard.

### 2g. Log

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/log-iteration.sh "$RESULTS_PATH" \
  ITERATION "DESCRIPTION" "pass" RATCHET_BEFORE MEASURED NEW_RATCHET "keep_or_discard" "WHY"
```

---

## Step 3 — Termination

Stop when: target achieved, budget exhausted, or futility threshold reached (consecutive discards).

Report: total iterations (keeps vs discards), final ratchet vs baseline, improvement percentage,
pattern of failures.

---

## Standalone Mode

Resolve the methodology file, working directory (default: current worktree), and measurement command (from the methodology) from arguments and context; ask only for what is still missing. Run the loop. Generate
the chart and summary by default; offer vault archiving at the end.
