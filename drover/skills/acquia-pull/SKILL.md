---
name: drover:acquia-pull
description: >
  Fetch Drupal/Acquia application error logs (apache-error, drupal-watchdog,
  php-error) into a project's canonical log folder by date. Talks to the
  Acquia Cloud Platform API directly — no acli, no PHP, pure stdlib Python.
  Produces `<project>/<year>/<month>/<date>.<env>.<type>.log` files plus a
  coverage ledger at `.drover/coverage.json`. Trigger phrases — "drover pull
  logs", "fetch acquia logs", "pull <project> logs for <date>".
allowed-tools: Bash, Read
---

# drover:acquia-pull

## What it does

Reconciles a project's local log folder against the manifest's expected
`(date × env × type)` tuples. Idempotent: re-runs skip files already present.

For each missing tuple it runs the documented Acquia Cloud Platform 3-step
historical download flow:

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

## Step 2: Run the pull

Single day (slice 2 — current scope):

```bash
python3 "$PULL_PY" --env prod --date 2026-04-03
```

Targeted single-type for debugging:

```bash
python3 "$PULL_PY" --env prod --date 2026-04-03 --type drupal-watchdog
```

Explicit project root (when running outside the project directory):

```bash
python3 "$PULL_PY" --project /path/to/project --env prod --date 2026-04-03
```

## Step 3: Inspect output

```bash
ls -la "$(date -j -f %Y-%m-%d 2026-04-03 +%Y)/$(date -j -f %Y-%m-%d 2026-04-03 +%m)/" \
  2>/dev/null || ls -la 2026/04/
cat .drover/coverage.json | python3 -m json.tool
```

## Failure modes

- **Manifest missing** — abort with: *"Run /drover:init first."*
- **Acquia auth invalid / expired** — exits non-zero, marks `fetch-failed`
  in the coverage ledger with the API error slug.
- **Notification ends with status=failed** — marks `fetch-failed` for that
  one (date, type), continues with the rest.
- **Outside 30-day retention** — Acquia returns no data; the resulting
  file may be empty or the call may error. Future versions will detect
  this and mark `missing-upstream` cleanly.

## Coverage ledger

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
    }
  }
}
```

States: `present`, `fetch-failed`, `missing-upstream` (slice 3+), `pending`.

## What's coming in slice 3

`--from/--to`, `--backfill`, `--daily`, `--env all`, `--types`, `--dry-run`,
polite rate-limiting, and a cron template for daily pulls.
