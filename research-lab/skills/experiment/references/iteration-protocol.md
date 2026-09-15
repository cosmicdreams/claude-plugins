# Iteration Protocol

Canonical specification for the experiment iteration loop. The experimentalist reads this before starting.

---

## JSONL Schema

Each line in `results.jsonl` is a JSON object:

```json
{
  "iteration": 1,
  "timestamp": "2026-03-15T14:30:00",
  "change": "Enable BigPipe module for authenticated users",
  "gate": "pass",
  "metric_before": 2.3,
  "metric_after": 1.8,
  "ratchet": 1.8,
  "decision": "keep",
  "reason": "22% improvement, all correctness checks pass"
}
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `iteration` | int | Sequential iteration number (1-based) |
| `timestamp` | ISO 8601 | When the iteration completed |
| `change` | string | Human-readable description of what was changed |
| `gate` | "pass" \| "skip" | Whether the cheap gate passed or the iteration was skipped |
| `metric_before` | float | Ratchet value before this iteration |
| `metric_after` | float \| null | Measured value (null if skipped) |
| `ratchet` | float | Ratchet value after this iteration (updated on keep, unchanged on discard) |
| `decision` | "keep" \| "discard" \| "skip" | The iteration outcome |
| `reason` | string | Why this decision was made |

### Skip Records

When the cheap gate rejects an iteration:
```json
{
  "iteration": 5,
  "timestamp": "2026-03-15T15:00:00",
  "change": "Disable page cache entirely",
  "gate": "skip",
  "metric_before": 1.8,
  "metric_after": null,
  "ratchet": 1.8,
  "decision": "skip",
  "reason": "Contradicts proven keep from iteration 3 (page cache is beneficial)"
}
```

---

## Git Protocol

### Commit Format
```
perf(<engagement>): <description>
```

Examples:
- `perf(pncb-cache): enable BigPipe for authenticated users`
- `perf(pncb-cache): set Views cache to tag-based invalidation`

### Commit Timing
- Commit BEFORE measuring — the git log is the experiment's lab notebook
- Each iteration gets exactly one commit (the change) or one commit + one revert (on discard)

### Trial Ownership

Use an exclusively owned, linked Git worktree on an experiment branch, not the
primary checkout, a detached HEAD, or `main`/`master`. Before each candidate,
inspect `git worktree list --porcelain`, `git status --porcelain --untracked-files=all`,
and the current branch. Require a clean index/tree and no nonignored untracked
files; stop if another operation or actor is using the worktree.

Record these values **before changing files** in the engagement notes for the
iteration:

- `TRIAL_WORKTREE`: canonical absolute worktree root.
- `TRIAL_BRANCH`: attached experiment branch name.
- `TRIAL_BASE`: full commit ID of the measured state this candidate starts from.

After a successful commit containing only this candidate, immediately record
`TRIAL_COMMIT`, its full commit ID. Verify it has exactly one parent and that
parent is `TRIAL_BASE`. If the commit failed or the parent/branch changed, stop;
do not measure or infer which commit belongs to this trial.

Keep ownership notes, measurement artifacts, and `results.jsonl` outside the
candidate worktree or in an intentionally ignored location so recording a result
does not dirty the next trial. Agree that storage policy before starting; do not
move existing records or change ignore rules automatically. Do not change the
results JSONL schema or mix those records into the candidate commit. On resume,
recover these recorded values rather than reconstructing ownership from the
current tip. **Never assign the current HEAD as the trial ID at discard time.**

Before measuring, keeping, or discarding, confirm the worktree and branch still
match and the clean tip is still `TRIAL_COMMIT`. Drift invalidates attribution:
pause for reconciliation instead of stacking another candidate or applying a
decision to different code. A later unrelated commit is not permission to
automatically revert an older trial underneath it.

### Staging Discipline
**Only stage files related to the current iteration's change.** Use `git add <specific-files>` rather than `git add -A` or `git add .`. If earlier phases modified files (e.g., module uninstalls during diagnostic investigation), those changes must NOT be included in iteration commits.

If investigation or unrelated changes are already present, stop and agree how to
preserve them separately or use a clean experiment worktree. Do not automatically
stash, reset, clean, or discard them just to satisfy the clean-state requirement.

### Revert on Discard

Use the recorded ownership values with the guarded helper:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/experiment/scripts/discard-trial.py" \
  --worktree "$TRIAL_WORKTREE" --branch "$TRIAL_BRANCH" \
  --base "$TRIAL_BASE" --trial "$TRIAL_COMMIT"
```

The helper checks worktree, branch, single-parent base, exact tip, clean state,
in-progress Git operations, and local-file collisions before invoking native Git
revert on the **recorded full trial ID**. It creates a revert commit; it does not
amend, reset, rebase, force-push, stash, or remove user files to make the operation
succeed. Existing Git hooks/signing remain in effect.

Only a successful helper result permits logging a completed `discard`. Refusal,
Git failure/conflict, or an uncertain postcondition leaves the trial unresolved:
report the state and pause for guidance. Do not log a successful discard or
automatically abort/reset/retry. On resume, inspect both the ownership notes and
current Git state before any recovery action.

These checks are not a transaction against arbitrary concurrent Git operations.
Exclusive ownership is still required; a worktree is not a concurrency lock.
The helper validates a supplied record, not the identity of whoever created a
commit. It cannot make guessed or fabricated ownership metadata trustworthy.

### Revert Commit Message
Git generates: `Revert "perf(<engagement>): <description>"`

---

## Measurement Validity

Check the harness exit status before consuming its output. A measurement is usable
only when the command succeeds, returns exactly one finite numeric metric, and
covers the full sample required by the methodology. An error, missing/invalid
metric, or incomplete sample is **not a measurement**. Never substitute zero,
the previous ratchet, or an average of surviving pages.

- **Failed baseline:** do not write an iteration-0 `keep`, initialize the ratchet,
  or start candidate changes without a valid baseline.
- **Failed post-change measurement:** leave the established baseline and ratchet
  unchanged. Do not compare absent data or infer `keep`/`discard` from it. Record
  the command failure, sample gaps, and current iteration/commit in the engagement
  notes and report them to the Principal Investigator.
- **Recovery:** follow the methodology's explicit retry or discard/recovery policy.
  If it does not define one, pause and request guidance before continuing or
  taking a rollback action. Do not invent retry limits or count an unresolved
  measurement failure as a cheap-gate skip or a futility discard.
- **Logging:** the existing numeric keep/discard records describe measured
  outcomes; the skip record describes a cheap-gate rejection. Do not fabricate
  either record for an unresolved measurement failure.
- **Resume:** before another proposal, read the engagement notes and inspect
  `git status --short` and `git rev-parse HEAD`. Reconcile any recorded failed
  baseline or pending post-change measurement with the current worktree/commit.
  Recover the trial's recorded root, branch, base and commit as specified in
  **Trial Ownership**; never substitute the current tip for a missing trial ID.
  A ratchet recovered from `results.jsonl` does not prove that an unmeasured
  candidate is absent from the code. Resolve the pending trial under the same
  methodology recovery policy before starting another; if the record and current
  state cannot be reconciled, pause for guidance rather than stack a new change.
- **Repeated measurements:** compute the across-run median only after all N
  required runs are valid under that recovery policy. Do not quietly drop a
  failed run to obtain a better median.

The bundled harness produces one across-page mean per complete run. The noise
protocol below still takes the median across N such runs; these are distinct
aggregation layers.

---

## Ratchet Rules

1. **Initialize** — ratchet = baseline value from methodology
2. **On keep** — ratchet = measured value (must be strictly better than current ratchet)
3. **On discard** — ratchet unchanged
4. **On skip** — ratchet unchanged
5. **Direction** — the methodology defines whether "better" means higher or lower
   - For latency/load time: lower is better
   - For cache hit rate: higher is better
6. **Ties** — metric equal to ratchet = discard (must be strictly better)

---

## Futility Stopping

Track consecutive discards (including skips).

- **Threshold** — defined in methodology (default: 5)
- **Trigger** — when consecutive discards >= threshold
- **Action** — stop the loop, report to the PI:
  - "Futility threshold reached after N consecutive discards"
  - Pattern analysis: what categories of changes were tried and failed
  - Recommendation: revise methodology, add sources, or accept current state

### Futility Reset
A keep resets the consecutive discard counter to 0.

---

## Noise Handling

When measurements have variance:

1. **N runs** — take N measurements per iteration (N from methodology, default 3)
2. **Median** — use the median value, not the mean (more robust to outliers)
3. **Log all** — record all N values in the reason field for transparency
4. **Significance** — if the improvement is smaller than the observed variance, treat as discard

Example reason field with noise handling:
```
"reason": "Median of 3 runs: 1.8s (1.7, 1.8, 1.9). Previous ratchet: 2.1s. 14% improvement."
```
