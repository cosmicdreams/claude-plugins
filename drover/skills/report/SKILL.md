---
name: drover:report
description: >
  Render a markdown report for a calendar month from a project's local
  logs and coverage ledger. Three templates: monthly-client (stakeholder),
  triage-brief (developer), jira-ready (paste-ready issue blocks).
  Deterministic — same inputs produce the same output. Coverage caveats
  are surfaced automatically when any day is missing or fetch-failed.
  Trigger phrases — "drover report", "monthly report for <project>",
  "summarize <project> April", "triage brief for <env>".
allowed-tools: Bash, Read
---

# drover:report

## What it does

Walks `<project>/<year>/<month>/<date>.<env>.<type>.log`, parses every
log file in the requested calendar month, fingerprints + groups errors,
applies month-over-month delta vs the prior calendar month if data
exists, and renders one of three markdown templates.

The output is **deterministic**: same logs in, same report out. No LLM
in the rendering path.

## Prerequisites

```bash
test -f .drover/manifest.json || { echo "Run /drover:init first."; exit 1; }
```

You also need logs on disk. Run `/drover:acquia-pull` first to populate
them, ideally via a daily cron (Acquia's 30-day retention means
backfilling a full month after the fact will miss the early days).

## Step 1: Resolve the plugin's report script

```bash
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/local/drover/*/ 2>/dev/null | tail -1)
REPORT_PY="${PLUGIN_ROOT}scripts/report.py"
test -f "$REPORT_PY" || { echo "drover plugin not installed at $REPORT_PY"; exit 1; }
```

## Step 2: Render

`--env` defaults to `prod` — the common case. Pass `--env <name>`
to render against a different env.

```bash
# Stakeholder report for April 2026 (prod by default)
python3 "$REPORT_PY" --month 2026-04

# Dev-facing triage brief
python3 "$REPORT_PY" --month 2026-04 --template triage-brief

# JIRA paste blocks
python3 "$REPORT_PY" --month 2026-04 --template jira-ready

# Skip month-over-month comparison
python3 "$REPORT_PY" --month 2026-04 --no-prior

# Custom output path
python3 "$REPORT_PY" --month 2026-04 --out /tmp/april.md

# Override the type list (default: every type in the manifest for this env)
python3 "$REPORT_PY" --month 2026-04 --types drupal-watchdog

# Override env: render the stage env's report
python3 "$REPORT_PY" --env stage --month 2026-04
```

## Templates

### `monthly-client` (default)

Stakeholder-facing. Plain language. Sections:

- Coverage banner (✅ 100% / ⚠ partial)
- Summary — total event count, top-channel volume share, MoM trend
- Top issues table (top 10) with channel, severity, count, trend arrow
- Severity distribution table
- Days affected by retrieval gaps (only when imperfect)
- Issues that disappeared since prior month (only with prior data)

### `triage-brief`

Developer-facing. One block per fingerprint (top 25):

- Fingerprint, channel, majority severity, count
- First/last seen
- Severity histogram
- Truncated message summary
- Up to 3 raw sample lines

### `jira-ready`

One self-contained code block per top fingerprint (top 15), formatted
for direct paste into a JIRA "Create issue" dialog:

- Title with `[project/env] channel: summary` shape
- Description block: project, env, month, channel, severity,
  occurrences, first/last seen, drover fingerprint, summary, sample
  lines

## How prior-month comparison works

Default: the prior calendar month is auto-derived from `--month`. If
the prior month's logs are also on disk, the report includes:

- Per-fingerprint trend arrows (↑ ↓ · 🆕)
- Delta percentage vs prior month
- "Disappeared since prior month" section in monthly-client

If the prior month has zero data (e.g. drover was set up mid-month),
the comparison is silently skipped.

Force-skip with `--no-prior`. Override the prior with
`--prior-month YYYY-MM`.

## Output location

Default: `<project>/reports/<month>-<template>.md`. Created if missing.

Override with `--out PATH`.

## Coverage caveats

If any day in the requested month has a non-`present` coverage state
(missing-upstream, fetch-failed, pending), the report surfaces it:

- A `⚠ Coverage: NN%` banner at the top
- Per-day list of affected (date, log_type, state, reason) entries

This makes the report defensible even when data is incomplete: the
gaps are stated, not hidden.

## Future: AI-synthesized prose

The `drover:report-writer` agent (slice 7) can layer narrative prose
on top of the deterministic report. That integration is wired in
slice 8.5 / post-2.0; for now the deterministic report is the
shippable surface. Stakeholders care about the facts; prose is polish.
