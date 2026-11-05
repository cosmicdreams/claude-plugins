# Methodology Spec

Format of an experiment methodology file (any path; drupal-lab names it `05-methodology.md`).

---

## Required Sections

A `climb` or judged methodology MUST contain all of these sections; a `remediate` or `compare` methodology needs only Objective, Scope Constraints and Working Directory. Fields are `name: value` or `**Name:** value` lines.

Judged methodologies use headings of the form `## <n>. <Title>`; `judged.py` parses them.

### 1. Objective
- Optional `strategy: <remediate|climb|compare|explore>` and `scorer: <scripted|council>` lines (`strategies.md`); an argument overrides them, and absent means the router decides
- `metric_type: scripted` or `metric_type: judged` on its own line (absent = `scripted`; `judged` means `scorer: council`, and a conflicting `scorer:` is an error)
- For `climb`: `Target:`, `Direction:` (higher/lower) and, in Iteration Rules, `Budget:` as `name: value` lines; `experiment.py check` refuses without them
- Scripted `climb` and `remediate` runs are driven by `experiment.py`, which reads these `name: value` lines (anywhere in the file):

| Field | Required | Meaning |
|---|---|---|
| `Measure:` | yes | Command run in the worktree. Prints `METRIC name=value` lines, or one bare number as its last line (remediate: the open findings count). |
| `Checks:` | yes | Command; exit 0 means every guardrail passes. |
| `Budget:` | yes | Maximum trials. |
| `Target:` / `Direction:` | climb; `Direction:` also compare | Numeric target; `higher` or `lower`. Remediate: target defaults to 0, direction is lower. |
| `Runs:` | no | Measurements per evaluation (default 3); the median is used. |
| `Margin:` | no | Minimum gain to keep; default twice the median absolute deviation of the baseline runs (compare: of all variants' runs, pooled). |
| `Futility:` | no | Consecutive discards before escalating (default 5). |
| `Metric name:` | no | Which `METRIC` line is primary when several are printed. |
| `Bound:` | no | A measured floor or ceiling; a target beyond it is refused. |
| `Tiebreak:` + `Readability:` | no | Simplicity measure (lower is simpler) and a readability check; together they let a within-margin, simpler candidate keep. |
| `Held-out:` | no | A check never used for decisions, run once in the report. |
| `Variants:` | compare | `given`, `generated` or `grid`; with `Variant <name>:` lines, `Count:` and `Idea:`, or `Grid <param>:` lines and an `Apply:` command (its `{param}` placeholders are replaced shell-quoted; do not quote them). `Include incumbent: yes` measures the unchanged base too. `Budget:` counts measurements (variants × runs plus a confirmation). |
| `Score:` / `Score target:` | remediate, no | The tool's overall score as a guardrail; a target below which the report offers a follow-up climb. |
- What metric is being optimized
- Target value (numeric, measurable); for judged, the Judging Protocol's `target`
- Direction: is lower better or higher better? Judged is always `direction: higher`

### 2. Baseline
- Current measured value of the metric
- How the measurement was taken
- Path to the measurement harness/script

### 3. Hypotheses
- Ranked list (highest expected impact first)
- Each hypothesis includes: what to change, why it should help, expected magnitude

### 4. Iteration Rules
- Budget: maximum number of iterations
- Futility threshold: consecutive discards before stopping (default 5)
- Noise handling: how many runs per measurement, aggregation method (default median of 3)
- Ratchet seed: initial ratchet value (usually = baseline)

### 5. Measurement Protocol
- Exact steps to measure the metric
- The experimentalist follows these literally — no improvisation
- Include any warm-up steps, wait times, or cache-clearing needed

### 6. Correctness Checks
- Checklist of things that must remain true after each change
- Failed correctness + improved metric = Stale Success = discard

### 7. Scope Constraints
- What the experimentalist is allowed to change
- What is explicitly off-limits
- Any dependencies that must not be broken

### 8. Working Directory
- Path where changes are made
- Git branch/worktree context

### 9. Judging Protocol (judged only)
- Required when section 1 says `metric_type: judged`; forbidden otherwise
- Heading `## 9. Judging Protocol`, holding one fenced `judging-protocol` JSON block
- Fields and rules: `judged-metrics.md`

---

## Optional Sections

### Notes
- Context from earlier phases (preflight, gather, synthesize)
- Known dead ends or things already tried
- Domain-specific guidance

### Named Concepts
- Vocabulary from the synthesize phase
- The experimentalist should use these terms in commit messages and logs

---

## Validation

Before starting the experiment loop, the experimentalist should verify:
1. `experiment.py check` reports `ready` (it covers the 8 required sections, target, direction and budget for `climb`); judged also needs section 9
2. The measurement harness runs successfully and produces a number
3. The working directory is accessible and has a clean git state
4. The correctness checks can be executed
5. Judged: `judged.py validate --host t3` passes (it replaces 2)

If any validation fails, report to the PI before proceeding.
