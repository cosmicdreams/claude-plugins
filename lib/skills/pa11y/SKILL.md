---
name: pa11y
description: >
  Run a Pa11y WCAG 2.1 AA audit against one URL and return JSON errors and warnings. For
  multi-page scans, or for axe-core and Lighthouse results, use
  improve:accessibility-scan.
---

# lib:pa11y

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Run a Pa11y WCAG accessibility audit against a URL and output structured JSON results. Use when you need WCAG 2.1 AA error and warning counts for a single page. Trigger phrases: "pa11y", "wcag audit", "pa11y scan", "accessibility errors for this page". Do NOT use for multi-page accessibility scanning (use improve:accessibility-scan for that — it orchestrates pa11y, axe-core, and Lighthouse together). Do NOT use when you need axe-core violations or Lighthouse accessibility scores (those require the full improve:accessibility-scan flow).

Thin wrapper around the `pa11y` CLI. Outputs JSON accessibility results for a single page.

## Pre-flight checks

**`pa11y` not installed:**
```bash
pa11y --version 2>/dev/null || echo "NOT INSTALLED"
```
Install: `npm install -g pa11y`

**Node.js required** — pa11y requires Node.js ≥18:
```bash
node --version
```

**Self-signed cert (DDEV sites):**
Pa11y uses Chromium internally. Pass `--ignore-url` is not enough — use `--chromium-flags` to accept self-signed certs. See Run section below.

## Run — single page

```bash
pa11y --reporter json <url>
```

For local sites with self-signed certificates (DDEV):
```bash
pa11y --reporter json \
  --chromium-flags "--ignore-certificate-errors" \
  <url>
```

## Run — with standard (default is WCAG2AA)

```bash
pa11y --reporter json --standard WCAG2AA <url>
```

Available standards: `WCAG2A`, `WCAG2AA` (default), `WCAG2AAA`, `Section508`

## Extract counts with jq

Pa11y `--reporter json` outputs an array of issues. Extract counts:

```bash
pa11y --reporter json --chromium-flags "--ignore-certificate-errors" <url> | \
  jq '{
    pa11y_errors: [.[] | select(.type == "error")] | length,
    pa11y_warnings: [.[] | select(.type == "warning")] | length,
    pa11y_notices: [.[] | select(.type == "notice")] | length,
    url: "'"<url>"'",
    ts: now | todate
  }'
```

## Output contract — raw issue object

Each item in the JSON array:
```json
{
  "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
  "type": "error",
  "message": "Img element missing an alt attribute.",
  "context": "<img src=\"...\" />",
  "selector": "#main-content > img:nth-child(2)"
}
```

## Output contract — aggregated (after jq)

```json
{
  "pa11y_errors": 12,
  "pa11y_warnings": 4,
  "pa11y_notices": 31,
  "url": "https://example.ddev.site/",
  "ts": "2026-03-21T12:00:00Z"
}
```

| Key | Direction | Notes |
|---|---|---|
| `pa11y_errors` | lower is better | WCAG violations — must fix |
| `pa11y_warnings` | lower is better | Likely issues — should fix |
| `pa11y_notices` | — | Informational — review manually |

**Ratchet rule:** `keep if pa11y_errors < previous.pa11y_errors`

## Error table

| Symptom | Cause | Fix |
|---|---|---|
| `net::ERR_CERT_AUTHORITY_INVALID` | Self-signed cert | Add `--chromium-flags "--ignore-certificate-errors"` |
| `net::ERR_CONNECTION_REFUSED` | Site not running | Start local server / DDEV first |
| `TimeoutError: Navigation timeout` | Page too slow | Add `--timeout 60000` (ms) |
| Empty array `[]` returned | No issues found — this is correct | Result is clean for this page |
| `pa11y: command not found` | Not installed | `npm install -g pa11y` |
| `Error: Failed to run Pa11y` with no detail | Chromium crash | Try running pa11y directly in terminal to see full error |
