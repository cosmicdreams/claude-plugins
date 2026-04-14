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

Ask the following questions. Use sensible defaults; bold defaults in brackets.

1. **Project name** — slug used in state file and notifications (e.g. `my-drupal-site`)
2. **Slack User ID** — Slack member ID for DM notifications via `agent-slack` (e.g. `U012AB3CD`). Leave blank to disable Slack notifications. Check your Slack profile to find this.
3. **Quiet mode?** — suppress non-critical Slack DMs? [no]
4. **Quiet hours?** — e.g. `22:00–07:00 America/New_York` [none]

Then for each environment, ask:

5. **DDEV local environment?**
   - DDEV project name (from `ddev list`): run `ddev list --json-output 2>/dev/null` to show options
   - Trust level: [low]
   - Noise filter: [enabled]

6. **Acquia staging environment?** [skip if none]
   - App UUID (from `acli app:list`): run `acli app:list 2>/dev/null` if available
   - Environment slug (e.g. `stg`)

7. **Acquia production environment?** [skip if none]
   - App UUID (same or different from staging)
   - Environment slug (e.g. `prod`)

8. **phpcs quality check?** [yes]
9. **phpstan quality check?** [no]
10. **Run checks via DDEV?** [yes]

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
    "use_global_acli_session": true
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

### DDEV environment schema:
```json
{
  "name": "local",
  "type": "ddev",
  "ddev_project": "<ddev_project_name>",
  "trust_level": "low",
  "promote_threshold": { "min_count": 5, "min_severity": "error" },
  "noise_filter": true,
  "sources": ["watchdog", "php_error_log", "nginx_error_log"]
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
  "sources": ["watchdog", "php_error_log", "apache_error_log"]
}
```

Ask for `ddev_alias` during setup: "What is your Drush remote alias for this environment? (e.g. `@mysite.prod`) — used for short-window watchdog queries. Leave blank if not configured."

## Step 4: Initialize Beads board

```bash
# Check if drover board already exists
bd list -l board-drover --db .beads/drover.db --json --flat 2>/dev/null && echo "EXISTS" || echo "NEW"
```

If `NEW` (db file does not exist or bd errors):
```bash
bd init --prefix drover --db .beads/drover.db
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
```bash
acli auth:check 2>/dev/null && echo "ACQUIA_OK" || echo "ACQUIA_AUTH_NEEDED"
```
If not authenticated: print `Run: acli auth:login` and continue (non-blocking).

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
