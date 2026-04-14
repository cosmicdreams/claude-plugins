---
name: run
description: >
  Single entry point for drover error monitoring. Validates environment, launches the
  dashboard UI, runs one triage cycle with proper agent teams (TeamCreate), shows results,
  and offers to start recurring loops. Use when the user wants to start drover, kick off
  error monitoring, or run the full drover pipeline. Trigger phrases: "run drover",
  "start drover", "drover run", "launch drover", "start error monitoring", "let's check
  for errors", "spin up drover", "drover:run". Do NOT use for: viewing the board only
  (drover:board), launching only the dashboard (drover:dashboard), reconfiguring
  (drover:setup), or running a single triage pass (drover:triage).
allowed-tools: Bash, Read, Write, Agent, TeamCreate, TeamDelete, SendMessage
---

# drover:run — Full pipeline launcher

Single command to go from zero to monitoring. Validates, launches UI, triages all
environments with proper agent teams, and shows results.

> **Note (1.8.0+):** Continuous watching is handled by the plugin's umbrella
> monitor (`monitors/monitors.json`), which auto-arms at session start. `drover:run`
> remains the right entry point for first-time setup, dashboard launch, and a
> bootstrap triage cycle. At the end, instead of pitching `/loop 3m drover:watch`
> as the primary follow-up, direct the user to register their project with
> `drover:add-project` so the umbrella picks it up automatically.

## GOTCHAS — Read before every step

- **`acli` runs on the HOST** — never `ddev exec acli` or `ddev acli`
- **Remote drush uses aliases through DDEV** — `ddev drush @ahri.prod`, never `acli remote:drush`
- **`.beads/drover.db` is a directory** — use `[ -d ... ]` not `[ -f ... ]`
- **`bd list --json` requires `--flat`** — always `bd list --json --flat`
- **Config lives at project root** — `$PROJECT_ROOT/.claude/drover-config.json`, not in the worktree
- **DDEV runs from the worktree** — find its approot via `ddev list -A --json-output`, then `cd` there for drush commands
- **Never start/restart DDEV** — if it's not running, tell the user and stop

## Step 1: Locate project root and resolve paths

```bash
# Project root is where .beads/ and .claude/ live
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CONFIG_PATH="${PROJECT_ROOT}/.claude/drover-config.json"
DB_PATH="${PROJECT_ROOT}/.beads/drover.db"
STATE_PATH="$HOME/.claude/drover.state.jsonl"
```

## Step 2: Pre-flight validation

Run all checks before spawning anything. Fail fast with actionable messages.

```bash
# Config exists
[ -f "$CONFIG_PATH" ] || { echo "No drover config. Run /drover:setup first."; exit 1; }

# Enabled
python3 -c "
import json
cfg = json.load(open('$CONFIG_PATH'))
if not cfg.get('enabled', True):
    print('DISABLED')
    exit(1)
print('OK')
"

# Board exists (directory, not file)
[ -d "$DB_PATH" ] || { echo "No drover board. Run /drover:setup first."; exit 1; }
```

## Step 3: DDEV health check

All triage environments need a running DDEV instance — local uses `ddev drush`, Acquia
environments use `ddev drush @alias`. Check once, pass to all agents.

```bash
DDEV_PROJECT=$(python3 -c "
import json
cfg = json.load(open('$CONFIG_PATH'))
for env in cfg.get('environments', []):
    p = env.get('ddev_project', '')
    if p:
        print(p)
        break
")

[ -n "$DDEV_PROJECT" ] || { echo "No ddev_project in config. Run /drover:setup."; exit 1; }

DDEV_APPROOT=$(ddev list -A --json-output 2>/dev/null | python3 -c "
import json, sys
items = json.load(sys.stdin)
if isinstance(items, dict):
    items = items.get('raw', [])
match = next((i for i in items if i.get('name') == '$DDEV_PROJECT'), None)
if not match:
    print('NOT_FOUND')
elif match.get('status') != 'running':
    print('NOT_RUNNING')
else:
    print(match.get('approot', ''))
" 2>/dev/null)

if [ "$DDEV_APPROOT" = "NOT_FOUND" ] || [ "$DDEV_APPROOT" = "NOT_RUNNING" ] || [ -z "$DDEV_APPROOT" ]; then
  echo "DDEV project '$DDEV_PROJECT' is not running."
  echo "Start it first: cd worktrees/main && ddev start"
  exit 1
fi

echo "DDEV healthy: $DDEV_PROJECT @ $DDEV_APPROOT"
```

Verify drush works:

```bash
cd "$DDEV_APPROOT" && ddev drush status --field=bootstrap 2>/dev/null || {
  echo "drush is not responding. Try: cd $DDEV_APPROOT && ddev restart"
  exit 1
}
```

## Step 4: Launch dashboard

Start the dashboard UI in the background. Skip if already running on port 3749.

```bash
PORT=3749
if ! lsof -ti:$PORT > /dev/null 2>&1; then
  PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/local/drover/*/ 2>/dev/null | tail -1)
  SERVER_JS="${PLUGIN_ROOT}tools/dashboard/server.js"
  node "$SERVER_JS" --db "$DB_PATH" --state "$STATE_PATH" --config "$CONFIG_PATH" &
  sleep 1.5
  if lsof -ti:$PORT > /dev/null 2>&1; then
    open "http://localhost:$PORT" 2>/dev/null || true
    echo "Dashboard: http://localhost:$PORT"
  else
    echo "WARNING: Dashboard failed to start. Continuing with triage."
  fi
else
  echo "Dashboard already running at http://localhost:$PORT"
fi
```

## Step 5: Run triage cycle with agent teams

This is the core — create a team, spawn parallel triage agents, collect results.

### Load config and checkpoint

```bash
CONFIG=$(cat "$CONFIG_PATH")
CHECKPOINT=$(tail -1 "$STATE_PATH" 2>/dev/null || echo "{}")
```

Extract environment names:
```python
import json
cfg = json.loads('''CONFIG_JSON''')
for env in cfg.get('environments', []):
    print(env['name'])
```

### Create team

Compute cycle number and create team:

```bash
CYCLE_N=$(( $(wc -l < "$STATE_PATH" 2>/dev/null || echo 0) + 1 ))
```

```
TeamCreate(
  team_name = "drover-run-{CYCLE_N}",
  description = "Drover triage cycle {CYCLE_N}"
)
```

### Spawn triage agents — all in parallel

For each environment, spawn a `drover:triage-agent` into the team. Spawn ALL environments
in a single message with multiple Agent calls:

```
Agent(
  subagent_type = "drover:triage-agent",
  team_name     = "drover-run-{CYCLE_N}",
  name          = "triage-{env_name}",
  prompt        = """
    Your name is triage-{env_name}. You are part of team "drover-run-{CYCLE_N}".

    ENV_NAME: {env_name}
    ENV_CONFIG: {full_env_config_json}
    CHECKPOINT: {per_env_checkpoint_json}
    FULL_CONFIG: {full_drover_config_json}

    DDEV_PROJECT: {DDEV_PROJECT}
    DDEV_APPROOT: {DDEV_APPROOT}
    DDEV_HEALTHY: true

    PROJECT_ROOT: {PROJECT_ROOT}

    Follow the triage-agent protocol. DDEV is verified healthy — use it directly.
    Do NOT run ddev list, ddev start, or ddev restart.

    When complete, send your summary to team-lead:
      SendMessage(to="team-lead", content="{json_summary}")

    Summary must include: new_errors, augmented, promoted, cross_env_boosts,
    notifications, max_wid, and any access-related errors found.
  """
)
```

### Wait for agents, then shut down team

Wait for all triage agents to send their completion messages. After all report:

```
SendMessage(to="triage-{env_name}", content="Triage complete. Shut down.")
TeamDelete(team_name="drover-run-{CYCLE_N}")
```

## Step 6: Verification phase

Check for tickets in `lane-awaiting-review` or `lane-done` and verify whether their
fingerprints reappeared in this triage cycle's results.

Follow the verification procedure from the watch skill:
- Fingerprint absent → increment absent counter → auto-close after 3 cycles
- Fingerprint reappeared → re-open to lane-ready with "fix ineffective" note

## Step 7: Write state checkpoint

Merge all agent summaries into one consolidated state record:

```python
import json, datetime, os

state_path = os.path.expanduser("~/.claude/drover.state.jsonl")

merged_environments = {}
for env_name, summary in all_agent_summaries.items():
    merged_environments[env_name] = {
        "watchdog": {"last_wid": summary["max_wid"]},
    }

new_state = {
    "ts": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "project": config["project"],
    "environments": merged_environments,
    "cycle_summary": {
        "new_errors": sum(s["new_errors"] for s in all_agent_summaries.values()),
        "augmented": sum(s["augmented"] for s in all_agent_summaries.values()),
        "promoted": sum(s["promoted"] for s in all_agent_summaries.values()),
        "cross_env_boosts": sum(s["cross_env_boosts"] for s in all_agent_summaries.values()),
        "notifications_sent": sum(s["notifications"] for s in all_agent_summaries.values()),
    }
}

with open(state_path, "a") as f:
    f.write(json.dumps(new_state) + "\n")

# Trim to last 30 days
cutoff = (datetime.datetime.utcnow() - datetime.timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
with open(state_path) as f:
    lines = [l.strip() for l in f if l.strip()]
kept = [l for l in lines if json.loads(l).get("ts", "") >= cutoff]
with open(state_path, "w") as f:
    f.write("\n".join(kept) + ("\n" if kept else ""))
```

## Step 8: Show results and next steps

Print a summary:

```
━━━ drover:run complete ━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Dashboard:     http://localhost:3749
  Environments:  {env1}, {env2}, ...

TRIAGE
  New errors:    {N}
  Augmented:     {N}
  Promoted:      {N}

VERIFICATION
  Checked:   {N}
  Re-opened: {N}
  Closed:    {N}

To keep monitoring:
  /loop 3m /drover:watch       — recurring triage
  /loop 30m /drover:implement  — autonomous fix pipeline
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If the user asked about a specific error type (e.g. "access issues"), call out
relevant findings from the triage summaries prominently before the generic summary.
