---
name: perf-measure
description: >
  Measure frontend web performance, CLI benchmarks, and token cost into a JSON score tuple
  for the experiment ratchet — Lighthouse scores, Core Web Vitals, hyperfine timings,
  token spend. Pass --a11y to delegate to improve:accessibility-scan. Not for PHP/DDEV
  profiling (drupal-lab:perf-measure).
triggers:
  - "measure performance"
  - "lighthouse score"
  - "benchmark this command"
  - "core web vitals"
  - "improve:perf-measure"
  - "token cost measurement"
  - "token spend"
---

# perf-measure

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Measure web frontend performance, CLI benchmark targets, and token costs. Outputs a machine-readable JSON score tuple for the experiment ratchet. Use when you need a Lighthouse performance score, Core Web Vitals, hyperfine CLI benchmarks, or token-spend metrics. Use --a11y to delegate to improve:accessibility-scan. Do NOT use for PHP/DDEV profiling -- use drupal-lab:perf-measure.

Measure performance and output a JSON score tuple consumable by the experiment ratchet.

## Groups

| Flag | Default? | Tool | Notes |
|---|---|---|---|
| `--frontend` | yes | Lighthouse CLI | `--only-categories=performance --output=json` |
| `--cli` | no | hyperfine | requires `--command "..."` arg |
| `--tokens` | no | rtk + headroom | sources `rtk gain --history` and `headroom perf` when available |
| `--a11y` | no | delegates to `improve:accessibility-scan` | — |

## Setup

```bash
lighthouse --version 2>/dev/null || echo "not installed — run: npm install -g lighthouse"
hyperfine --version 2>/dev/null || echo "not installed"
```

Install if missing:
```bash
npm install -g lighthouse
brew install hyperfine          # macOS
cargo install hyperfine         # Linux
```

For detailed setup see `lib:lighthouse` and `lib:hyperfine`.

## Measure

### Frontend (default)

```bash
lighthouse <url> --only-categories=performance --output=json \
  --output-path=/tmp/lighthouse-output.json \
  --chrome-flags="--headless --no-sandbox --ignore-certificate-errors" 2>/dev/null
jq '{scores: {
  lighthouse_performance: (.categories.performance.score * 100 | round),
  lighthouse_lcp_ms: (.audits["largest-contentful-paint"].numericValue | round),
  lighthouse_tbt_ms: (.audits["total-blocking-time"].numericValue | round),
  lighthouse_fcp_ms: (.audits["first-contentful-paint"].numericValue | round),
  lighthouse_cls: .audits["cumulative-layout-shift"].numericValue
}, ts: now | todate, target: .requestedUrl}' /tmp/lighthouse-output.json
```

Do not pipe Lighthouse output directly to jq — use `--output-path` then read the file. Run 3 times and take the median for `lighthouse_performance`.

For DDEV sites use the external URL `https://sitename.ddev.site`.

### CLI benchmark

```bash
hyperfine --export-json /tmp/hyperfine-result.json "<command>"
jq '{scores: {
  hyperfine_mean_ms: (.results[0].mean * 1000 | round),
  hyperfine_stddev_ms: (.results[0].stddev * 1000 | round),
  hyperfine_min_ms: (.results[0].min * 1000 | round),
  hyperfine_max_ms: (.results[0].max * 1000 | round)
}, ts: now | todate, target: .results[0].command}' /tmp/hyperfine-result.json
```

### Token cost (--tokens)

When `rtk` or `headroom` are present, collect token-spend metrics as ratchet targets.

```bash
if command -v rtk >/dev/null 2>&1; then
  rtk gain --history --json > /tmp/rtk-gain.json 2>/dev/null
fi
if command -v headroom >/dev/null 2>&1; then
  headroom perf --json > /tmp/headroom-perf.json 2>/dev/null
fi
```

Emit a `token_cost` block in the scores object when either binary is present:

```json
{
  "scores": {
    "rtk_tokens_saved": 14200,
    "rtk_savings_pct": 72,
    "headroom_tokens_compressed": 8400,
    "headroom_compression_ratio": 3.1
  }
}
```

If neither binary is present, omit the `token_cost` block silently — the ratchet still works on whatever other scores are present.

### Accessibility delegation

Pass through to `improve:accessibility-scan` with the same URL.

## Output contract

Keys only present when that group ran:

```json
{
  "scores": {
    "lighthouse_performance": 68,
    "lighthouse_lcp_ms": 2400,
    "lighthouse_tbt_ms": 150,
    "lighthouse_fcp_ms": 1200,
    "lighthouse_cls": 0.05,
    "hyperfine_mean_ms": 340,
    "hyperfine_stddev_ms": 12,
    "hyperfine_min_ms": 312,
    "hyperfine_max_ms": 398,
    "rtk_tokens_saved": 14200,
    "rtk_savings_pct": 72,
    "headroom_tokens_compressed": 8400,
    "headroom_compression_ratio": 3.1
  },
  "ts": "2026-06-10T12:00:00Z",
  "target": "https://example.ddev.site"
}
```

## Baseline convention

```bash
# Save baseline
improve:perf-measure measure <url> > /tmp/perf-baseline.json

# Compare after change
jq -s '.[0].scores, .[1].scores' /tmp/perf-baseline.json /tmp/perf-after.json
```

## Using with the experiment loop

Typical ratchet targets:
- `keep if lighthouse_performance > previous.lighthouse_performance`
- `keep if lighthouse_lcp_ms < previous.lighthouse_lcp_ms`
- `keep if hyperfine_mean_ms < previous.hyperfine_mean_ms`
- `keep if rtk_tokens_saved > previous.rtk_tokens_saved`
