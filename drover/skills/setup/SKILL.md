---
name: setup
description: >
  First-time configuration for drover in a Drupal project. Creates .claude/drover-config.json
  from an interactive interview, initializes the Beads drover board, and validates the
  environment (DDEV or Acquia CLI) is accessible. Run once per project before starting
  drover:watch or drover:implement loops.
triggers:
  - "drover:setup"
  - "set up drover"
  - "configure drover"
  - "initialize drover"
allowed-tools: Bash, Read, Write, Agent
---

# drover:setup — First-time project configuration

Configures drover for a Drupal project and initializes the Beads board.

## Step 1: Check for existing config

```bash
[ -f .claude/drover-config.json ] && cat .claude/drover-config.json || echo "NOT_FOUND"
```

If found: display current config and ask the user if they want to reconfigure or just
reinitialize the board. If reinit only: skip to Step 4.

## Step 1.5: Check for existing config and migrate if needed

If `.claude/drover-config.json` exists, check for a legacy `notify` block:

```bash
python3 -c "
import json, os, sys
cfg_path = '.claude/drover-config.json'
global_path = os.path.expanduser('~/.claude/drover-global-config.json')
if not os.path.exists(cfg_path):
    print('NEW')
    sys.exit(0)
cfg = json.load(open(cfg_path))
if 'notify' not in cfg:
    print('OK')
    sys.exit(0)
# Migration needed
notify = cfg.pop('notify', {})
# Merge into global config (project value overwrites global)
global_cfg = {}
if os.path.exists(global_path):
    global_cfg = json.load(open(global_path))
if 'slack_user_id' in notify and notify['slack_user_id']:
    old_id = global_cfg.get('notify', {}).get('slack_user_id', '')
    if old_id and old_id != notify['slack_user_id']:
        print(f'INFO: Overwriting existing global Slack User ID ({old_id}) with value from project ({notify[\"slack_user_id\"]})', file=sys.stderr)
global_cfg.setdefault('notify', {}).update({k: v for k, v in notify.items() if v})
os.makedirs(os.path.dirname(global_path), exist_ok=True)
json.dump(global_cfg, open(global_path, 'w'), indent=2)
json.dump(cfg, open(cfg_path, 'w'), indent=2)
print(f'MIGRATED: notify config moved to {global_path}')
"
```

Print the migration result to the user.

## Step 2: Interview the user

Keep the interview short. Ask only the five primary questions below; use
the sensible defaults shown in brackets for everything else. Only ask a
follow-up question if the user's answer to the primary question makes
the follow-up relevant.

1. **Project name** — slug used in state and notifications (e.g. `my-drupal-site`).
2. **DDEV project?** — first run `ddev list --json-output 2>/dev/null` to show running projects; the user picks one. Defaults: trust=`low`, noise filter on.
3. **Any Acquia environments to watch?** [no] — if yes:

   **First, probe for an existing authenticated session** (user may already
   be signed in via `acli auth:login` or have a `~/.acquia/cloud_api.conf`
   from a previous setup):

   ```bash
   python3 - <<'PY'
   import sys, os
   sys.path.insert(0, os.path.expanduser("${CLAUDE_PLUGIN_ROOT}/scripts/monitors"))
   from acquia_api import AcquiaClient
   try:
       print("OK" if AcquiaClient().verify_credentials() else "NEEDS_CREDS")
   except FileNotFoundError:
       print("NEEDS_CREDS")
   except Exception:
       print("NEEDS_CREDS")
   PY
   ```

   - If `OK` → **skip the key/secret prompt entirely**. Print
     `Acquia: using existing session` and proceed straight to listing
     applications via the API, let the user pick their app, then for each
     env ask only `env slug` (e.g. `test`, `prod`) and optional `drush
     alias` (e.g. `@mysite.prod`).
   - If `NEEDS_CREDS` → prompt:
     `Acquia API key (from https://cloud.acquia.com/a/profile/tokens) — or type 'skip' to register DDEV-only and add Acquia later:`
     If the user types `skip` (or blank), treat the Acquia answer as `no`
     and continue with DDEV-only setup. Otherwise collect key + secret,
     store in `~/.acquia/cloud_api.conf` via `acquia_api.write_credentials()`,
     then proceed with the app picker + env loop above.
4. **Slack User ID?** [blank = skip] — only if the user provides one, ask the single follow-up: `Quiet hours? (e.g. 22:00-07:00 TZ) [none]`. Quiet mode defaults to `off`.
5. **Run quality checks?** [phpcs: yes, phpstan: no, via DDEV: yes] — one composite question; only break it apart if the user says "custom".

## Step 3: Write config files

### Global config (`~/.claude/drover-global-config.json`)

Write Slack and quiet preferences to the global config (one per user, not per project):

```json
{
  "notify": {
    "slack_user_id": "<slack_user_id or empty string>",
    "quiet_mode": <true|false>,
    "quiet_hours": {
      "enabled": <true|false>,
      "start": "<HH:MM or null>",
      "end": "<HH:MM or null>",
      "timezone": "<tz or null>"
    }
  },
  "acquia": {
    "credentials_path": "~/.acquia/cloud_api.conf"
  }
}
```

### Project config (`.claude/drover-config.json`)

Create `.claude/` if it doesn't exist. The project config contains NO `notify` block:

```json
{
  "enabled": true,
  "project": "<project_slug>",
  "triage": {
    "interval_minutes": 3,
    "accumulate_only_severities": ["notice", "info", "debug"],
    "immediate_promote_severities": ["emergency", "critical", "alert"]
  },
  "verification": { "clear_after_cycles": 3 },
  "environments": [
    <environments based on interview answers — see schema below>
  ],
  "git": {
    "project_root": ".",
    "worktree_prefix": "drover"
  },
  "quality_checks": {
    "phpcs": <true|false>,
    "phpstan": <true|false>,
    "use_ddev": <true|false>
  }
}
```

Note: `notify` block is intentionally absent from the project config. All notification preferences live in `~/.claude/drover-global-config.json`.
```

### Default tracking policy

**Local envs are tracked by default. Remote envs are paused by default.** The
user opts remote streaming in per-env from the Projects panel (click an env
chip to resume) or via the Sources modal. Spinning up a new drover instance
should never start tailing production before the user explicitly says so.

- **DDEV / local env** → `"sources": ["drupal-watchdog"]` (or `["wp-debug"]`
  for WordPress). Tracked on first launch.
- **Acquia / remote env** → `"sources": []`. Paused on first launch. User
  must explicitly enable each remote env.

### DDEV environment schema:
```json
{
  "name": "local",
  "type": "ddev",
  "ddev_project": "<ddev_project_name>",
  "trust_level": "low",
  "promote_threshold": { "min_count": 5, "min_severity": "error" },
  "noise_filter": true,
  "sources": ["drupal-watchdog"]
}
```

### Acquia environment schema:
```json
{
  "name": "<staging|production>",
  "type": "acquia",
  "app_uuid": "<uuid>",
  "env_slug": "<stg|prod>",
  "ddev_alias": "@<site>.<env>",
  "trust_level": "<medium|high>",
  "promote_threshold": {
    "min_count": <2 for staging, 1 for production>,
    "min_severity": "error"
  },
  "immediate_promote_severities": ["emergency", "critical", "alert"],
  "noise_filter": false,
  "sources": []
}
```

Ask for `ddev_alias` during setup: "What is your Drush remote alias for this environment? (e.g. `@mysite.prod`) — used for short-window watchdog queries. Leave blank if not configured."

## Step 4: Initialize Beads board

```bash
# Check if drover board already exists
bd list -l board-drover --db .beads/drover.db --json --flat 2>/dev/null && echo "EXISTS" || echo "NEW"
```

If `NEW` (db file does not exist or bd errors):

Run `bd init` with two protections so the demo never hangs:

1. **Hook bypass** — `bd init` runs an internal `git commit` whose
   `.beads/hooks/pre-commit` calls `bd export` against the dolt DB
   that `bd init` itself still holds open. On macOS (no GNU `timeout`
   binary on `$PATH`), the hook's timeout safety net silently no-ops
   and the commit waits forever on `.beads/embeddeddolt/.lock`.
   We neutralise `core.hooksPath` for the child process so the hook
   is not found. User-level hooks (e.g. global commit-msg at
   `~/.git-hooks`) are unaffected after `bd init` returns.
2. **Wall-clock safety net** — wrap the invocation in a `perl alarm`
   so that if anything else hangs the user sees a clear failure
   instead of a frozen terminal.

```bash
mkdir -p .beads
GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0=core.hooksPath \
GIT_CONFIG_VALUE_0=/dev/null \
perl -e 'alarm shift @ARGV; exec @ARGV' 30 \
  bd init --prefix drover --db .beads/drover.db
rc=$?
if [ $rc -eq 142 ] || [ $rc -eq 14 ]; then
  echo "ERROR: bd init timed out after 30s. Check .beads/embeddeddolt/.lock and kill any hung bd/dolt processes, then re-run /drover:setup." >&2
  exit 1
elif [ $rc -ne 0 ]; then
  echo "ERROR: bd init failed (exit $rc)." >&2
  exit $rc
fi
echo "Board initialized"
```

If `EXISTS`: skip init (second `bd init` on the same db errors intentionally).

Verify the board is accessible:
```bash
bd list -l board-drover --db .beads/drover.db --json --flat 2>/dev/null || echo "BOARD_ERROR"
```

## Step 5: Validate environment access

For each configured environment, run a quick connectivity check:

**DDEV:**
```bash
ddev describe <ddev_project_name> 2>/dev/null | head -5 || echo "DDEV_UNREACHABLE"
```
If DDEV is not running: warn the user — drover watch won't work until DDEV is started.

**Acquia:**
```python
import sys; sys.path.insert(0, "${CLAUDE_PLUGIN_ROOT}/scripts/monitors")
from acquia_api import AcquiaClient
try:
    ok = AcquiaClient().verify_credentials()
    print("ACQUIA_OK" if ok else "ACQUIA_AUTH_NEEDED")
except FileNotFoundError:
    print("ACQUIA_AUTH_NEEDED")
```
If not authenticated: print `Run /drover:setup again to enter your API key and secret` and continue (non-blocking).

## Step 6: Output summary

```
drover setup complete ✓

Project: <project_slug>
Config:  .claude/drover-config.json
Board:   .beads/drover.db (empty)

Environments:
  local (DDEV: <ddev_name>) — trust:low — noise filter ON
  staging (Acquia: <env>)   — trust:medium
  production (Acquia: <env>) — trust:high

Notifications: <email>  [quiet mode: on|off]

Next steps:
  /drover:add-project         — register this project so the umbrella monitor
                                (auto-armed by the plugin) starts watching it
  /drover:baseline            — compute 24h velocity baselines for Acquia envs
  /drover:board               — view open errors
  /drover:dashboard           — launch the ops dashboard UI
  (legacy) /loop 30m /drover:implement — autonomous fix pipeline; moves to
                                a monitor in a future release
```

> **Note (1.8.0+):** Continuous error-watching no longer requires `/loop 3m
> /drover:watch`. The plugin ships an umbrella monitor that auto-arms at
> session start and picks up any project registered via `drover:add-project`.

## Error handling

- If `.beads/` directory does not exist at `$PWD`: warn and create it: `mkdir -p .beads`
- If `bd` is not installed: `brew install beads` instruction and stop
- If config write fails: print the JSON to stdout so the user can save manually
