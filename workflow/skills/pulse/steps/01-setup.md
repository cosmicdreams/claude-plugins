# Step 1 — Setup: Load Config and State

## Load config

Check for config in order:
1. `.claude/workflow.json` in the current working directory
2. `~/.claude/workflow.json`

```bash
[ -f .claude/workflow.json ] && cat .claude/workflow.json || cat ~/.claude/workflow.json 2>/dev/null
```

If neither exists, run `workflow:config` to set up, then stop.

Parse:
- `enabled` — if `false`, output "workflow:pulse is disabled." and stop
- `priority_threshold` — `low` / `medium` / `high` / `critical` (default: `medium`)
- `integrations.jira.servers` — list of server objects
- `integrations.slack.workspaces` — list of workspace objects
- `data_path` — for state file location (default: `~/.claude`)

## Load state

```bash
DATA_PATH=$(jq -r '.data_path // "~/.claude"' ~/.claude/workflow.json 2>/dev/null || echo "~/.claude")
tail -1 "${DATA_PATH}/workflow-pulse.state.jsonl" 2>/dev/null
```

Parse as JSON. Fields used:
- `ts` — ISO timestamp of last run
- `jira_snapshots` — object mapping issue key → `{ comments, status, updated }`

If absent or empty: first run — treat as 24h ago.

## Resolve Slack user IDs

For each Slack workspace:
- If `user_id` is set on the workspace object → use it directly
- If missing → run `agent-slack auth whoami --workspace {workspace_url}`, extract `user_id`,
  write it back to the config file, then use it
- If `whoami` fails → set `user_id` to null (mention classification skipped)

## Compute timestamps

```bash
python3 -c "
from datetime import datetime, timedelta
ts = '{state_ts}'
dt = datetime.fromisoformat(ts) if ts else datetime.now() - timedelta(hours=24)
print(dt.timestamp())       # oldest_ts for Slack --oldest
print(dt.strftime('%Y-%m-%d'))  # last_run_date for Jira --updated-after
"
```

Proceed to `steps/02-fetch-jira.md` and `steps/03-fetch-slack.md` (spawn in parallel).
