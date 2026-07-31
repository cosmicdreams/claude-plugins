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

Work in a dedicated worktree — never in `worktrees/main/`. Verify before starting.

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
The ratchet itself stays sequential: keep/discard against one moving best-metric.

---

## Step 0 — Resume Detection

If `results.jsonl` exists, find the current ratchet by scanning for `decision: keep` records and
taking the best `metric_after`. Report the ratchet value and iteration count before continuing.

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
iteration. Log as iteration 0:

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

### 2d. Measure

Run the methodology-defined harness. Take the median of N runs for noisy metrics.

### 2e. Validate

Run correctness checks. A metric improvement with failed correctness = **Stale Success** → discard.

### 2f. Decide

- Better than ratchet AND correctness passes → **KEEP** (update ratchet)
- Worse than or equal to ratchet → **DISCARD**
- Better but correctness fails → **DISCARD**

On discard: `git revert HEAD --no-edit`

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

Ask for: methodology file, working directory, measurement command. Run the loop. Offer to generate
a chart, write a summary, or archive to vault.
