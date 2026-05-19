---
name: drover:report
description: >
  Render a report for a calendar month from a project's local logs and
  coverage ledger — markdown by default, or self-contained Velir-branded
  HTML via the optional Python→Node render path. Five templates cover
  stakeholder, dev, and JIRA-paste workflows. Stakeholder templates carry a Velir logo, brand
  colors, bar charts (by channel, severity, daily volume), and a
  "Recommended JIRA tickets" section plus a JSON sidecar listing each
  ticket spec for downstream programmatic creation. Deterministic — same
  inputs produce the same output. Trigger phrases — "drover report",
  "monthly report for <project>", "summarize <project> April",
  "root cause summary", "calendar window report".
allowed-tools: Bash, Read, AskUserQuestion
---

# drover:report

## What it does

Walks `<project>/<year>/<month>/<date>.<env>.<type>.log`, parses every
log file in the requested calendar month, fingerprints + groups errors,
applies month-over-month delta vs the prior calendar month if data
exists, and renders one of five markdown templates.

The output is **deterministic**: same logs in, same report out. No LLM
in the rendering path.

## Templates

### Stakeholder-facing (Velir logo + brand colors + JIRA recommendations)

| Template | What it answers |
|---|---|
| `monthly-client` | "How was last month overall?" — totals, top issues, MoM trend, severity distribution. |
| `root-cause-summary` | "What 5 things should we fix to silence most of this month's noise?" — Pareto cut, share-of-volume bar chart, per-issue detail. |
| `calendar-boundary` | "What kinds of issues happened during this window?" — events-by-channel bar chart (Drupal watchdog channels), events-by-severity, daily volume. |

All three end with **Recommended JIRA tickets** (suggested title,
priority, labels, description per top issue) and write a sidecar JSON
file (`<report>.tickets.json`) for programmatic creation later.

### Dev / operational

| Template | What it answers |
|---|---|
| `triage-brief` | "What does each top fingerprint look like up close?" — top 25 with full samples + severity histogram. |
| `jira-ready` | "Give me JIRA-create-issue paste blocks." — one self-contained code block per fingerprint. |

## Prerequisites

```bash
test -f .drover/manifest.json || { echo "Run /drover:init first."; exit 1; }
```

You also need logs on disk. Run `/drover:acquia-pull` first to populate
them — Acquia's 30-day retention means backfilling a full month after
the fact will miss the early days.

## Step 1: Resolve the plugin's report script

```bash
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/local/drover/*/ 2>/dev/null | tail -1)
REPORT_PY="${PLUGIN_ROOT}scripts/report.py"
test -f "$REPORT_PY" || { echo "drover plugin not installed at $REPORT_PY"; exit 1; }
```

## Step 2: Render

`--env` defaults to `prod`. Pass `--env <name>` to override.

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

# Skip the JIRA recommendation block + sidecar
python3 "$REPORT_PY" --month 2026-04 --template root-cause-summary --no-tickets

# Override env / output path / type list
python3 "$REPORT_PY" --month 2026-04 --env stage --out /tmp/april-stage.md
python3 "$REPORT_PY" --month 2026-04 --types drupal-watchdog
```

The CLI prints a summary line (events / groups / coverage % / tickets
suggested) and writes:

- `reports/<month>-<template>.md` — the rendered report
- `reports/<month>-<template>.md.tickets.json` — sidecar (stakeholder
  templates only, when tickets are recommended)

## Step 2b (optional): HTML output

Markdown is the default. For a polished, self-contained HTML report
(Velir-branded, all CSS inlined), use the two-stage Python→Node path:
`report.py` emits a structured JSON aggregate, and the Node renderer
turns that JSON + the design tokens into HTML.

**Additional prerequisite:** Node ≥20 on PATH. The renderer installs its
own dependencies on first run (a one-time `npm ci` from a committed
lockfile) — `node_modules` is not vendored. No other setup.

```bash
# 1. Emit the structured aggregate (schema-versioned, deterministic).
#    --template is ignored here; --format=json drives the output.
python3 "$REPORT_PY" --month 2026-04 --format json
#    → writes reports/2026-04.json

# 2. Render HTML from that JSON.
node "${PLUGIN_ROOT}render-html/render.mjs" \
  --data reports/2026-04.json \
  --template monthly-client \
  --out reports/2026-04-monthly-client.html
#    → first run prints "[drover] installing HTML render deps…", then
#      writes the HTML; subsequent runs skip the install.
```

The JSON carries everything a renderer needs — totals, severity/channel
breakdowns, by-day volume, fingerprint groups (raw and cause-collapsed),
MoM deltas when prior data exists, and the JIRA ticket specs. Both stages
are deterministic: same logs in, byte-identical HTML out.

Renderer flags: `--data` (required), `--template` (default
`monthly-client`), `--design` (default the plugin's `DESIGN.md`),
`--logo`, `--out` (default: alongside `--data`, `.json`→`-<template>.html`).

Templates available in HTML: `monthly-client`. (The five markdown
templates are not all ported yet — markdown remains the path for
`root-cause-summary`, `calendar-boundary`, `triage-brief`, `jira-ready`.)

## Step 3: Optional — create the suggested tickets in JIRA

After rendering a stakeholder template that emitted ticket
recommendations, ask the user whether to follow through:

```
Use AskUserQuestion to ask:
  "Create the N suggested tickets in JIRA?"
  options:
    - "Yes — file via /drover:create-tickets" — invoke the
      create-tickets skill which reads this sidecar and routes to
      Atlassian MCP, direct REST, or plan-only based on what the
      operator's environment supports.
    - "Edit first" — open the report in $EDITOR for review; user
      reruns the create flow when ready
    - "Skip" — leave the sidecar in place; nothing is sent
```

The follow-up workflow lives in `/drover:create-tickets`, which
consumes this sidecar directly. See that skill's README for the
three execution paths (Atlassian MCP / direct REST / plan-only) and
the prerequisite JIRA configuration in the manifest's `jira:` block.

The sidecar shape — one record per ticket — is stable and
forward-compatible:

```json
{
  "fingerprint": "abc123def456",
  "title": "[entity_embed] Invalid display settings encountered.",
  "description": "**Reported by drover...**\n\n- Channel: ...",
  "priority": "P1",
  "labels": ["drover-suggested", "drover-project-pncb",
             "drover-env-prod", "drover-channel-entity-embed",
             "drover-severity-warning"],
  "channel": "entity_embed",
  "severity": "warning",
  "count": 31171,
  "first_seen": "2026-04-01T00:01:27+00:00",
  "last_seen": "2026-04-26T23:55:21+00:00",
  "sample": "Apr 1 00:01:27 ..."
}
```

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

## Coverage caveats

If any day in the requested month has a non-`present` coverage state
(missing-upstream, fetch-failed, pending), every stakeholder template
surfaces it:

- A `⚠ Coverage: NN%` banner at the top
- A per-day list of affected (date, log_type, state, reason) entries

This makes the report defensible even when data is incomplete.

## Branding

Stakeholder templates carry a Velir logo (PNG, base64-embedded so the
markdown is self-contained and travels through any viewer) and a brand
palette extracted from the Velir 2025 Word template:

- `#001B67` primary navy · `#0051FF` accent blue · `#00321A` accent green
- `#FAD200`/`#FFE146` highlight gold/yellow
- `#C8F5E3`/`#E6E8FF`/`#FFF4D8` tinted backgrounds

The palette is exposed in `scripts/branding.py` for any future template
that wants to color-code severity bars, callouts, or callout panels.

## Future: AI-synthesized prose

The `drover:report-writer` agent (slice 7) can layer narrative prose
on top of the deterministic report. The deterministic report is the
shippable surface for 2.0; AI prose is a follow-up enhancement.
