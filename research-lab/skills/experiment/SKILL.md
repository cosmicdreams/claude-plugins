---
name: experiment
description: >
  Iterative optimization loop: propose changes, cheap gate, implement via git commit,
  measure, validate correctness, keep/discard with ratchet pattern. Includes futility
  stopping and JSONL logging. Use standalone for any measurable optimization task.
  Say "run an experiment", "iterate on this", "optimize with methodology", or
  "autoresearch loop".
triggers:
  - "run an experiment"
  - "iterate on this"
  - "optimize with methodology"
  - "autoresearch loop"
  - "research-lab:experiment"
allowed-tools: Bash, Read, Write, Edit
---

# Experiment: Iterative Optimization Loop

Execute a methodology-driven iteration loop with ratchet-based keep/discard decisions.

Read these references before starting:
- `${CLAUDE_PLUGIN_ROOT}/skills/experiment/references/iteration-protocol.md` — JSONL schema, git protocol, ratchet rules
- `${CLAUDE_PLUGIN_ROOT}/skills/experiment/references/methodology-spec.md` — methodology.md format

---

## Golden Rule: Worktree = Branch

**You MUST be working in a dedicated worktree — never in `worktrees/main/`.**
Verify before starting: your working directory must NOT be named `main` or have the main branch checked out.
If no worktree exists, STOP and ask the PI to create one via `/create-worktree`.

---

## Input

Required:
- **Methodology path** — path to `05-methodology.md` (or any methodology file)
- **Results path** — where to write `results.jsonl`
- **Working directory** — a dedicated worktree (never main). Must be on its own branch.

Optional:
- **Measurement harness** — path to a measurement script (may be defined in methodology)

---

## Step 0 — Resume Detection

Check for existing results:

```bash
RESULTS_PATH="${RESULTS_PATH:-results.jsonl}"
if [ -f "$RESULTS_PATH" ]; then
  # Find the current ratchet (best metric from keeps)
  python3 -c "
import json
keeps = []
with open('$RESULTS_PATH') as f:
    for line in f:
        r = json.loads(line)
        if r.get('decision') == 'keep':
            keeps.append(r)
if keeps:
    best = max(keeps, key=lambda x: x.get('metric_after', 0))
    print(f\"Resuming. Ratchet: {best['metric_after']} (iteration {best['iteration']})\")
    print(f\"Total iterations: {sum(1 for _ in open('$RESULTS_PATH'))}\")
else:
    print('No keeps yet. Starting fresh.')
"
fi
```

---

## Step 1 — Read Methodology

```bash
cat "$METHODOLOGY_PATH"
```

Extract:
- **Objective** and target metric
- **Hypotheses** (ranked — work top-down)
- **Iteration budget** and futility threshold
- **Measurement protocol**
- **Correctness checks**
- **Scope constraints**

---

## Step 2 — The Loop

For each iteration until budget exhausted, target achieved, or futility triggered:

### 2a. Propose

Based on the methodology's ranked hypotheses and results so far, propose the next change.
- If early iterations: work through hypotheses in order
- If later iterations: adapt based on what worked and what didn't
- If a hypothesis category is exhausted: move to the next

### 2b. Cheap Gate

Before implementing, ask: "Can this plausibly improve the metric?"
- If the change is obviously redundant with a previous discard → skip, log reason
- If the change contradicts a proven keep → skip, log reason
- Otherwise → proceed

### 2c. Implement

Make the change in the working directory. Then commit:

```bash
cd "$WORKING_DIR"
git add -A
git commit -m "$(cat <<'EOF'
experiment(<engagement>): <description of change>
EOF
)"
```

### 2d. Measure

Run the measurement harness:

```bash
# Use the methodology-defined harness or the template
$MEASURE_COMMAND
```

For noisy metrics, run N times (N from methodology) and take the median:

```bash
for i in $(seq 1 $N); do
  $MEASURE_COMMAND >> /tmp/measurements.txt
done
# Compute median
```

### 2e. Validate (Defend)

Run correctness checks from the methodology:
- Each check must pass
- A metric improvement with failed correctness = **Stale Success** → discard

### 2f. Decide

Compare measured metric against the ratchet:
- **Better than ratchet** AND correctness passes → **KEEP** (update ratchet)
- **Worse than or equal to ratchet** → **DISCARD**
- **Better but correctness fails** → **DISCARD** (Stale Success)

On discard:
```bash
cd "$WORKING_DIR"
git revert HEAD --no-edit
```

### 2g. Log

Append to results.jsonl:

```bash
python3 -c "
import json, datetime
record = {
    'iteration': ITERATION_NUMBER,
    'timestamp': datetime.datetime.now().isoformat(),
    'change': 'DESCRIPTION',
    'gate': 'pass',
    'metric_before': RATCHET_VALUE,
    'metric_after': MEASURED_VALUE,
    'ratchet': NEW_RATCHET_VALUE,
    'decision': 'keep_or_discard',
    'reason': 'WHY'
}
with open('$RESULTS_PATH', 'a') as f:
    f.write(json.dumps(record) + '\n')
"
```

---

## Step 3 — Termination

Stop when any of:
- **Target achieved** — metric meets the objective
- **Budget exhausted** — iteration count reached the limit
- **Futility** — consecutive discards reached the threshold

On termination, report:
- Total iterations (keeps vs discards)
- Final ratchet value vs baseline
- Improvement percentage
- Pattern of failures (what didn't work and why)

---

## Standalone Mode

When used outside of research-lab:run:
1. Ask the user for the methodology file, working directory, and measurement command
2. Run the loop
3. Present results and offer:
   - "Generate a chart from results.jsonl?"
   - "Write a summary report?"
   - "Archive to vault?"
