---
name: pulse
description: >
  Cross-source priority triage — aggregates Jira and Slack into a single ranked view of
  what needs your attention right now. Use pulse when you want a unified, multi-source
  snapshot. Use individual skills (office:slack, office:jira) when querying a single
  source. Outputs two views: (1) top priority item across all sources, (2) full delta
  since last broadcast. Designed to run hourly via /loop. Requires office-pulse.json config.
triggers:
  - "pulse check"
  - "what needs my attention"
  - "what needs attention right now"
  - "priority check"
  - "office:pulse"
  - "anything urgent across"
  - "check pulse"
  - "what's new across jira and slack"
  - "cross-source check"
allowed-tools: Agent, Bash, Read, Write
---

# office:pulse — Ambient Priority Watchdog

Aggregates Jira (jira-cli) and Slack (agent-slack) into a unified priority view.
Computes deltas since the last run and surfaces the single top-priority item.

**Use pulse when:** you want cross-source triage — "what do I need to respond to right now?"

**Use individual skills instead when:** querying a single source (e.g. "show me my Jira sprint
tickets" → `office:jira`; "check #general in Slack" → `office:slack`).

**Two output views every run:**
1. **TOP PRIORITY** — the single highest-priority item across all sources with a one-line reason
2. **SINCE LAST BROADCAST** — full delta grouped by source (Jira / Slack)

## Step 1: Load config

Check for config in order:
1. `.claude/office-pulse.json` in the current working directory
2. `~/.claude/office-pulse.json`

```bash
[ -f .claude/office-pulse.json ] && cat .claude/office-pulse.json || cat ~/.claude/office-pulse.json 2>/dev/null
```

If neither exists, create `.claude/office-pulse.json` from the template at
`references/config-template.md`, output setup instructions, and stop.

Parse:
- `enabled` — if `false`, output "office:pulse is disabled." and stop
- `priority_threshold` — `low` / `medium` / `high` / `critical` (default: `medium`)
- `jira.servers` — list of server objects, each with `url`, `name`, `config_file`, `projects`
- `slack.workspaces` — list of workspace objects, each with `url`, `name`, `user_id`, `channels`, `keywords`

## Step 2: Load previous state

```bash
tail -1 ~/.claude/office-pulse.state.jsonl 2>/dev/null
```

Parse as JSON. Fields used:
- `ts` — ISO timestamp of last run
- `jira_snapshots` — object mapping issue key → `{ comments, status, updated }`

If absent or empty: first run — treat `oldest_ts` as 24h ago.

For each Slack workspace, get the user ID for @mention classification:
- If `user_id` is already set on the workspace object → use it directly
- If missing → run `agent-slack auth whoami --workspace {workspace_url}`, extract `user_id`
  or `id`, write it back to the config file under that workspace, then use it
- If `whoami` fails → set `user_id` to null (mention classification skipped for that workspace)

Convert `ts` to a Unix float (`oldest_ts`) for Slack `--oldest`, and a date string
(`last_run_date`) for Jira `--updated-after`:

```bash
python3 -c "
from datetime import datetime, timedelta
ts = '{state_ts}'
dt = datetime.fromisoformat(ts) if ts else datetime.now() - timedelta(hours=24)
print(dt.timestamp())
print(dt.strftime('%Y-%m-%d'))
"
```

## Step 3: Spawn parallel data-collection subagents

Spawn all subagents simultaneously — one per Jira server, one per Slack channel.
Wait for all to return, then synthesize their findings into the output.

### 3a. One subagent per Jira server

For each server in `jira.servers`, spawn a dedicated subagent. Prompt template:

```
You are a Jira data collection agent for office:pulse.

SERVER: {server.name} ({server.url})
JIRA_CONFIG_FILE: {server.config_file, or "default"}
PROJECTS: {server.projects}
LAST_RUN_DATE: {last_run_date}

If JIRA_CONFIG_FILE is not "default", export it before running any jira commands:
  export JIRA_CONFIG_FILE={server.config_file}

Use the office:jira skill to fetch issues updated since LAST_RUN_DATE across all PROJECTS.
Focus on: issues assigned to you, issues with new comments, status changes, and blocked issues.
If LAST_RUN_DATE is unknown, look back 24 hours.
If jira is unavailable or auth fails, report that clearly.

Report your findings as a concise summary — what changed, what needs attention, any blockers.
Label each issue with its server name ({server.name}) so the synthesizing agent knows the source.
```

### 3b. One subagent per Slack channel

For every channel across all workspaces, spawn a dedicated subagent simultaneously.
Prompt template (substitute values per channel):

```
You are a Slack data collection agent for office:pulse.

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

## Step 4: Synthesize findings

Collect all subagent reports. Using the priority table below, identify the single
top-priority item across all sources. Then compile the full delta grouped by source.

Priority signals:
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

Filter to items at or above `priority_threshold`.

## Step 5: Output

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

## Step 6: Write new state

Append one line to `~/.claude/office-pulse.state.jsonl`:

```json
{"ts":"{ISO_NOW}","jira_snapshots":{"{KEY}":{"comments":{N},"status":"{status}","updated":"{date}"}}}
```

Then trim to last 7 days:

```bash
python3 << 'EOF'
import json, os
from datetime import datetime, timedelta

path = os.path.expanduser("~/.claude/office-pulse.state.jsonl")
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

## Modifying config mid-session

Update the active config file in place (whichever was loaded in Step 1).

- "add #javascript to Velir" → append to that workspace's `channels`
- "remove #preview from Velir" → remove from that workspace's `channels`
- "add keyword 'deploy' to Velir" → append to that workspace's `keywords`

Confirm: "Updated. [WorkspaceName] now tracks: #ch1, #ch2, #ch3"

## Running on a loop

```
/loop 1h /office:pulse
```

Cancel with `CronDelete` using the job ID returned by `/loop`.
