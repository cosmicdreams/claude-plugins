---
name: perf-measure
description: >
  Measure web frontend performance and CLI benchmark targets. Outputs a machine-readable
  JSON score tuple for the experiment ratchet. Use when you need a Lighthouse performance
  score, Core Web Vitals, or hyperfine CLI benchmarks. Use --a11y to delegate to
  improve:accessibility-scan. Do NOT use for PHP/DDEV profiling -- use drupal-lab:perf-measure.
triggers:
  - "measure performance"
  - "lighthouse score"
  - "benchmark this command"
  - "core web vitals"
  - "improve:perf-measure"
---

# perf-measure

Measure web frontend performance and CLI benchmark targets. Outputs a JSON score tuple consumable by the experiment ratchet.

## Groups

| Flag | Default? | Tool | Notes |
|---|---|---|---|
| `--frontend` | yes | Lighthouse CLI | `--only-categories=performance --output=json --chrome-flags="--ignore-certificate-errors"` |
| `--cli` | no | hyperfine | requires `--command "..."` arg |
| `--a11y` | no | delegates to `improve:accessibility-scan` | — |

## Setup

Check first:
```bash
lighthouse --version 2>/dev/null || echo "not installed — run: npm install -g lighthouse"
hyperfine --version 2>/dev/null || echo "not installed"
```

Install if missing:
```bash
# Lighthouse
npm install -g lighthouse

# hyperfine (macOS)
brew install hyperfine

# hyperfine (Linux)
cargo install hyperfine
# or: apt install hyperfine (if available)
```

For detailed setup checks, invocation flags, and error handling see `lib:lighthouse` and `lib:hyperfine`.

## Measure

### Frontend (default)

```bash
lighthouse <url> --only-categories=performance --output=json \
  --chrome-flags="--ignore-certificate-errors --headless --no-sandbox" 2>/dev/null | \
  jq '{scores: {
    lighthouse_performance: (.categories.performance.score * 100 | round),
    lighthouse_lcp_ms: (.audits["largest-contentful-paint"].numericValue | round),
    lighthouse_tbt_ms: (.audits["total-blocking-time"].numericValue | round),
    lighthouse_fcp_ms: (.audits["first-contentful-paint"].numericValue | round),
    lighthouse_cls: .audits["cumulative-layout-shift"].numericValue
  }, ts: now | todate, target: .requestedUrl}'
```

The jq paths above (`audits["largest-contentful-paint"]`, etc.) are stable Lighthouse audit IDs. If scores come back `null`, check that the audit IDs haven't changed by inspecting the raw JSON: `lighthouse <url> --output=json 2>/dev/null | jq '.audits | keys'`. See `lib:lighthouse` for the canonical extraction patterns and error handling.

Run 3 times and take the median score for `lighthouse_performance` to reduce noise.

For DDEV sites: use the external URL `https://sitename.ddev.site` (not `http://web` — that's internal only).

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

hyperfine defaults to ≥10 runs for statistical stability. For `--warmup`, `--min-runs`, comparison mode, and noise interpretation see `lib:hyperfine`.

### Accessibility delegation

Pass through to `improve:accessibility-scan` with the same URL.

## Output Contract

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
    "hyperfine_max_ms": 398
  },
  "ts": "2026-03-21T12:00:00Z",
  "target": "https://example.ddev.site"
}
```

## Baseline Convention

Save baseline:
```bash
improve:perf-measure measure <url> > /tmp/perf-baseline.json
```

Compare after a change:
```bash
jq -s '.[0].scores, .[1].scores' /tmp/perf-baseline.json /tmp/perf-after.json
```

## Using with the Experiment Loop

The `scores` object is the tuple the experiment ratchet compares between runs. Typical ratchet targets:

- **Performance**: `keep if lighthouse_performance > previous.lighthouse_performance`
- **LCP**: `keep if lighthouse_lcp_ms < previous.lighthouse_lcp_ms`
- **CLI speed**: `keep if hyperfine_mean_ms < previous.hyperfine_mean_ms`
