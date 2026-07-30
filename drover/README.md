# drover 2.0

> Drupal/Acquia application-error log analysis. Pulls historical logs by
> date, fingerprints + diagnoses errors, renders monthly reports
> stakeholders can read, and files JIRA tickets through whatever JIRA
> mechanism the team prefers (Atlassian MCP, direct REST, or
> plan-only / jira-cli).

## What 2.0 is

A small pipeline of four skills that runs in Claude Code:

```
/drover:init            Discover this project's Acquia + JIRA config; write manifest
/drover:acquia-pull     Pull application-error logs by date into <project>/<year>/<month>/
/drover:report          Render monthly HTML/Markdown reports and final PDFs
/drover:create-tickets  File the report's recommended tickets in JIRA
```

CLI-first. Pure stdlib Python. No dashboard, no daemon, no kanban
board. Run it when you want, get a report and (optionally) JIRA
tickets.

## What 2.0 is not

- Not a monitoring tool (no live tail, no SSE, no alerts)
- Not auto-fixing anything (no implementer agent)
- Not a UI product — the artifact is markdown (open it in any editor,
  GitHub, JIRA, email, Claude Desktop)
- Not multi-platform yet — Drupal/Acquia only. Sitecore / .NET /
  Azure MCP / New Relic land in 2.x as additional discovery + parser
  strategies.

The v1 surface (watchers, dashboard, kanban, auto-fix) lives in git
history at the `drover-1.51.2` tag. v2.0 is a clean break — none of
the v1 features are carried forward in any form.

## Setup

```bash
acli auth:login                                        # one-time: register Acquia API creds
export JIRA_API_TOKEN=...                              # optional: enables /drover:create-tickets direct-REST mode
cd /path/to/your/drupal/project
/drover:init                                           # discover config, write .drover/manifest.json
/drover:acquia-pull --backfill                         # populate the last 30 days
/drover:report --month 2026-04 --template root-cause-summary  # render April's stakeholder report
/drover:create-tickets --plan reports/2026-04.plan.json       # (optional) hand off to JIRA
```

## Folder layout

```
<project-root>/
  .drover/
    manifest.json         # discovered Acquia + JIRA config
    coverage.json         # per (date × env × type) state — auto-maintained
  2026/
    04/
      2026-04-01.prod.apache-error.log
      2026-04-01.prod.drupal-watchdog.log
      2026-04-01.prod.php-error.log
      ...
  reports/
    2026-04-monthly-client.md
    2026-04-root-cause-summary.md
    2026-04-root-cause-summary.md.tickets.json   # JIRA spec sidecar
```

Filename: `YYYY-MM-DD.<env>.<log-type>.log` — sortable, parseable,
tab-completable.

## Skills

### `/drover:init`

Discovers Drupal/Acquia config from local breadcrumbs (drush aliases,
composer.json, .ddev/config.yaml, acquia-pipelines.yml) plus the Acquia
Cloud Platform API. Resolves the application UUID, enumerates envs and
their available log types. Writes `.drover/manifest.json`.

JIRA configuration (project key, board, default sprint, default issue
type) is hand-edited into the manifest's `jira:` block today; future
`/drover:init` will detect the user's `~/.config/.jira/.config.yml`
and prompt for the per-project values.

Zero prompts in the happy path. Aborts with explicit guidance when
acli isn't authed, no breadcrumbs are found, or multiple apps tied at
top score.

### `/drover:acquia-pull`

Reconciles the local log folder against the manifest's expected
`(date × env × type)` tuples. Idempotent: re-runs skip files already
present. For each missing tuple, runs the documented Acquia 3-step
historical download flow (POST to create snapshot → poll notification
→ GET → 301 → S3 → download).

Modes: `--daily` (yesterday only), `--backfill` (last 30 days, fill
gaps), `--from --to` (explicit range), `--date` (single day). A
30-day backfill of one env × 3 types takes ~30 minutes.

User-triggered, not scheduled — no built-in cron. Acquia's 30-day
retention means you should pull before logs age out; plan ahead. If
scheduled pulls become useful for your workflow, ask and we'll add a
cron template.

### `/drover:report`

Renders a markdown report for one calendar month. Five templates:

- **`monthly-client`** — stakeholder-facing summary. Coverage banner,
  top issues table with month-over-month trend arrows, severity
  distribution, retrieval gap list.
- **`root-cause-summary`** — Pareto cut on top issues, share-of-volume
  bar chart, per-issue cause diagnosis from drover's pattern library
  (high/medium/low confidence), JIRA ticket recommendations.
- **`calendar-boundary`** — events-by-channel bar chart (centerpiece),
  events-by-severity, daily volume, top-channels-inside-look. Best
  for windowed analysis (campaign launches, holiday boundaries).
- **`triage-brief`** — dev-facing detail per fingerprint with raw
  sample lines.
- **`jira-ready`** — paste-blocks for JIRA's create-issue dialog when
  `/drover:create-tickets` isn't appropriate.

Stakeholder templates (`monthly-client`, `root-cause-summary`,
`calendar-boundary`) carry a Velir logo + 2025 brand palette and emit
a sidecar JSON of ticket specs alongside the markdown. Cross-channel
de-duplication via `causes.collapse_by_cause()` means the same root
cause surfacing in multiple channels (e.g. Solr flood-protection in
both `search_api` and `acquia_search`) becomes one issue and one
ticket, not two.

Deterministic — same logs in, same report out. No LLM in the
rendering path. The `drover:report-writer` agent (in `agents/`) can
layer narrative prose on top of the deterministic backbone in a
future slice; the deterministic report is the shippable surface for
2.0.

HTML is the default editable report artifact and PDF is the final delivery
artifact. The HTML renderer includes the same five application-log templates
plus `cloudflare-summary`. It discovers additional project templates from
`.drover/templates`, exposes reusable report partials documented in
`render-html/COMPONENTS.md`, and automatically uses a project design at
`.drover/design/DESIGN.md` before falling back to the bundled Velir design.

Final PDF conversion is supported through installed Chrome, Chromium, or Edge
with `render-html/render-pdf.mjs`. Safari and Firefox printing are manual
fallbacks. See `render-html/PDF.md` for the browser support matrix and delivery
checks.

### `/drover:create-tickets`

Reads a sidecar JSON (one ticket spec per top issue from
`/drover:report`) and creates JIRA issues. Drover stays neutral about
the JIRA execution mechanism — three paths share the same stable plan
schema:

- **Atlassian MCP** — Claude calls `mcp__*atlassian*` /
  `mcp__*jira*` tools directly. Drover writes a plan; Claude reads it
  and invokes the matching MCP tools. No shared API token needed.
- **Direct REST** — drover's built-in executor talks to Atlassian
  Cloud's REST API. Needs `JIRA_API_TOKEN` in the env.
- **Plan-only** — drover writes the plan; the operator runs the
  writes themselves with jira-cli, the web UI, or custom tooling.

Per-ticket sprint assignment + parent linking are best-effort: if
either fails, the issue is still created and the failure is captured
in a results sidecar.

## How it gets logs

The Acquia Cloud Platform API exposes a 30-day historical log
download:

```
POST   /environments/{envId}/logs/{type}    body {from, to}    → notification
GET    <notification.href>                  poll until status=completed
GET    /environments/{envId}/logs/{type}    → 301 to presigned S3 URL
GET    <presigned S3 URL>                   → gzipped log bytes
```

The `from`/`to` parameters accept ISO timestamps and slice a 24-hour
window from anywhere in the last 30 days. Acquia's docs reference this
via `acli api:environments:log-create`; `acli` itself doesn't ship a
date-range download command, so drover talks to the API directly via a
stdlib-only Python client (`scripts/monitors/acquia_api.py`).

## Coverage discipline

Every fetched (date × env × type) is recorded in `.drover/coverage.json`
with a state of `present`, `fetch-failed`, or `pending`. The report
skill reads this ledger and surfaces gaps in the rendered markdown — a
report can't claim 30 days of analysis if only 28 are present on disk.
This is what makes the report defensible to clients.

Acquia's 30-day retention window is the hard ceiling. Pull early; if
you wait until day 31 to backfill, you've lost day 1.

## Cause diagnosis

`scripts/causes.py` ships a 17-pattern library covering the most common
Drupal/PHP/Apache error shapes:

- entity_embed missing display, SQL syntax errors, missing tables, DB
  connection failures
- Acquia Solr flood protection
- Drupal login-attempt patterns (credential stuffing detection),
  access-denied responses, cron lock contention, routine cron
  instrumentation noise
- PHP memory exhausted, PHP timeout, Twig errors, route-not-found,
  cache-backend unavailable, uncaught PHP exceptions, missing config
  objects, Apache child process death

Each pattern entry yields a one-line headline, 1–3 sentence
explanation, suggested first-step remediation, and a confidence
rating. Unknown error shapes return an honest "undiagnosed" verdict —
no fabricated speculation. Operators extend the library by adding
entries to `PATTERNS` in `causes.py`; new patterns auto-apply on the
next report.

## Architecture

| Layer | Module | Responsibility |
|---|---|---|
| Acquia HTTP | `scripts/monitors/acquia_api.py` | Stdlib OAuth + Cloud Platform API client |
| Discovery | `scripts/init.py` | Manifest from local breadcrumbs + API |
| Pull | `scripts/pull.py` | 3-step historical download, atomic gunzip, ledger |
| Parse | `scripts/parsers/` | apache-error / drupal-watchdog / php-error → events |
| Aggregate | `scripts/aggregate.py` | Fingerprint + group + count + MoM delta |
| Cause diagnosis | `scripts/causes.py` | Pattern library + collapse_by_cause |
| Charts | `scripts/charts.py` | Unicode bar charts (markdown-renderer-portable) |
| Branding | `scripts/branding.py` | Velir 2025 palette + base64-embedded logo |
| Report render | `scripts/report.py` | Five deterministic templates → markdown |
| HTML render | `render-html/render.mjs` | Discovered Handlebars templates + reusable components → self-contained HTML |
| PDF delivery | `render-html/render-pdf.mjs` | Chrome/Chromium/Edge print pipeline → final PDF |
| Synthesize (future) | `scripts/report_writer.py` + `agents/report-writer.md` | LLM prose on top of the deterministic report |
| JIRA REST | `scripts/jira_api.py` | Stdlib Atlassian Cloud client |
| Ticket recs | `scripts/jira_recs.py` | Spec generator (title, priority, labels, description) |
| Create tickets | `scripts/create_tickets.py` | Three execution paths (MCP / REST / plan) |

## Tests

```bash
python3 -m unittest discover -s drover/tests/python -p 'test_*.py'
```

292 tests across 14 modules. The HTTP-touching suites
(`test_acquia_log_download`, `test_init`, `test_jira_api`) use stub
HTTP servers; nothing in the suite contacts a real Acquia or
Atlassian endpoint. Live verification scripts under `/tmp/recon-*.py`
are not part of CI.

## Future work

- v2.1 — `/drover:init` auto-detection of `~/.config/.jira/.config.yml`
  + interactive prompt for per-project JIRA config (project key,
  board, sprint).
- v2.2 — Sitecore / .NET adapter (different breadcrumbs + parsers).
- v2.3+ — Azure MCP, New Relic MCP, custom platforms.
- AI-prose synthesis via the `drover:report-writer` agent.

## License + Author

Chris Weber. Velir.
