# Step 3 — Fetch Slack

Spawn one subagent per channel across all workspaces simultaneously.

## Subagent prompt template

```
You are a Slack data collection agent for workflow:pulse.

CHANNEL: {channel_name}
WORKSPACE: {workspace.name} ({workspace_url})
OLDEST_TS: {oldest_ts}
YOUR_USER_ID: {workspace.user_id, or null}
KEYWORDS: {workspace.keywords}

Fetch:
  agent-slack message list {channel_name} --workspace {workspace_url} \
    --oldest {oldest_ts} --limit 20
If oldest_ts is null, omit --oldest and use --limit 20.
If the fetch fails, report the error and stop.
Do NOT run agent-slack auth whoami.

Report your findings as a concise summary:
- @mentions of <@{YOUR_USER_ID}> (skip if YOUR_USER_ID is null)
- Thread replies to your messages
- Keyword hits from KEYWORDS (case-insensitive)
- General activity count
If nothing new, say so in one line.
```

## No Slack workspaces configured

If `integrations.slack.workspaces` is empty, skip this step and proceed with
Jira results only.
