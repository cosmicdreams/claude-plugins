# Step 1 — Setup: Load Config and State

## Load config

Check for config in order:
1. `.claude/workflow.json` in the current working directory
2. `~/.claude/workflow.json`

```bash
[ -f .claude/workflow.json ] && cat .claude/workflow.json || cat ~/.claude/workflow.json 2>/dev/null
```

If neither exists, run `workflow:config` to set up, then stop.

Parse `integrations.slack.workspaces`. If empty or missing, output:
```
No slack.workspaces configured in ~/.claude/workflow.json.
Run workflow:config to add at least one workspace with channels.
```
Then stop.

Parse `data_path` for state file location (default: `~/.claude`).

## Load state

```bash
cat "${data_path}/workflow-morning-brief.state.json" 2>/dev/null
```

Parse `last_run` ISO timestamp. If absent, default to 10pm of the previous calendar day:

```bash
python3 -c "
from datetime import datetime, timedelta
now = datetime.now()
prev_10pm = now.replace(hour=22, minute=0, second=0, microsecond=0) - timedelta(days=1)
print(prev_10pm.isoformat())
"
```

## Resolve user IDs

For each workspace:
- If `user_id` is already set on the workspace object → use it directly
- If missing → run `agent-slack auth whoami --workspace {workspace_url}`, extract `user_id`,
  write it back to the config file under that workspace, then use it
- If `whoami` fails → set `user_id` to null (mention counts will be 0)

## Load Jira config

Parse `integrations.jira.servers` from the same config file. Each server has:
- `name`: display name
- `url`: Jira base URL
- `projects`: array of project keys
- `config_file` (optional): path to jira-cli config if non-default

If `jira.servers` is empty or missing, Jira will be skipped in step 3.

## Compute timestamps

Convert `last_run` ISO to a Unix float for Slack `--oldest`:

```bash
python3 -c "from datetime import datetime; print(datetime.fromisoformat('{last_run}').timestamp())"
```

Compute `last_run_date` for Jira JQL (YYYY-MM-DD format):

```bash
python3 -c "from datetime import datetime; print(datetime.fromisoformat('{last_run}').strftime('%Y-%m-%d'))"
```

## Integration preflight (circuit-breaker)

Before spawning fetch subagents, run the preflight for each configured integration.
The script caches results for 5 minutes — repeat calls within TTL are instant.

```bash
SCRIPT="${CLAUDE_PLUGIN_ROOT}/scripts/check-integration.sh"

slack_ok=true
jira_ok=true

"$SCRIPT" slack 2>&1 || { echo "Skipping Slack: $(cat)"; slack_ok=false; }

if [[ $(jq '.integrations.jira.servers | length' ~/.claude/workflow.json 2>/dev/null) -gt 0 ]]; then
  "$SCRIPT" jira 2>&1 || { echo "Skipping Jira: $(cat)"; jira_ok=false; }
fi
```

- If `slack_ok=false` — skip `steps/02-fetch-slack.md`; note "Slack unavailable" in the brief header.
- If `jira_ok=false` — skip `steps/03-fetch-jira.md`; note "Jira unavailable" in the brief header.
- If **both** unavailable — output "All integrations unavailable — morning-brief cannot run." and stop.

Proceed to `steps/02-fetch-slack.md` with: workspaces list, oldest_ts, user_id per workspace,
jira servers list, last_run_date (skipping any marked unavailable).
