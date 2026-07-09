---
name: ideas-funnel:schedule
description: >
  Idempotently registers the singleton daily Fable-supervised pipeline cron for
  the ideas-funnel plugin. Checks for an existing cron before creating one.
  Records the cron id in the vault at _meta/ideas-funnel-scheduler.json so a
  second Claude instance can detect and decline to create a duplicate. Trigger
  phrases: "schedule the funnel", "register the funnel cron",
  "/ideas-funnel:schedule", "set up funnel pipeline".
  Do NOT use when you only want to run the pipeline manually — invoke the
  Workflow script directly for that.
triggers:
  - /ideas-funnel:schedule
  - schedule the funnel
  - register the funnel cron
  - set up funnel pipeline
allowed-tools:
  - Bash
  - Read
  - Write
  - CronList
  - CronCreate
  - CronDelete
  - Workflow
---

**Used by:** `ideas-funnel:init` (called automatically on first run) + human for manual re-registration.

# ideas-funnel:schedule

Ensures exactly one ideas-funnel pipeline cron exists across all Claude instances.

## Step 1 — Read the vault marker

```bash
VAULT="${OBSIDIAN_VAULT:-$HOME/Vaults/Neurons}"
CONFIG="$HOME/.config/ideas-funnel/domains"
MARKER="$VAULT/_meta/ideas-funnel-scheduler.json"
```

If `$MARKER` exists, read it. If the `cron_id` field is non-empty, call `CronList`
and check whether that id is still present. If it is, report the existing schedule
and stop — do not create another cron.

If `CronList` shows the id is gone (was manually deleted), remove the stale marker
and continue to Step 2.

## Step 2 — Create the cron

```
CronCreate(
  schedule: "0 2 * * *",
  description: "ideas-funnel daily Fable-supervised pipeline",
  prompt: "Run the ideas-funnel pipeline. Invoke Workflow with scriptPath '${CLAUDE_PLUGIN_ROOT}/skills/schedule/scripts/funnel-pipeline.js' and args { date: '<today YYYY-MM-DD>', vault: '$VAULT', config: '$CONFIG' }."
)
```

Use `0 2 * * *` (2 AM local) unless the user specifies a different time.

## Step 3 — Write the vault marker

```json
{
  "cron_id": "<id returned by CronCreate>",
  "owner_session": "<current session identifier if available, else null>",
  "created_at": "YYYY-MM-DD"
}
```

Write to `$VAULT/_meta/ideas-funnel-scheduler.json`.

## De-registration

To cancel the pipeline:

1. `CronDelete <cron_id>` (read the id from the vault marker first).
2. Remove `$VAULT/_meta/ideas-funnel-scheduler.json`.

Any Claude instance that reads the marker after deletion will see no active cron
and will offer to re-register.

## Pipeline shape

The scheduled Workflow runs:

1. `supervise` — Fable reads health/backlog/recent notes and emits a bounded plan.
2. `ingest` — worker agents process only the selected domains/items.
3. `refinery` — single writer promotes concepts/bridges/conflicts.
4. `lint` — structural health and stale raw detection.
5. `decay` — valid memory state transitions.
6. `rescue` — stale raw, orphan, and at-risk recovery recommendations.
7. `stats` — writes `_meta/stats.md` for the next Fable run.

The cron should not try to clear the full backlog in one run. Backpressure is
part of the design.
