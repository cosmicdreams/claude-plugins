# Step 4 — Synthesize, Output, Write State

## Priority table

Using results from all subagents, identify the top-priority item.

| Signal | Weight |
|---|---|
| Jira issue assigned to you, status = Blocked | Critical |
| DM received in Slack | High |
| @mention in Slack channel | High |
| Jira issue where you are mentioned in new comment | High |
| Reply to your thread in Slack channel | Medium |
| Keyword match in Slack channel | Medium |
| Jira issue status changed | Medium |
| Jira comment on issue you're watching | Low |
| New message in Slack channel (general) | Low |

Filter to items at or above `priority_threshold` from config.

## Output format

```
━━━ PULSE — {HH:MM} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  jira: {ServerName1}, {ServerName2}
  slack: {WorkspaceName}: #{ch1}, #{ch2}

TOP PRIORITY
→ [{source}] {summary} — {why it's top priority}

SINCE LAST BROADCAST ({N} minutes ago)
JIRA
  → [{ServerName}] {KEY}: {what changed}
  → [or: no Jira activity]

SLACK
  → [High] @mention from {user} in #{channel} ({WorkspaceName}): "{excerpt}"
  → [Medium] keyword "{keyword}" in #{channel} ({WorkspaceName}): "{excerpt}"
  → [or: no Slack activity]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If nothing new: `✓ PULSE {HH:MM} — nothing new since {last broadcast time}`

## Write state

Append one line to the state file:

```bash
DATA_PATH=$(jq -r '.data_path // "~/.claude"' ~/.claude/workflow.json 2>/dev/null || echo "~/.claude")
echo '{"ts":"{ISO_NOW}","jira_snapshots":{"{KEY}":{"comments":{N},"status":"{status}","updated":"{date}"}}}' \
  >> "${DATA_PATH}/workflow-pulse.state.jsonl"
```

Then trim to last 7 days:

```bash
python3 << 'EOF'
import json, os
from datetime import datetime, timedelta

path = os.path.expanduser(os.environ.get('DATA_PATH', '~/.claude') + '/workflow-pulse.state.jsonl')
if not os.path.exists(path):
    exit(0)
cutoff = (datetime.now() - timedelta(days=7)).isoformat()
with open(path) as f:
    lines = [l.strip() for l in f if l.strip()]
kept = [l for l in lines if json.loads(l).get("ts","") >= cutoff]
with open(path, "w") as f:
    f.write("\n".join(kept) + ("\n" if kept else ""))
EOF
```
