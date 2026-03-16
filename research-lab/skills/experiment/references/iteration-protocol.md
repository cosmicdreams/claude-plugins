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

### Revert on Discard
```bash
git revert HEAD --no-edit
```

This creates a clean revert commit. Never amend, never force-push, never manually undo.

### Revert Commit Message
Git generates: `Revert "perf(<engagement>): <description>"`

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
