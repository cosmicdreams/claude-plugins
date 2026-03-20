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

## Compute oldest_ts

Convert `last_run` ISO to a Unix float for Slack `--oldest`:

```bash
python3 -c "from datetime import datetime; print(datetime.fromisoformat('{last_run}').timestamp())"
```

Proceed to `steps/02-fetch.md` with: workspaces list, oldest_ts, user_id per workspace.
