---
name: drover:backfill
description: Pull historical Acquia logs for a registered environment and feed them through drover's fingerprint pipeline, updating the same state file live monitoring uses. Use after a monitor outage, for post-mortem analysis of a recent incident, or to seed state for a newly-registered environment. Idempotent. Trigger phrases - "backfill drover logs", "pull past logs for X", "drover missed some time, catch up", "rebuild drover state from history".
---

# drover:backfill

## What it does

Downloads historical Acquia logs via `acli` and pipes them through
the same fingerprinting and state-update pipeline that live monitoring
uses. Running this twice on the same window is a no-op: fingerprint
counts increment but `NEW` emissions do not repeat.

## Procedure

### 1. Pick an environment

Ask the user which environment (alias form `<site>.<env>`, e.g.
`pncb.prod`) or offer the list from `${CLAUDE_PLUGIN_DATA}/projects.json`:

```bash
python3 -c '
import json, os
f = os.environ.get("DROVER_PROJECTS_FILE") or (os.environ.get("CLAUDE_PLUGIN_DATA","") + "/projects.json")
for p in json.load(open(f)):
    for e in (p.get("acquia") or {}).get("environments", []):
        if e.get("alias"):
            print(f"- {e[\"alias\"]}")
'
```

### 2. Run the backfill script

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/backfill.sh" "<alias>"
```

Default log types: `php-error,apache-error`. To include watchdog:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/backfill.sh" "<alias>" "php-error,apache-error,drupal-watchdog"
```

### 3. Report the outcome

The script ends with a `BACKFILL done env=<alias> events=<n>` summary.
Count `NEW` lines emitted; those are fingerprints that were absent
from live state and are now seeded.

If the user wanted a baseline report rather than just seeding, run
`acquia-baseline.sh` instead — it calls `backfill.sh` internally and
additionally computes hourly rates for velocity classification.

## Notes

- **No-op on duplicate runs**: state is a fingerprint dictionary; re-running
  the same window simply increments counts without re-emitting `NEW`.
- **Requires**: local `acli` authenticated (`acli auth:login` run once);
  cached UUIDs in `projects.json` are not strictly required for
  `acli app:log:tail`/`log-download` but speed up any other API call.
- **State location**: `${CLAUDE_PLUGIN_DATA}/acquia-state/<alias>.json`
  — shared with live `acquia-watch.py`.
