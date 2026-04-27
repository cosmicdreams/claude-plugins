---
name: drover:acquia-pull
description: >
  Fetch Drupal/Acquia application error logs (apache-error, drupal-watchdog,
  php-error) into a project's canonical log folder by date. Talks to the
  Acquia Cloud Platform API directly — no acli, no PHP, pure stdlib Python.
  Idempotent reconcile: re-runs skip files already present and only refetch
  missing or failed days. Produces `<project>/<year>/<month>/<date>.<env>.<type>.log`
  files plus a coverage ledger at `.drover/coverage.json`. Trigger phrases —
  "drover pull logs", "fetch acquia logs", "backfill <project> last 30 days".
allowed-tools: Bash, Read
---

# drover:acquia-pull

## What it does

Reconciles a project's local log folder against the manifest's expected
`(date × env × type)` tuples. For each missing tuple it runs the documented
Acquia Cloud Platform 3-step historical download flow:

1. POST `/environments/{envId}/logs/{type}` body `{from, to}` → notification
2. Poll the notification until `status: completed`
3. GET `/environments/{envId}/logs/{type}` → 301 → presigned S3 URL → bytes

Then it gunzips and atomically renames into the canonical local path, and
records the result in the coverage ledger.

## Prerequisites

```bash
test -f .drover/manifest.json || { echo "Run /drover:init first."; exit 1; }
test -f ~/.acquia/cloud_api.conf || { echo "Run \`acli auth:login\` first."; exit 1; }
```

## Step 1: Resolve the plugin's pull script

```bash
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/local/drover/*/ 2>/dev/null | tail -1)
PULL_PY="${PLUGIN_ROOT}scripts/pull.py"
test -f "$PULL_PY" || { echo "drover plugin not installed at $PULL_PY"; exit 1; }
```

## Step 2: Pick a date mode and run

Exactly one date mode is required.

```bash
# Yesterday only (cron-friendly default)
python3 "$PULL_PY" --env prod --daily

# Single day
python3 "$PULL_PY" --env prod --date 2026-04-03

# Explicit range
python3 "$PULL_PY" --env prod --from 2026-04-01 --to 2026-04-30

# Last 30 days, fill any gaps (default backfill window)
python3 "$PULL_PY" --env prod --backfill

# Custom backfill window
python3 "$PULL_PY" --env prod --backfill --backfill-days 7

# All envs configured in the manifest
python3 "$PULL_PY" --env all --daily

# Preview without making API calls
python3 "$PULL_PY" --env prod --backfill --dry-run
```

## Type filtering

The default is "every type listed for that env in the manifest" (typically
the three application-error types). Narrow with `--type` or `--types`:

```bash
python3 "$PULL_PY" --env prod --daily --type drupal-watchdog
python3 "$PULL_PY" --env prod --daily --types apache-error,php-error
```

## Step 3: Inspect output

```bash
# Files landed
find . -path ./.drover -prune -o -name "*.log" -print | sort

# Coverage ledger
cat .drover/coverage.json | python3 -m json.tool
```

## Daily cron — recommended for monthly reports

Acquia keeps **30 days** of historical log data. A monthly report
assembled retroactively after day 30 will be missing the first days of
the month. Run the daily pull on a cron so the local folder always has
the last 30 days available.

A template lives at `templates/scheduling/daily-pull.crontab.example`.
Edit the project root and the manifest's env list, then `crontab -e`
to install:

```cron
# m   h    dom mon dow  command
30   2    *   *   *    /path/to/drover-daily-pull.sh >> /path/to/drover.log 2>&1
```

The 02:30 UTC window is well after Acquia's midnight rotation, with
buffer for snapshot-creation latency.

## Failure modes

| Failure | Behavior |
|---|---|
| Manifest missing | Aborts: *"Run /drover:init first."* |
| `acli` not authed | Aborts; the `AcquiaClient` constructor surfaces it. |
| Network/API blip mid-fetch | Retries (default 1 attempt). On final failure, marks `state=fetch-failed` in the ledger; continues to next tuple. |
| Notification ends `status=failed` | Marks `state=fetch-failed`; reason captured in ledger. |
| Outside 30-day retention | Returned slice may be empty. Future versions will detect and mark `missing-upstream` cleanly. |

A `fetch-failed` ledger entry is intentionally retryable — a later run
of `--backfill` will pick it up and try again.

## Coverage ledger format

`.drover/coverage.json` records every fetched (date × env × type):

```json
{
  "2026-04-03": {
    "prod.drupal-watchdog": {
      "state": "present",
      "bytes": 1290895,
      "gz_bytes": 126532,
      "notification_uuid": "6561dbee-...",
      "updated_at": "2026-04-27T18:39:09+00:00"
    },
    "prod.php-error": {
      "state": "fetch-failed",
      "reason": "acquia-api 503 ",
      "updated_at": "2026-04-27T18:42:11+00:00"
    }
  }
}
```

States:

- `present` — file on disk, complete, ready to parse
- `fetch-failed` — recoverable; will be retried on next backfill run
- `missing-upstream` — Acquia returned no data for this window (e.g.
  outside retention) — future state, planned for slice 5+
- `pending` — backfill not yet attempted (future state)

The `report` skill reads this ledger and surfaces coverage caveats in
its output (e.g. *"Apr 1–2 unavailable; 28/30 days analyzed"*).

## Performance & politeness

Each (day, type) round-trip takes ~40–60 seconds (snapshot creation +
poll + S3 download). A 30-day backfill of 3 types × 1 env runs ~30–45
minutes serially. The pull skill sleeps 1 second between API
round-trips by default; tune via `--rate-limit-s` if needed (don't go
below 0.5).

## Verified

- Slice 2: single-day E2E against PNCB prod (Apr 3, 1.29 MB, 5,691 lines)
- Slice 3: 3-day backfill E2E against PNCB prod (Apr 4–6, 3 fetches in 3m12s)
