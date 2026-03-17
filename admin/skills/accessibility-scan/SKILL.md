---
name: accessibility-scan
description: Run a multi-tool accessibility audit (Pa11y + axe-core + Lighthouse) against a locally running site and output a JSON score tuple. Use when asked to "scan accessibility", "run a11y audit", "accessibility score", "measure accessibility", "a11y baseline", "accessibility-scan", or when the experiment loop needs a measurement step for accessibility improvements. Takes a base URL (typically a DDEV local site). Do NOT use for manual accessibility review or WCAG consulting -- this is an automated measurement tool.
---

# Accessibility Scan

Run Pa11y, axe-core, and Lighthouse against a site. Output a JSON score tuple consumable by the experiment improvement loop.

## Input

Required: a base URL (e.g., `https://schusterman.ddev.site`).

Optional arguments (pass to the script):
- `--max-pages N` — cap the number of pages to scan (default: 20)
- `--urls file.txt` — explicit URL list instead of sitemap discovery

## Step 1: Ensure Dependencies

The scan script requires Node.js packages. Install on first run:

```bash
SKILL_DIR="$(ls -d ~/.claude/plugins/cache/local/admin/*/skills/accessibility-scan/scripts | tail -1)"
cd "$SKILL_DIR" && npm install 2>&1 | tail -5
```

If `npm install` fails (puppeteer/chromium issues), check that Chrome or Chromium is available on the system.

## Step 2: Run the Scan

```bash
SKILL_DIR="$(ls -d ~/.claude/plugins/cache/local/admin/*/skills/accessibility-scan/scripts | tail -1)"
node "$SKILL_DIR/a11y-scan.mjs" <BASE_URL> [--max-pages 20] 2>/tmp/a11y-progress.log
```

Progress logs go to stderr (`/tmp/a11y-progress.log`). The JSON tuple goes to stdout.

For large sites, start with `--max-pages 10` for a quick baseline, then increase for deeper scans.

## Step 3: Read the Output

The script outputs a single JSON object to stdout:

```json
{
  "scores": {
    "lighthouse": 72,
    "axe_total": 45,
    "axe_critical": 3,
    "axe_serious": 12,
    "pa11y_errors": 128,
    "pa11y_warnings": 34,
    "pages": 20
  },
  "per_page": [
    {
      "url": "https://example.ddev.site/",
      "pa11y": { "errors": 5, "warnings": 2, "notices": 10 },
      "axe": { "violations": 3, "critical": 1, "serious": 1, "moderate": 1, "minor": 0, "passes": 42 },
      "lighthouse": { "score": 68 }
    }
  ]
}
```

### Score Interpretation

| Metric | Direction | What it measures |
|---|---|---|
| `lighthouse` | higher is better | Weighted accessibility score (0-100) |
| `axe_total` | lower is better | Unique violation rule count |
| `axe_critical` | lower is better | Critical + serious impact violations |
| `axe_serious` | lower is better | Serious impact violations |
| `pa11y_errors` | lower is better | WCAG 2.1 AA error count |
| `pa11y_warnings` | lower is better | WCAG 2.1 AA warning count |

A value of `-1` means that tool failed on that page (timeout, crash). The aggregates exclude failed pages.

## Using with the Experiment Loop

The `scores` object is the tuple the experiment ratchet compares between runs. Typical ratchet targets:

- **Quick wins first**: `keep if axe_critical < previous.axe_critical`
- **Broad improvement**: `keep if lighthouse > previous.lighthouse`
- **Deep cleanup**: `keep if pa11y_errors < previous.pa11y_errors`

Save the full output to a file for history:

```bash
node "$SKILL_DIR/a11y-scan.mjs" "$URL" > /tmp/a11y-baseline.json 2>/tmp/a11y-progress.log
```

Then on subsequent runs, compare `scores` objects directly.

## Page Discovery

The script discovers pages in this order:
1. **Explicit URL list** (`--urls file.txt`) — one URL per line
2. **sitemap.xml** — fetches `<base-url>/sitemap.xml` and extracts `<loc>` entries
3. **Homepage crawl** — extracts internal links from the homepage HTML

For local DDEV sites that may not have a sitemap, the homepage crawl fallback works well. For more targeted scans, provide a URL list.

## Troubleshooting

- **Puppeteer/Chrome errors**: Ensure Chrome or Chromium is installed. On macOS, Puppeteer downloads its own Chromium during `npm install`.
- **Timeouts on local sites**: Confirm DDEV is running (`ddev status`). Increase page timeout if the site is slow.
- **Self-signed cert errors**: The script accepts self-signed certificates by default (common with DDEV HTTPS).
