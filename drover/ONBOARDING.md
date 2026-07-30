# drover 2.0 — Onboarding

First-run guide for setting up drover on a Drupal/Acquia project.
Budget: **5 minutes of your time** plus 15–30 minutes of background
log-pull while you do other work.

## Before you start

- A Drupal project on Acquia Cloud Platform that you have access to.
- `acli` installed (`brew install acquia/cli/acli` on macOS) and
  authenticated (`acli auth:login` once).
- Python 3.10+ on your machine.
- The drover plugin installed at user scope:
  `claude plugin install drover@velir --scope user`
- Optional but recommended for `/drover:create-tickets`:
  - `JIRA_API_TOKEN` env var (token from id.atlassian.com), AND
  - `~/.config/.jira/.config.yml` with `server:` + `login:` (drover
    reads these for Atlassian instance + email; most operators
    already have this from running `jira-cli` once).

**You do not need a logo or a design file.** Velir branding — the logo,
colour tokens, and typography — ships inside the plugin and is applied
automatically, so a first report on a fresh project is correctly branded
with nothing extra to install, copy, or track down. Every render prints
the `design:` and `logo:` paths it resolved, so you can always see what
was used. Overriding is possible but rarely wanted; see the Branding
section of `/drover:init` for the resolution order.

## Step 1 — discover the project

In your project root:

```
/drover:init
```

This reads your `drush/sites/*.site.yml`, `composer.json`,
`.ddev/config.yaml`, etc. and matches against the Acquia Cloud
applications you have access to. Output:

```
matched: Pediatric Nursing Certification Board (fa5e7770-...)
envs:    [dev, prod, test]
wrote:   .drover/manifest.json
```

If discovery fails, the error message tells you exactly what to do
(usually `acli auth:login` or `--app NAME` to disambiguate).

## Step 1.5 — (optional) add JIRA config to the manifest

If you plan to use `/drover:create-tickets` later, hand-edit
`.drover/manifest.json` to add a `jira:` block:

```json
"jira": {
  "project_key": "PPS",
  "board_id": 845,
  "default_sprint_id": 18347,
  "default_sprint_name": "2026.2",
  "default_issue_type": "Chore"
}
```

The board id is the Atlassian board the project lives on (visible in
the URL when you view the board). The sprint id is the active or
upcoming sprint. The issue type is whatever your project uses for
small operational fixes — `Chore` / `Task` / `Bug` are common.

A future `/drover:init` will detect and prompt for these
automatically.

## Step 2 — backfill the last 30 days

```
/drover:acquia-pull --env all --backfill
```

This will take 15–45 minutes depending on how many envs and how big
your logs are. It walks every (date × env × type) tuple, requests a
24-hour snapshot from Acquia, polls until ready, downloads from S3,
gunzips, and writes to `<project>/<year>/<month>/<date>.<env>.<type>.log`.

It's idempotent — if you Ctrl-C and re-run, it picks up where it left
off. Coverage is recorded at `.drover/coverage.json`.

## Step 3 — render this month's report

The stakeholder default:

```
/drover:report --month 2026-04 --template root-cause-summary
```

That gives you a Pareto cut on top issues, a share-of-volume bar
chart, per-issue cause diagnosis (high/medium/low confidence), and a
JIRA ticket recommendations section + sidecar JSON. Output lands at
`reports/2026-04-root-cause-summary.md`.

Other templates:

```
# General monthly summary (top-10 trend table, severity rollup)
/drover:report --month 2026-04 --template monthly-client

# Channel-distribution view (best for campaign/window analysis)
/drover:report --month 2026-04 --template calendar-boundary

# Dev-facing detail
/drover:report --month 2026-04 --template triage-brief

# Paste blocks for JIRA's create-issue dialog (fallback when
# /drover:create-tickets isn't appropriate)
/drover:report --month 2026-04 --template jira-ready
```

`--env` defaults to `prod`; pass `--env stage` etc. to render
against a different env.

## Step 4 — (optional) file the recommended JIRA tickets

After a stakeholder template renders, the sidecar
`reports/2026-04-root-cause-summary.md.tickets.json` lists each
recommended ticket with title, description, priority, labels, sprint,
parent linking. Hand it to JIRA via:

```
/drover:create-tickets
```

The skill asks how you want to file:

- **Atlassian MCP** (recommended if you have Atlassian's MCP server
  configured — Claude calls those tools directly)
- **Direct REST** (drover's built-in executor; needs `JIRA_API_TOKEN`)
- **Plan-only** (drover writes a plan; you run the writes yourself)

Always preview first:

```bash
python3 "$PLUGIN/scripts/create_tickets.py" --dry-run
```

Common flags:

```bash
# Create everything, no per-ticket prompts (REST mode)
python3 "$PLUGIN/scripts/create_tickets.py" --all

# Plan-only handoff for MCP / jira-cli / manual
python3 "$PLUGIN/scripts/create_tickets.py" --plan reports/2026-04.plan.json

# Narrow with a regex match on spec title
python3 "$PLUGIN/scripts/create_tickets.py" --filter "simple_cron|cron"

# Link every created issue to a parent (Epic / Feature)
python3 "$PLUGIN/scripts/create_tickets.py" --parent PPS-327
```

## Step 5 — keep the local logs current

Acquia keeps **30 days** of historical log data. If you wait until
day 31 to backfill, you've lost day 1. Pull early, pull often:

```bash
# Roll the local store forward
/drover:acquia-pull --backfill
```

Drover 2.0 is **user-triggered** — no built-in scheduler. The pull
script is small, idempotent, and exit-code-correct, so wrapping it in
cron / launchd / GitHub Actions / your CI of choice is a one-liner if
you want scheduled pulls. Ask and we'll add a template if/when that
becomes useful.

## What's out of scope

- **Live monitoring / dashboard / kanban** — those were the v1
  product. They live in git history at the `drover-1.51.2` tag if
  you need them. v2.0 is batch-mode log analysis only.
- **Auto-fix / triage agents** — also v1.
- **Non-Drupal/Acquia platforms** — Sitecore, .NET, Azure MCP, New
  Relic come in 2.x.
- **Traffic / access logs** — only application-error types
  (apache-error, drupal-watchdog, php-error). Adding traffic types
  is a config one-liner if a client demands it later.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Run \`acli auth:login\`` | One-time Acquia auth setup. |
| `multiple apps tied at top score` | Pass `--app NAME` to `/drover:init` (substring match). |
| `notification ended with status=failed` | Acquia transient; the next `--backfill` will retry. |
| Coverage stuck at 0% | The pull skill exits non-zero on creds failure. Check the cron log. |
| Report missing days | Run `--backfill` to fill gaps; the report's coverage banner shows what's missing. |
| `JIRA credential resolution failed` (create-tickets) | Set `JIRA_API_TOKEN`; ensure `~/.config/.jira/.config.yml` has `server:` + `login:`, OR add `server`/`email` to the manifest's `jira:` block. |
| `manifest.jira.project_key not set` | Hand-edit the manifest to add the `jira:` block (see Step 1.5). |
| `The issue type selected is invalid` | Check available types with `jira project view <KEY>` or via Atlassian's REST `/rest/api/2/project/<KEY>`; update `default_issue_type` in the manifest. |

## Next

Read `README.md` for the architecture and `drover-2.0-plan.md` (in
your Neurons vault) for the design rationale and forward roadmap.
