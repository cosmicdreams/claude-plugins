# drover 2.0

> Drupal/Acquia application-error log analysis. Pulls historical logs by
> date, fingerprints errors, and renders monthly reports stakeholders
> can read.

## What 2.0 is

A small pipeline of three skills that runs in Claude Code:

```
/drover:init           Discover this project's Acquia config; write manifest
/drover:acquia-pull    Pull application-error logs by date into <project>/<year>/<month>/
/drover:report         Render a monthly markdown report from those logs
```

That's the whole product. CLI-first. Pure stdlib Python. No dashboard,
no daemon, no kanban board. Run it when you want, get a report.

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
cd /path/to/your/drupal/project
/drover:init                                           # discover config, write .drover/manifest.json
/drover:acquia-pull --env all --backfill               # populate the last 30 days
/drover:report --env prod --month 2026-04              # render April's report
```

## Folder layout

```
<project-root>/
  .drover/
    manifest.json         # discovered Acquia config (app uuid, envs, types)
    coverage.json         # per (date × env × type) state — auto-maintained
  2026/
    04/
      2026-04-01.prod.apache-error.log
      2026-04-01.prod.drupal-watchdog.log
      2026-04-01.prod.php-error.log
      ...
  reports/
    2026-04-monthly-client.md
    2026-04-triage-brief.md
```

Filename: `YYYY-MM-DD.<env>.<log-type>.log` — sortable, parseable,
tab-completable.

## Skills

### `/drover:init`

Discovers Drupal/Acquia config from local breadcrumbs (drush aliases,
composer.json, .ddev/config.yaml, acquia-pipelines.yml) plus the Acquia
Cloud Platform API. Resolves the application UUID, enumerates envs and
their available log types, writes `.drover/manifest.json`.

Zero prompts in the happy path. Aborts with explicit guidance when:
acli not authed, no breadcrumbs found, multiple apps tied at top score.

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

Renders a markdown report for one calendar month. Three templates:

- **`monthly-client`** — stakeholder-facing, plain language. Coverage
  banner, summary, top-10 issues with month-over-month trend arrows,
  severity distribution, retrieval gap list.
- **`triage-brief`** — dev-facing. Top 25 fingerprints with full
  detail and 3 sample raw lines per group.
- **`jira-ready`** — top 15 self-contained code blocks paste-ready
  for JIRA's create-issue dialog.

Deterministic. Same logs in, same report out. No LLM in the rendering
path. The `drover:report-writer` agent (in `agents/`) can be wired to
synthesize prose for narrative sections in a future slice — the
deterministic report is what 2.0 ships.

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

## Architecture

| Layer | Module | Responsibility |
|---|---|---|
| Acquia HTTP | `scripts/monitors/acquia_api.py` | Stdlib OAuth + Cloud Platform API client |
| Discovery | `scripts/init.py` | Manifest from local breadcrumbs + API |
| Pull | `scripts/pull.py` | 3-step historical download, atomic gunzip, ledger |
| Parse | `scripts/parsers/` | apache-error / drupal-watchdog / php-error → events |
| Aggregate | `scripts/aggregate.py` | Fingerprint + group + count + MoM delta |
| Synthesize | `scripts/report_writer.py` + `agents/report-writer.md` | Optional LLM prose layer (future) |
| Render | `scripts/report.py` | Three deterministic templates → markdown |

## Tests

```bash
python3 -m unittest discover -s drover/tests/python -p 'test_*.py'
```

182 tests across 9 modules. The HTTP-touching suites
(`test_acquia_log_download`, `test_init`) use a stub HTTP server;
nothing in the suite contacts a real Acquia endpoint. Live verification
scripts under `/tmp/recon-*.py` are not part of CI.

## Future work

Tracked in `~/Vaults/Neurons/Drover-2.0/plan.md`:

- v2.1 — `/drover:export-jira` (real JIRA API integration)
- v2.2 — Sitecore / .NET adapter (different breadcrumbs + parsers)
- v2.3+ — Azure MCP, New Relic MCP, custom platforms
- AI-prose synthesis via the `drover:report-writer` agent

## License + Author

Chris Weber. Velir.
