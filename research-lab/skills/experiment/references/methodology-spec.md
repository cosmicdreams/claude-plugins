# Methodology Spec

Format definition for `05-methodology.md` files. The experimentalist reads this to know what to expect.

---

## Required Sections

A valid methodology.md MUST contain all of these:

### 1. Objective
- What metric is being optimized
- Target value (numeric, measurable)
- Direction: is lower better or higher better?

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
1. All 8 required sections are present
2. The measurement harness runs successfully and produces a number
3. The working directory is accessible and has a clean git state
4. The correctness checks can be executed

If any validation fails, report to the PI before proceeding.
