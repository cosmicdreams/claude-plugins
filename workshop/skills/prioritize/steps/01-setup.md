# Step 1 — Setup: Mode, Config, State

## Detect mode

- If invoked with `--loop` (or via `/loop`), mode = **ambient**: delta-only, quiet output, and **skip the standing-obligations passes and the availability fetch** (steps 02/03 Pass 2 and step 04).
- Otherwise mode = **on-demand** (default): full picture across all passes.

## Load config

Check for config in order:
1. `.claude/workshop.json` in the current working directory
2. `~/.claude/workshop.json`

```bash
[ -f .claude/workshop.json ] && cat .claude/workshop.json || cat ~/.claude/workshop.json 2>/dev/null
```

If neither exists, run `workshop:config` to set up, then stop.

Parse `integrations.slack.workspaces` and `integrations.jira.servers`. **At least one** of the two must be configured. If BOTH are empty or missing, output:
```
No Slack workspaces or Jira servers configured in ~/.claude/workshop.json.
Run workshop:config to add at least one source.
```
Then stop. (A Slack-only or Jira-only setup is valid — the missing source is simply skipped.)

Use the selected config's `integrations.slack.workspaces[].channels` as the shared channel list; no private prioritize channel list. Missing channels are a coverage gap, not an all-clear.

Parse `data_path` for state file location (default: `~/.claude`).

## Load state

```bash
cat "${data_path}/workshop-prioritize.state.json" 2>/dev/null
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

`last_run` defines the **overnight/delta window** (what's new since you last checked). Standing obligations (step 02/03 Pass 2) are independent of this window — they surface regardless of recency.

## Resolve the Slack workspace and user ID

Slack is read through the host's Slack connector (see `${CLAUDE_PLUGIN_ROOT}/references/connectors.md`), which is signed in to one workspace.

- Find which configured workspace that is by looking up one configured channel name from each workspace with `slack_search_channels` (include `private_channel` in `channel_types`). The workspace whose channel is found is the connected one. Every other configured workspace is a coverage gap: name it in `errors` and report `coverage.slack` as `partial`.
- Use the `user_id` already set on that workspace object. If it is missing, take the signed-in user's ID that the connector's search tool states in its description, or find the user by name with `slack_search_users`, and write the ID back to the config file. If neither gives one, set `user_id` to null (mention counts will be 0).

## Load Jira config

Each server in `integrations.jira.servers` has: `name`, `url`, `projects`, optional `config_file`. If `jira.servers` is empty or missing, Jira is skipped in step 3.

## Compute timestamps

```bash
# Slack oldest (Unix float)
python3 -c "from datetime import datetime; print(datetime.fromisoformat('{last_run}').timestamp())"
# Jira JQL date (YYYY-MM-DD)
python3 -c "from datetime import datetime; print(datetime.fromisoformat('{last_run}').strftime('%Y-%m-%d'))"
```

## Integration preflight

Slack has no command to probe. It is available when the session has the Slack connector's `slack_read_channel` and `slack_search_public_and_private` tools; load them through tool search if they are deferred. Set `slack_ok` accordingly.

Jira uses the circuit-breaker script, which caches its result for 5 minutes:

```bash
SCRIPT="${CLAUDE_PLUGIN_ROOT}/scripts/check-integration.sh"
jira_ok=true
if [[ $(jq '.integrations.jira.servers | length' ~/.claude/workshop.json 2>/dev/null) -gt 0 ]]; then
  "$SCRIPT" jira 2>&1 || jira_ok=false
fi
```

- If Slack workspaces are configured and there is no Slack connector — skip `steps/02-fetch-slack.md`; note "Slack unavailable: no Slack connector in this session" in the header. Do not fall back to a command-line tool.
- If `jira_ok=false` — skip `steps/03-fetch-jira.md`; note "Jira unavailable" in the header.
- If **both** are unavailable — output "All integrations unavailable — prioritize cannot run." and stop.

Proceed to `steps/02-fetch-slack.md` with: mode, the connected workspace and its channels, oldest_ts, user_id, jira servers list, last_run_date (skipping any source marked unavailable).
