---
name: drover:report
description: >
  Render a calendar-month log report from local logs and the coverage ledger:
  Velir-branded HTML by default, PDF for delivery, markdown as fallback. Stakeholder
  templates add charts and a diagnosed `.evidence.json` sidecar. `process-lab:recommend-tickets` turns it into ticket recommendations. Custom
  Handlebars templates go in .drover/templates. Deterministic.
allowed-tools: Bash, Read, AskUserQuestion
---

# drover:report

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Render a report for a calendar month from a project's local logs and coverage ledger — self-contained Velir-branded HTML by default, finalized to PDF for delivery, with markdown available as a lightweight fallback. Five application-log templates cover stakeholder, dev, and JIRA-paste workflows. Stakeholder templates carry a Velir logo, brand colors, bar charts (by channel, severity, daily volume), and a diagnosed `.evidence.json` sidecar. `process-lab:recommend-tickets` turns the evidence into ticket recommendations. A sixth bundled HTML template covers Cloudflare traffic/offload data, and developers can drop custom Handlebars templates into `.drover/templates`. Deterministic — same inputs produce the same output. Trigger phrases — "drover report", "monthly report for <project>", "summarize <project> April", "root cause summary", "calendar window report".

## What it does

Walks `<project>/<year>/<month>/<date>.<env>.<type>.log`, parses every log file in the requested calendar month, fingerprints + groups errors, applies month-over-month delta vs the prior calendar month if data exists, and renders structured JSON into an editable HTML report. The standard delivery path keeps the HTML source and finalizes it to PDF. Markdown remains available when a lightweight text artifact is specifically requested.

The JSON, Markdown, and HTML outputs are **deterministic in their analysis**: same logs and configuration in, same events, groups, counts, deltas and evidence out. No large language model is in the rendering path. The generation timestamp (`generated_at`, surfaced in the report footer) varies between runs; exclude it when comparing output. PDF bytes can additionally vary by browser version even when the visible report is unchanged.

## Default delivery path

Unless the user explicitly asks for Markdown only:

1. Run `report.py --format json` to create the structured aggregate.
2. Render that aggregate to HTML with the selected bundled or local template.
3. Keep the HTML as the editable source artifact.
4. Produce and inspect the final PDF using the supported browser path.

The Python Markdown renderer remains supported for quick terminal review and JIRA-paste workflows, but it is not the primary stakeholder deliverable.

## Templates

### Stakeholder-facing (Velir logo + brand colors + evidence sidecar)

| Template | What it answers |
|---|---|
| `monthly-client` | "How was last month overall?" — totals, top issues, MoM trend, severity distribution. |
| `root-cause-summary` | "What 5 things should we fix to silence most of this month's noise?" — Pareto cut, share-of-volume bar chart, per-issue detail. |
| `calendar-boundary` | "What kinds of issues happened during this window?" — events-by-channel bar chart (Drupal watchdog channels), events-by-severity, daily volume. |

All three write `reports/<month>-<template>.evidence.json` with diagnosed, cause-collapsed groups. Run `process-lab:recommend-tickets` to turn that evidence into ticket recommendations.

### Dev / operational

| Template | What it answers |
|---|---|
| `triage-brief` | "What does each top fingerprint look like up close?" — top 25 with full samples + severity histogram. |
| `jira-ready` | "Give me JIRA-create-issue paste blocks." — one self-contained code block per fingerprint. |

## Optional Jev judgments

When `TYPESAFE_API_KEY` is set (and `JEV_DISABLED` is not `1`), `report.py` adds two judgments from TypeSafe's Jev model on top of the deterministic pipeline: a severity for watchdog events the log left `unknown`, and a merge gate on cause collapse (fingerprints merge only when Jev confidently agrees they share a root cause). Hashes, counts, and source-given severity are unchanged. The markdown footer, terminal summary, and a `jev` block in the `--format json` output count verdicts from Jev versus fallback. Pass `--no-jev` to skip it.

## Prerequisites

```bash
test -f .drover/manifest.json || { echo "Run /drover:init first."; exit 1; }
```

You also need logs on disk. Run `/drover:acquia-pull` first to populate them — Acquia's 30-day retention means backfilling a full month after the fact will miss the early days.

## Step 1: Resolve the plugin's report script

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
REPORT_PY="${PLUGIN_ROOT}/scripts/report.py"
test -f "$REPORT_PY" || { echo "drover plugin not installed at $REPORT_PY"; exit 1; }
```

## Step 2: Render Markdown (optional lightweight path)

Use this direct path when the user requests Markdown or a terminal-friendly artifact. `--env` defaults to `prod`. Pass `--env <name>` to override.

```bash
# Stakeholder summary for April 2026 (the default)
python3 "$REPORT_PY" --month 2026-04

# Top-5 root-cause concentration
python3 "$REPORT_PY" --month 2026-04 --template root-cause-summary

# Channel-distribution view (best for a campaign / window)
python3 "$REPORT_PY" --month 2026-04 --template calendar-boundary

# Dev-facing fingerprint detail
python3 "$REPORT_PY" --month 2026-04 --template triage-brief

# JIRA paste blocks
python3 "$REPORT_PY" --month 2026-04 --template jira-ready

# Skip month-over-month comparison
python3 "$REPORT_PY" --month 2026-04 --no-prior

# Override env / output path / type list
python3 "$REPORT_PY" --month 2026-04 --env stage --out /tmp/april-stage.md
python3 "$REPORT_PY" --month 2026-04 --types drupal-watchdog
```

The CLI prints events, groups, and coverage, then writes the report and, for stakeholder templates, `reports/<month>-<template>.evidence.json`.

## Step 2b: HTML output (default report artifact)

For a polished, self-contained HTML report (Velir-branded, all CSS inlined), use the two-stage Python→Node path: `report.py` emits a structured JSON aggregate, and the Node renderer turns that JSON + the design tokens into HTML.

**Additional prerequisite:** Node ≥20 on PATH. The renderer installs its own dependencies on first run (a one-time `npm ci` from a committed lockfile) — `node_modules` is not vendored. No other setup.

```bash
# 1. Emit the structured aggregate (schema-versioned, deterministic).
#    --template is ignored here; --format=json drives the output.
python3 "$REPORT_PY" --month 2026-04 --format json
#    → writes reports/2026-04.json

# 2. Render HTML from that JSON.
node "${PLUGIN_ROOT}/render-html/render.mjs" \
  --data reports/2026-04.json \
  --template monthly-client \
  --out reports/2026-04-monthly-client.html
#    → first run prints "[drover] installing HTML render deps…", then
#      writes the HTML; subsequent runs skip the install.
```

The JSON carries everything a renderer needs — totals, severity/channel breakdowns, by-day volume, fingerprint groups (raw and cause-collapsed), month-over-month deltas when prior data exists. Both stages are deterministic apart from the embedded generation timestamp: same logs and configuration in, same HTML out, modulo that timestamp.

Renderer flags: `--data` (required), `--template` (default `monthly-client`), `--design` (default the plugin's `DESIGN.md`), `--logo`, `--out` (default: alongside `--data`, `.json`→`-<template>.html`).

All five application-log templates render in HTML: `monthly-client`, `root-cause-summary`, `calendar-boundary`, `triage-brief`, `jira-ready` — same names as the markdown path. The HTML output adds interactivity that markdown can't: a persisted dark-mode toggle, hover tooltips on charts, real-time search + severity filtering (triage-brief, jira-ready), and one-click "Copy Specs" to the clipboard (jira-ready). Shared chrome (theme init, toggle button, toggle handler) lives in `render-html/templates/partials/` and is injected into every template, so it stays consistent across all five.

A sixth bundled HTML-only template, `cloudflare-summary`, renders Cloudflare traffic/offload JSON with country, cache-status, daily-bandwidth, and bot-class views. Its input is an external structured JSON document rather than the application-log aggregate produced by `report.py`.

Templates are discovered from the filesystem rather than a hard-coded list:

```bash
# Show every available template and the file that supplies it.
node "${PLUGIN_ROOT}/render-html/render.mjs" --list-templates

# A project developer can add .drover/templates/my-report.hbs, then:
node "${PLUGIN_ROOT}/render-html/render.mjs" \
  --data reports/2026-04.json \
  --template my-report \
  --out reports/2026-04-my-report.html
```

Discovery priority is repeated `--templates <dir>` arguments, `DROVER_TEMPLATE_DIRS`, the current project's `.drover/templates`, then the bundled template folder. Custom templates receive the untouched input under `data`, generated CSS under `css`, the embedded logo under `logoDataUri`, and normalized `meta` / `generatedAt` values. See `render-html/COMPONENTS.md` for the reusable headers, metrics, charts, callouts, coverage, and footer partials.

### Design selection

The renderer uses the first design file it finds:

1. `--design /path/to/DESIGN.md`
2. `DROVER_DESIGN`
3. `.drover/design/DESIGN.md` (lowercase `design.md` is also accepted)
4. the bundled `assets/design/DESIGN.md`

To customize a project's reports without changing the plugin:

```bash
mkdir -p .drover/design
cp -f "${PLUGIN_ROOT}/assets/design/DESIGN.md" .drover/design/DESIGN.md
```

Edit the project copy; subsequent renders pick it up automatically.

## Step 2c: Finalize HTML to PDF

HTML is the editable source report. PDF is the final delivery artifact. Drover supports automated PDF generation through an installed Google Chrome, Chromium, or Microsoft Edge executable:

```bash
node "${PLUGIN_ROOT}/render-html/render-pdf.mjs" \
  --html reports/2026-04-monthly-client.html \
  --out reports/2026-04-monthly-client.pdf
```

Use `--browser /path/to/browser` or `DROVER_PDF_BROWSER` when auto-detection cannot find it. Safari and Firefox Print → Save as PDF are manual fallbacks; `wkhtmltopdf` and WeasyPrint are not supported conversion engines. The shared print CSS preserves color, removes interactive controls, controls section/card page breaks, and wraps long samples. Page size and margin come from the design file's `print` tokens. See `render-html/PDF.md` for the complete support matrix and delivery checklist.

## Step 3: Use the evidence

The stakeholder report writes `reports/<month>-<template>.evidence.json` beside the report. It contains the reporting window, coverage, total events, and diagnosed groups after shared-cause collapse. Run `process-lab:recommend-tickets` on that file to apply the project's Jira strategy and review ticket suggestions.

## How prior-month comparison works

Default: the prior calendar month is auto-derived from `--month`. If the prior month's logs are also on disk, the report includes:

- Per-fingerprint trend arrows (↑ ↓ · 🆕)
- Delta percentage vs prior month
- "Disappeared since prior month" section in monthly-client

If the prior month has zero data (e.g. drover was set up mid-month), the comparison is silently skipped.

Force-skip with `--no-prior`. Override the prior with `--prior-month YYYY-MM`.

## Coverage caveats

If any day in the requested month has a non-`present` coverage state (missing-upstream, fetch-failed, pending), every stakeholder template surfaces it:

- A `⚠ Coverage: NN%` banner at the top
- A per-day list of affected (date, log_type, state, reason) entries

This makes the report defensible even when data is incomplete.

## Branding

Stakeholder templates carry a Velir logo (PNG, base64-embedded so the markdown is self-contained and travels through any viewer) and a brand palette extracted from the Velir 2025 Word template:

- `#001B67` primary navy · `#0051FF` accent blue · `#00321A` accent green
- `#FAD200`/`#FFE146` highlight gold/yellow
- `#C8F5E3`/`#E6E8FF`/`#FFF4D8` tinted backgrounds

The palette is exposed in `scripts/branding.py` for markdown and in `assets/design/DESIGN.md` for HTML. Reusable HTML components are documented in `render-html/COMPONENTS.md` for any future template that wants to color-code severity bars, callouts, or callout panels.

## Future: AI-synthesized prose

The `drover:report-writer` agent (slice 7) can layer narrative prose on top of the deterministic report. The deterministic report is the shippable surface for 2.0; AI prose is a follow-up enhancement.
