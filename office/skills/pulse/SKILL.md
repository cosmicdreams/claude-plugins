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
- `jira.projects` — list of project codes
- `slack.workspaces` — list of workspace objects, each with `url`, `name`, `channels`, and optional `keywords`

## Step 2: Load previous state

```bash
tail -1 ~/.claude/office-pulse.state.jsonl 2>/dev/null
```

Parse as JSON. Fields used:
- `ts` — ISO timestamp of last run
- `jira_snapshots` — object mapping issue key → `{ comments, status, updated }`

If absent or empty: first run — treat `oldest_ts` as 24h ago.

For each workspace, get the Slack user ID for @mention classification:

- If `user_id` is already set on the workspace object in config → use it directly
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

Spawn all subagents simultaneously — one for Jira, one per Slack channel.
Wait for all before proceeding.

### 3a. Jira subagent

```
You are a data collection agent for office:pulse. Fetch Jira data and return JSON.
Do not narrate — just fetch and return structured data.

JIRA_PROJECTS: {comma-separated list from config.jira.projects}
LAST_RUN_DATE: {last_run_date, e.g. 2026-03-11}

INSTRUCTIONS:

For each project in JIRA_PROJECTS run:
  jira issue list --project {PROJECT} --updated-after {LAST_RUN_DATE} --plain \
    --columns KEY,SUMMARY,STATUS,PRIORITY,UPDATED,ASSIGNEE
If LAST_RUN_DATE is unknown, omit --updated-after.
For issues assigned to you or with new comments, also run:
  jira issue view {KEY} --plain --comments 5
If jira is unavailable, set available=false, issues=[].

Return ONLY valid JSON (no markdown):
{
  "available": true,
  "issues": [ { "key": "...", "summary": "...", "status": "...", "priority": "...", "updated": "...", "assignee": "...", "comments": 0 } ]
}
```

### 3b. One subagent per Slack channel (all spawned in parallel)

For every channel across all workspaces, spawn a dedicated subagent simultaneously.
Prompt template (substitute values per channel):

```
You are a data collection agent for office:pulse. Fetch one Slack channel and return JSON.
Do not narrate — just fetch and return structured data.

CHANNEL: {channel_name}
WORKSPACE_URL: {workspace_url}
OLDEST_TS: {oldest_ts}

INSTRUCTIONS:

Fetch:
  agent-slack message list {channel_name} --workspace {workspace_url} \
    --oldest {oldest_ts} --limit 20
If oldest_ts is null, omit --oldest and use --limit 20.
If the fetch fails, set error to the error message and messages=[].
Do NOT run agent-slack auth whoami — assume auth works.

Return ONLY valid JSON (no markdown):
{
  "workspace_host": "{hostname of workspace_url}",
  "channel": "{channel_name}",
  "error": null,
  "messages": [ { "ts": "...", "user": "...", "text": "...", "thread_ts": null } ]
}
```

If a channel subagent fails entirely, treat it as `{ "error": "subagent failed", "messages": [] }`.
If the Jira subagent fails entirely, note `[Jira collection failed]` and continue with Slack only.

## Step 4: Compute deltas

Use `your_user_id` from Step 2 for mention classification.

**Jira delta:** Issues where `updated` date > `last_run_date`, or `comments` count >
snapshot value in `jira_snapshots`. On first run, all returned issues are new.

**Slack delta:** Because `--oldest` was passed, all returned messages are already new.

Classify each Slack message using the workspace's `keywords` list:
- **DM**: channel is `directmessage` or `im`
- **@mention**: text contains `<@{your_user_id}>` (skip if `your_user_id` is null)
- **Thread reply**: `thread_ts` set and `thread_ts` != `ts`
- **Keyword match**: text matches any entry from this workspace's `keywords` (case-insensitive)
- **General**: anything else

## Step 5: Rank priorities

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

Filter to items at or above `priority_threshold`. Sort descending.

## Step 6: Output

```
━━━ PULSE — {HH:MM} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  slack: {WorkspaceName}: #{ch1}, #{ch2} · {WorkspaceName2}: #{ch3}

TOP PRIORITY
→ [{source}] {summary} — {why it's top priority}

SINCE LAST BROADCAST ({N} minutes ago)
JIRA
  → {KEY}: {what changed} ({project})
  → [or: no Jira activity]

SLACK
  → [High] @mention from {user} in #{channel} ({WorkspaceName}): "{excerpt}"
  → [Medium] keyword "{keyword}" in #{channel} ({WorkspaceName}): "{excerpt}"
  → [or: no Slack activity]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If nothing new: `✓ PULSE {HH:MM} — nothing new since {last broadcast time}`

## Step 7: Write new state

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
