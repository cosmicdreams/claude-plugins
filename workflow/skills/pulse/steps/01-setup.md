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

## Integration preflight (circuit-breaker)

Before spawning fetch subagents, run the preflight for each configured integration.
The script caches results for 5 minutes — repeat calls within TTL are instant.

```bash
SCRIPT="${CLAUDE_PLUGIN_ROOT}/scripts/check-integration.sh"

jira_ok=true
slack_ok=true

# Only check if servers are configured
if [[ $(jq '.integrations.jira.servers | length' ~/.claude/workflow.json 2>/dev/null) -gt 0 ]]; then
  "$SCRIPT" jira 2>&1 || { echo "Skipping Jira: $(cat)"; jira_ok=false; }
fi

if [[ $(jq '.integrations.slack.workspaces | length' ~/.claude/workflow.json 2>/dev/null) -gt 0 ]]; then
  "$SCRIPT" slack 2>&1 || { echo "Skipping Slack: $(cat)"; slack_ok=false; }
fi
```

- If `jira_ok=false` — skip `steps/02-fetch-jira.md` entirely; note "Jira unavailable" in output.
- If `slack_ok=false` — skip `steps/03-fetch-slack.md` entirely; note "Slack unavailable" in output.
- If **both** unavailable — output "All integrations unavailable — pulse cannot run." and stop.

Proceed to `steps/02-fetch-jira.md` and `steps/03-fetch-slack.md` (spawn in parallel, skipping any marked unavailable).
