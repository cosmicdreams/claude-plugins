---
name: lighthouse
description: >
  Run Lighthouse against one URL and return JSON scores: performance, Core Web Vitals
  (LCP, TBT, FCP, CLS), and accessibility. For multi-page accessibility scans use
  improve:accessibility-scan.
---

# lib:lighthouse

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Run a Lighthouse audit against a URL and output structured JSON scores. Use when you need a Lighthouse performance score, Core Web Vitals (LCP, TBT, FCP, CLS), or an accessibility score from a single page. Trigger phrases: "run lighthouse", "lighthouse audit", "lighthouse score", "core web vitals", "lighthouse performance", "lighthouse accessibility". Do NOT use for multi-page accessibility scanning (use improve:accessibility-scan for that). Do NOT use for CLI command benchmarking (use lib:hyperfine for that).

Thin wrapper around the `lighthouse` CLI. Outputs JSON scores suitable for the experiment ratchet.

## Pre-flight checks

**`lighthouse` not installed:**
```bash
lighthouse --version 2>/dev/null || echo "NOT INSTALLED"
```
Install: `npm install -g lighthouse`

**Chrome not available:**
Lighthouse requires Chrome or Chromium. On macOS it uses the system Chrome. Verify:
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --version 2>/dev/null || echo "Chrome not found"
```

**Self-signed cert (DDEV sites):**
Always pass `--chrome-flags="--ignore-certificate-errors"`. Do not omit this for local sites.

## Run — performance

> **Always write to a file first.** Lighthouse JSON output is large (200–500 KB). Piping directly to `jq` produces `parse error: Unfinished string at EOF` on large reports. Use `--output-path` then read the file.

```bash
lighthouse <url> \
  --only-categories=performance \
  --output=json \
  --output-path=/tmp/lighthouse-output.json \
  --chrome-flags="--headless --no-sandbox --ignore-certificate-errors" \
  2>/dev/null
jq '{
  lighthouse_performance: (.categories.performance.score * 100 | round),
  lighthouse_lcp_ms: (.audits["largest-contentful-paint"].numericValue | round),
  lighthouse_tbt_ms: (.audits["total-blocking-time"].numericValue | round),
  lighthouse_fcp_ms: (.audits["first-contentful-paint"].numericValue | round),
  lighthouse_cls: .audits["cumulative-layout-shift"].numericValue,
  target: .requestedUrl,
  ts: now | todate
}' /tmp/lighthouse-output.json
```

## Run — accessibility

```bash
lighthouse <url> \
  --only-categories=accessibility \
  --output=json \
  --output-path=/tmp/lighthouse-output.json \
  --chrome-flags="--headless --no-sandbox --ignore-certificate-errors" \
  2>/dev/null
jq '{
  lighthouse_accessibility: (.categories.accessibility.score * 100 | round),
  target: .requestedUrl,
  ts: now | todate
}' /tmp/lighthouse-output.json
```

## Noise — run 3 times, take median

Lighthouse scores vary run-to-run (±5 points typical for performance). For ratchet baselines, run 3 times and take the median `lighthouse_performance`:

```bash
for i in 1 2 3; do
  lighthouse <url> --only-categories=performance --output=json \
    --output-path=/tmp/lighthouse-output.json \
    --chrome-flags="--headless --no-sandbox --ignore-certificate-errors" 2>/dev/null
  jq '.categories.performance.score * 100 | round' /tmp/lighthouse-output.json
done
# Sort the three values, take the middle one
```

## Output contract

```json
{
  "lighthouse_performance": 68,
  "lighthouse_lcp_ms": 2400,
  "lighthouse_tbt_ms": 150,
  "lighthouse_fcp_ms": 1200,
  "lighthouse_cls": 0.05,
  "target": "https://example.ddev.site",
  "ts": "2026-03-21T12:00:00Z"
}
```

| Key | Direction | Unit |
|---|---|---|
| `lighthouse_performance` | higher is better | 0–100 |
| `lighthouse_lcp_ms` | lower is better | milliseconds |
| `lighthouse_tbt_ms` | lower is better | milliseconds |
| `lighthouse_fcp_ms` | lower is better | milliseconds |
| `lighthouse_cls` | lower is better | unitless score |
| `lighthouse_accessibility` | higher is better | 0–100 (accessibility mode only) |

## Error table

| Symptom | Cause | Fix |
|---|---|---|
| `Error: spawn Chrome ENOENT` | Chrome not on PATH | Install Chrome or set `--chrome-path` |
| `PROTOCOL_TIMEOUT` | Page too slow to load | Increase `--max-wait-for-load` (default: 45000ms) |
| `net::ERR_CERT_AUTHORITY_INVALID` | Self-signed cert | Add `--chrome-flags="--ignore-certificate-errors"` |
| `net::ERR_CONNECTION_REFUSED` | Site not running | Start the local server / DDEV first |
| Score is `null` | Page errored before audit | Check the page loads manually; inspect `--output=json` for `runtimeError` |
| High variance between runs | CPU/network contention | Close other apps; run 3× and take median |
