---
name: drover:acquia-pull
description: >
  Fetch Drupal/Acquia application error logs (apache-error, drupal-watchdog,
  php-error) into a project's canonical log folder by date. Talks to the
  Acquia Cloud Platform API directly — no acli, no PHP, pure stdlib Python.
  Idempotent reconcile: re-runs skip files already present and only refetch
  missing or failed days. Produces `<project>/<year>/<month>/<date>.<env>.<type>.log.gz`
  files plus a coverage ledger at `.drover/coverage.json`. Trigger phrases —
  "drover pull logs", "fetch acquia logs", "backfill <project> last 30 days".
allowed-tools: Bash, Read
---

# drover:acquia-pull

## What it does

Reconciles a project's local log folder against the manifest's expected
`(date × env × type)` tuples in two phases:

**Phase 1 — log-create (cheap, fast)**
POST a snapshot request for every missing tuple. Each call returns
immediately with a notification URL (~1s each). Acquia begins building
all snapshots in parallel on their end.

**Phase 2 — poll + download (as files become ready)**
Loop over all pending notifications. The moment any notification
completes, download and store it compressed (.log.gz) immediately —
without waiting for others. After each file lands, report:

```
✓ 2026-04-03 prod drupal-watchdog: 1,290,895 bytes — 12/90 done, 78 pending
```

This separation means a 30-day × 3-type backfill (90 files) runs in
**~5–10 minutes** instead of ~60 minutes — Phase 1 takes ~90s, then
Acquia processes all 90 in parallel while Phase 2 downloads them as
they complete.

## Prerequisites

```bash
test -f .drover/manifest.json || { echo "Run /drover:init first."; exit 1; }
test -f ~/.acquia/cloud_api.conf || { echo "Run /drover:setup first."; exit 1; }
```

## Step 1: Resolve the plugin's pull script

```bash
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/local/drover/*/ 2>/dev/null | tail -1)
PULL_PY="${PLUGIN_ROOT}scripts/pull.py"
test -f "$PULL_PY" || { echo "drover plugin not installed at $PULL_PY"; exit 1; }
```

## Step 2: Pick a date mode and run

`--env` defaults to `prod` — the common case. Pass `--env <name>`
or `--env all` to override.

Exactly one date mode is required.

```bash
# Yesterday only — prod by default
python3 "$PULL_PY" --daily

# Single day
python3 "$PULL_PY" --date 2026-04-03

# Explicit range
python3 "$PULL_PY" --from 2026-04-01 --to 2026-04-30

# Last 30 days, fill any gaps (default backfill window)
python3 "$PULL_PY" --backfill

# Custom backfill window
python3 "$PULL_PY" --backfill --backfill-days 7

# Override env: every env configured in the manifest
python3 "$PULL_PY" --env all --daily

# Override env: stage only
python3 "$PULL_PY" --env stage --backfill

# Preview without making API calls
python3 "$PULL_PY" --backfill --dry-run
```

## Type filtering

The default is "every type listed for that env in the manifest" (typically
the three application-error types). Narrow with `--type` or `--types`:

```bash
python3 "$PULL_PY" --env prod --daily --type drupal-watchdog
python3 "$PULL_PY" --env prod --daily --types apache-error,php-error
```

## Phase 2 deadline

The poll loop runs until all files download or the deadline is hit.
Default is 180s from when Phase 2 starts. Override for unusually large
batches or slow Acquia environments:

```bash
python3 "$PULL_PY" --backfill --poll-deadline-s 300
```

## Step 3: Inspect output

```bash
# Files landed
find . -name "*.log" ! -path './.drover/*' | sort

# Coverage ledger
python3 -m json.tool .drover/coverage.json
```

## Retention awareness

Acquia keeps **30 days** of historical log data. Plan ahead: pull early
and often when retention windows matter. Run `--backfill` to fill any
gaps since the last pull.

## Failure modes

| Failure | Behavior |
|---|---|
| Manifest missing | Aborts: *"Run /drover:init first."* |
| Credentials missing | Aborts: *"Run /drover:setup first."* |
| log-create fails | Marked `fetch-failed` in ledger; Phase 2 continues with remaining files. |
| Notification ends `status=failed` | Marked `fetch-failed`; retryable on next backfill. |
| Download fails | Marked `fetch-failed`; canonical file left untouched. |
| Phase 2 deadline exceeded | Remaining pending files marked `fetch-failed`; run `--backfill` to retry. |

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
      "reason": "notification status=failed",
      "updated_at": "2026-04-27T18:42:11+00:00"
    }
  }
}
```

States: `present` · `fetch-failed` (retryable) · `missing-upstream` (planned)

The `report` skill reads this ledger and surfaces coverage caveats in
its output (e.g. *"Apr 1–2 unavailable; 28/30 days analyzed"*).

## Performance

| Operation | Cost | Notes |
|---|---|---|
| Phase 1 — log-create | ~1s per file | 90 files ≈ 90s |
| Acquia snapshot build | ~30–60s | Runs in parallel for all files |
| Phase 2 — poll + download | ~60s total | All files download as ready |
| **Total (30-day backfill)** | **~5–10 min** | vs ~60 min serial |

Rate limit between log-create calls defaults to 1s. Lower via
`--rate-limit-s 0.5` if needed.
