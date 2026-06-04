# Step 1 — Setup: Mode, Config, State

## Detect mode

- If invoked with `--loop` (or via `/loop`), mode = **ambient**: delta-only, quiet output, and
  **skip the standing-obligations passes and the availability fetch** (steps 02/03 Pass 2 and step 04).
- Otherwise mode = **on-demand** (default): full picture across all passes.

## Load config

Check for config in order:
1. `.claude/workflow.json` in the current working directory
2. `~/.claude/workflow.json`

```bash
[ -f .claude/workflow.json ] && cat .claude/workflow.json || cat ~/.claude/workflow.json 2>/dev/null
```

If neither exists, run `workflow:config` to set up, then stop.

Parse `integrations.slack.workspaces` and `integrations.jira.servers`. **At least one** of the two
must be configured. If BOTH are empty or missing, output:
```
No Slack workspaces or Jira servers configured in ~/.claude/workflow.json.
Run workflow:config to add at least one source.
```
Then stop. (A Slack-only or Jira-only setup is valid — the missing source is simply skipped.)

Parse `data_path` for state file location (default: `~/.claude`).

## Load state

```bash
cat "${data_path}/workflow-prioritize.state.json" 2>/dev/null
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

`last_run` defines the **overnight/delta window** (what's new since you last checked). Standing
obligations (step 02/03 Pass 2) are independent of this window — they surface regardless of recency.

## Resolve user IDs

For each Slack workspace:
- If `user_id` is already set on the workspace object → use it directly
- If missing → run `agent-slack auth whoami --workspace {workspace_url}`, extract `user_id`,
  write it back to the config file under that workspace, then use it
- If `whoami` fails → set `user_id` to null (mention counts will be 0)

## Load Jira config

Each server in `integrations.jira.servers` has: `name`, `url`, `projects`, optional `config_file`.
If `jira.servers` is empty or missing, Jira is skipped in step 3.

## Compute timestamps

```bash
# Slack --oldest (Unix float)
python3 -c "from datetime import datetime; print(datetime.fromisoformat('{last_run}').timestamp())"
# Jira JQL date (YYYY-MM-DD)
python3 -c "from datetime import datetime; print(datetime.fromisoformat('{last_run}').strftime('%Y-%m-%d'))"
```

## Integration preflight (circuit-breaker)

Run the preflight for each configured integration. The script caches results for 5 minutes — repeat
calls within the window are instant.

```bash
SCRIPT="${CLAUDE_PLUGIN_ROOT}/scripts/check-integration.sh"
slack_ok=true; jira_ok=true

if [[ $(jq '.integrations.slack.workspaces | length' ~/.claude/workflow.json 2>/dev/null) -gt 0 ]]; then
  "$SCRIPT" slack 2>&1 || { echo "Skipping Slack: $(cat)"; slack_ok=false; }
fi
if [[ $(jq '.integrations.jira.servers | length' ~/.claude/workflow.json 2>/dev/null) -gt 0 ]]; then
  "$SCRIPT" jira 2>&1 || { echo "Skipping Jira: $(cat)"; jira_ok=false; }
fi
```

- If `slack_ok=false` — skip `steps/02-fetch-slack.md`; note "Slack unavailable" in the header.
- If `jira_ok=false` — skip `steps/03-fetch-jira.md`; note "Jira unavailable" in the header.
- If **both** unavailable — output "All integrations unavailable — prioritize cannot run." and stop.

Proceed to `steps/02-fetch-slack.md` with: mode, workspaces list, oldest_ts, user_id per workspace,
jira servers list, last_run_date (skipping any source marked unavailable).
