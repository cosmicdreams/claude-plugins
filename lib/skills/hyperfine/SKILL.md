---
name: hyperfine
description: >
  Benchmark a shell command with hyperfine and return JSON timings; compare two commands
  or establish a baseline. Not for web page performance (lib:lighthouse) or PHP profiling
  (drupal-lab:perf-measure).
---

# lib:hyperfine

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Benchmark a shell command using hyperfine and output structured JSON timing results. Use when you need to measure how long a CLI command takes, compare two commands, or establish a performance baseline for a script or binary. Trigger phrases: "benchmark this command", "how fast is", "time this command", "compare command speed", "CLI benchmark", "hyperfine". Do NOT use for web page performance (use lib:lighthouse or improve:perf-measure --frontend for that). Do NOT use for PHP profiling inside DDEV (use drupal-lab:perf-measure --xhprof for that).

Thin wrapper around the `hyperfine` CLI. Outputs JSON timing results suitable for the experiment ratchet.

## Pre-flight checks

**`hyperfine` not installed:**
```bash
hyperfine --version 2>/dev/null || echo "NOT INSTALLED"
```
Install (macOS): `brew install hyperfine`
Install (Linux): `cargo install hyperfine` or `apt install hyperfine` (if available)

## Run — basic benchmark

```bash
hyperfine --export-json /tmp/hyperfine-result.json "<command>"
```

Extract scores with jq:
```bash
jq '{
  hyperfine_mean_ms: (.results[0].mean * 1000 | round),
  hyperfine_stddev_ms: (.results[0].stddev * 1000 | round),
  hyperfine_min_ms: (.results[0].min * 1000 | round),
  hyperfine_max_ms: (.results[0].max * 1000 | round),
  hyperfine_runs: .results[0].times | length,
  target: .results[0].command,
  ts: now | todate
}' /tmp/hyperfine-result.json
```

## Run — with warmup (recommended for cached operations)

Use `--warmup` when the command benefits from filesystem/CPU cache being warm (e.g., script interpreters, compiled binaries with cold-start JIT):

```bash
hyperfine --warmup 3 --export-json /tmp/hyperfine-result.json "<command>"
```

## Run — force minimum run count

hyperfine defaults to at least 10 runs for statistical stability. For slow commands (>10s each), reduce:

```bash
hyperfine --min-runs 5 --export-json /tmp/hyperfine-result.json "<command>"
```

For fast commands where default 10 is insufficient to detect small improvements, increase:
```bash
hyperfine --min-runs 50 --export-json /tmp/hyperfine-result.json "<command>"
```

## Run — compare two commands

```bash
hyperfine --export-json /tmp/hyperfine-result.json "<command-a>" "<command-b>"
```

Each command gets its own entry in `results[]`. Extract comparison:
```bash
jq '.results | map({command, mean_ms: (.mean * 1000 | round), stddev_ms: (.stddev * 1000 | round)})' \
  /tmp/hyperfine-result.json
```

## Output contract

```json
{
  "hyperfine_mean_ms": 340,
  "hyperfine_stddev_ms": 12,
  "hyperfine_min_ms": 312,
  "hyperfine_max_ms": 398,
  "hyperfine_runs": 10,
  "target": "my-command --arg",
  "ts": "2026-03-21T12:00:00Z"
}
```

| Key | Direction | Notes |
|---|---|---|
| `hyperfine_mean_ms` | lower is better | Primary ratchet key |
| `hyperfine_stddev_ms` | lower is better | High stddev means noisy environment |
| `hyperfine_min_ms` | lower is better | Best-case time |
| `hyperfine_max_ms` | — | Useful for detecting outliers |
| `hyperfine_runs` | — | Number of timed runs (excludes warmup) |

**Ratchet rule:** `keep if hyperfine_mean_ms < previous.hyperfine_mean_ms`

Treat improvements smaller than 1 stddev as noise — require `mean_after < mean_before - stddev_before` for a confident improvement signal.

## Error table

| Symptom | Cause | Fix |
|---|---|---|
| `command not found: <cmd>` | Command being benchmarked not on PATH | Use full path or ensure it's installed |
| Results vary wildly (stddev > 20% of mean) | System load / background processes | Close other apps; use `--warmup`; consider `--min-runs 20` |
| `hyperfine: No such file or directory` | hyperfine itself not installed | `brew install hyperfine` |
| Single-run times look reasonable but mean is high | Cold-start overhead | Add `--warmup 3` to eliminate first-run penalty |
| `/tmp/hyperfine-result.json` is empty | Command exited non-zero before first run | Run command manually to confirm it succeeds before benchmarking |
