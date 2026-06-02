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

## The one-per-24h constraint (read this first)

**Acquia keeps exactly one packaged log file per `(env, type)` at a time.**
The download endpoint (`GET /environments/{env}/logs/{type}`) is keyed only
by env + type and always 301-redirects to **the most recently created
snapshot** — there is no snapshot id in the download path. Every new
log-create for the same `(env, type)` *supersedes* the previous packaged
file.

Therefore you **must download each day's snapshot before requesting the next
for the same `(env, type)`**. A naïve batch (fire all creates, then download
all) returns the *same* last-created snapshot for every day — duplicate,
mislabeled files. (This actually happened: a single `--from/--to` run for
Massport May 1–19 returned 12 files all identical to the May 19 snapshot.)

`pull.py` enforces this: multi-day pulls run **serial per `(env, type)`**.
Distinct `(env, type)` keys map to distinct packaged files, so they run in
parallel — `--concurrency` is the number of parallel `(env, type)` *groups*,
never parallel days within a group.

## What it does

Reconciles a project's local log folder against the manifest's expected
`(date × env × type)` tuples:

1. **Group** missing tuples by `(env, type)`.
2. For each group, **serially** per day: log-create → poll → download →
   **verify**. Only after a day's file is downloaded and verified does the
   next day's create fire.
3. Run up to `--concurrency` groups in parallel.

After each file lands, report:

```
✓ 2026-04-03 prod drupal-watchdog: 1,290,895 bytes — 12/90 done, 78 pending
```

## Post-download verification (mandatory, fail loud)

Every downloaded file is verified before it's recorded `present`:

- **Dominant-date check** — the most common `(month, day)` across the file's
  lines must equal the requested day. Do **not** trust `head -1`:
  UTC-midnight boundary lines spill across days, so the *dominant* date is
  used, not the first line. Works across all four formats
  (`dd/Mon` access, `Mon dd` apache-error/watchdog, `dd-Mon` php-error).
- **Distinct-md5 check** — a file byte-identical to another day already
  pulled in the same group is the stale-snapshot bug; it's rejected.

On mismatch or duplicate the file is deleted, the day is marked
`fetch-failed` with reason `snapshot-mismatch`, and it's retried once. A
mislabeled file **never** reaches `present`.

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

## Poll deadline

Each day's notification is polled until it completes or the deadline is hit.
Default is 180s per day. Override for slow Acquia environments:

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
| log-create fails | Marked `fetch-failed`; other `(env,type)` groups unaffected. |
| Notification ends `status=failed` | Retried once, then marked `fetch-failed`. |
| Download fails | Marked `fetch-failed`; canonical file left untouched. |
| Poll deadline exceeded | Day marked `fetch-failed`; run `--backfill` to retry. |
| Snapshot mismatch / duplicate | File deleted, marked `fetch-failed` (`snapshot-mismatch`); retried once. Never recorded `present`. |

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

Each day within a `(env, type)` group costs one full create → build →
download cycle (~30–90s), because the one-per-24h constraint forbids
batching creates ahead of downloads. Parallelism comes from running
`(env, type)` groups concurrently:

| Shape | Parallelism | Notes |
|---|---|---|
| 1 type × N days | serial (1 group) | N × ~30–90s |
| 3 types × N days | up to 3 groups in parallel | ≈ N × ~30–90s wall (types overlap) |
| `--concurrency` | caps parallel groups | default 4 |

A 30-day single-type pull is inherently serial (~15–45 min) — this is the
cost of correctness under the API's one-snapshot-per-`(env,type)` limit.

Rate limit between log-create calls defaults to 1s. Lower via
`--rate-limit-s 0.5` if needed.
