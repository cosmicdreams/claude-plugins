# Drover UX Harness

Measurable UX metrics for drover, runnable without user-in-the-loop.

Each scenario produces one or more numbers. `run-baseline.sh` runs all scenarios
and writes a single JSON blob to `results/baseline-<timestamp>.json`. Experiments
compare against baseline to decide keep-or-discard (ratchet pattern).

## Metrics

| Key | What | Target | Why |
|---|---|---|---|
| `idle_stdout_lines` | Non-error lines emitted by umbrella in 10s with one dormant DDEV project | `0` | Any stdout from a Monitor becomes a user-facing task-notification |
| `umbrella_child_respawns` | "starting" log entries in 10s for a dormant child | `1` | Children should stay alive, not thrash |
| `fingerprint_determinism` | Unique fingerprints produced from 20 trivially-varied copies of one error | `1` | Same bug = same fingerprint |
| `fingerprint_dedup_rate` | Fraction of 50-line fixture that produces new fingerprints | low | Errors collapse into classes |
| `new_emits_per_fixture` | `NEW` lines from ddev-watch on a 50-line, 3-error fixture | `3` | One NEW per distinct error, not one per line |
| `time_to_first_emit_ms` | Wall time from feeding first error to `NEW` appearing | low | Triage latency |
| `setup_interview_questions` | Questions `/drover:setup` asks (static count) | low | Onboarding friction |
| `skill_count_user_facing` | Skills a new user must understand to reach value | low | Cognitive load |

## Run

```sh
./run-baseline.sh                    # writes results/baseline-<ts>.json
./run-baseline.sh --compare LAST     # diffs against most recent result
```

## Adding a scenario

Each scenario is a script in `scenarios/` that prints one JSON object to stdout:

```json
{"metric": "idle_stdout_lines", "value": 0, "notes": "..."}
```

`run-baseline.sh` collects them, merges into one blob, writes to `results/`.

## Limitations

- No live DDEV / Acquia calls — uses fixture replay or shims in `shims/`.
- Cannot measure subjective UX (docs clarity, notification tone). Those require
  human review.
- Setup/skill counts are measured by static inspection, not runtime.
