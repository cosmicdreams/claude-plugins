---
name: pulse
description: >
  Cross-source priority triage — aggregates email (Gmail), Jira, and Slack into a single
  ranked view of what needs your attention right now. Use pulse when you want a unified,
  multi-source snapshot. Use individual skills (office:slack, office:jira,
  office:personal-email) when querying a single source. Outputs two views: (1) top
  priority item across all sources, (2) full delta since last broadcast. Designed to run
  hourly via /loop. Requires ~/.claude/office-pulse.json config.
triggers:
  - "pulse check"
  - "what needs my attention"
  - "what needs attention right now"
  - "priority check"
  - "office:pulse"
  - "anything urgent across"
  - "check pulse"
  - "what's new across email and slack"
  - "cross-source check"
allowed-tools: Agent, Bash, Read, Write
---

# office:pulse — Ambient Priority Watchdog

Orchestrates `office:personal-email` (gws), `office:jira` (jira-cli), and `office:slack`
(agent-slack) to produce a unified priority view across all three sources. Computes deltas
since the last run and surfaces the single top-priority item.

**Use pulse when:** you want a cross-source triage — "what do I need to respond to right now?"

**Use individual skills instead when:** querying a single source (e.g. "show me my Jira sprint
tickets" → `office:jira`; "read my latest emails" → `office:personal-email`; "check #general
in Slack" → `office:slack`).

**Two output views every run:**
1. **TOP PRIORITY** — the single highest-priority item across all sources with a one-line reason
2. **SINCE LAST BROADCAST** — full delta grouped by source (email / Jira / Slack)

## Step 1: Load config

Read `~/.claude/office-pulse.json`. If the file does not exist, output:

```
office:pulse is not configured.
Create ~/.claude/office-pulse.json — see references/config-template.md for the template.
```

Then stop.

Parse:
- `enabled` — if `false`, output "office:pulse is disabled." and stop
- `priority_threshold` — `low` / `medium` / `high` / `critical` (default: `medium`)
- `jira.projects` — list of project codes
- `email_source` — `gmail` (only supported value)
- `slack.workspaces` — list of workspace objects, each with `url`, `name`, `channels`, and optional `keywords`

### Project config detection

Check for `.claude/office-pulse.json` in the current working directory:

```bash
[ -f .claude/office-pulse.json ] && cat .claude/office-pulse.json
```

If found, compare `slack.workspaces` to the active config. If different, note for output header:
`[project config available — say "use project channels" to switch]`

Also parse from project config:
- `jira.server`, `jira.config_file`, `jira.projects` — for alternate Jira instance

If `jira.config_file` is set but the file does not exist, note for output:
`[project Jira: config not found at {path} — run: JIRA_CONFIG_FILE={path} jira init]`

## Step 2: Load previous state

```bash
tail -1 ~/.claude/office-pulse.state.jsonl 2>/dev/null
```

Parse as JSON. Fields used:
- `ts` — ISO timestamp of last run
- `email_last_id` — most recent email message ID seen
- `jira_snapshots` — object mapping issue key → `{ comments, status, updated }`
- `slack_channels` — object mapping `"workspace_host/channel"` → last seen Slack `ts`

If absent or empty: first run — all current data is "new."

## Step 3: Spawn data-collection subagent

Spawn a general-purpose subagent to do all external fetching. Pass the full config and state
as context in the prompt. The subagent runs silently and returns a single structured JSON result.

**Subagent prompt template** (substitute actual config and state values before spawning):

```
You are a data collection agent for office:pulse. Fetch data from all configured sources and
return a single JSON object. Do not narrate or explain — just fetch and return structured data.

CONFIG:
{paste full office-pulse.json content}

PREVIOUS STATE:
{paste last state line, or "first_run" if none}

INSTRUCTIONS:

1. Slack auth: Run `agent-slack auth whoami`. Extract your user ID (field: user_id or id).
   If agent-slack is unavailable, set slack.available=false.

2. Email: Run `gws mail list --unread --limit 20 --format json`.
   If unavailable or auth fails, set email.available=false.

3. Jira (global projects from config.jira.projects, default jira-cli config):
   For each project run:
     jira issue list --project {PROJECT} --updated-after "{last_run_ts}" --plain \
       --columns KEY,SUMMARY,STATUS,PRIORITY,UPDATED,ASSIGNEE
   If last_run_ts unknown, use: date -v-24H +"%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d '24 hours ago' +"%Y-%m-%dT%H:%M:%S"
   For issues assigned to you or mentioning you, also run: jira issue view {KEY} --plain --comments 5
   If unavailable, set jira.available=false.

4. Jira (project-local, only if config has jira.config_file):
   Same commands prefixed with JIRA_CONFIG_FILE={expanded_path}.
   Tag these issues with the jira.server hostname.

5. Slack: For each workspace in config.slack.workspaces, for each channel, run sequentially
   within the workspace (parallel across workspaces is fine):
     agent-slack message list {channel} --workspace {workspace_url} --limit 50
   Skip channels that error — note the error in the result.

Return ONLY valid JSON in this exact shape (no markdown, no explanation):
{
  "your_user_id": "U...",
  "last_run_ts": "{ts from state, or null}",
  "email": {
    "available": true,
    "messages": [ { "id": "...", "subject": "...", "from": "...", "received": "...", "urgent": false } ]
  },
  "jira": {
    "available": true,
    "issues": [ { "key": "PROJ-1", "summary": "...", "status": "...", "priority": "...", "updated": "...", "assignee": "...", "source": "global|project", "comments": 0 } ]
  },
  "slack": {
    "available": true,
    "workspaces": {
      "{workspace_hostname}": {
        "{channel_name}": {
          "error": null,
          "most_recent_ts": "...",
          "messages": [ { "ts": "...", "user": "...", "text": "...", "thread_ts": null } ]
        }
      }
    }
  }
}
```

Wait for the subagent to return. If it returns an error instead of JSON, note `[data collection failed: {error}]` and stop.

## Step 4: Compute deltas

Using the subagent result and previous state:

**Email delta:** Messages with IDs not in `email_last_id` from state.

**Jira delta:** Issues where `updated` > `last_run_ts`, or `comments` count > snapshot.

**Slack delta:** Per workspace/channel, messages with `ts` > `slack_channels["{host}/{channel}"]` from state.
On first run, all messages are new.

Classify each new Slack message using the workspace's own `keywords` list:
- **DM**: channel is `directmessage` or `im`
- **@mention**: text contains `<@{your_user_id}>`
- **Thread reply**: `thread_ts` set, `thread_ts` != `ts`, `thread_ts` matches one of your prior message `ts` values
- **Keyword match**: text contains any entry from this workspace's `keywords` (case-insensitive)
- **General**: anything else

## Step 5: Rank priorities

| Signal | Weight |
|---|---|
| Jira issue assigned to you, status = Blocked | Critical |
| DM received in Slack | High |
| @mention in Slack channel | High |
| Email subject contains urgent/approval/action required | High |
| Jira issue where you are mentioned in new comment | High |
| Reply to your thread in Slack channel | Medium |
| Keyword match in Slack channel | Medium |
| Jira issue status changed | Medium |
| New email from manager or key stakeholder | Medium |
| Jira comment on issue you're watching | Low |
| New message in Slack channel (general) | Low |
| New unread email (general) | Low |

Filter to items at or above `priority_threshold`. Sort descending.

## Step 6: Output

```
━━━ PULSE — {HH:MM} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  slack: {WorkspaceName}: #{ch1}, #{ch2} · {WorkspaceName2}: #{ch3}  (updated {N}m ago)
  [project config available — say "use project channels" to switch]  ← only if applicable

TOP PRIORITY
→ [{source}] {summary} — {why it's top priority}

SINCE LAST BROADCAST ({N} minutes ago)
EMAIL
  → {N} new messages — {notable subjects}
  → [or: no new email]

JIRA
  → {KEY}: {what changed} ({project})
  → [or: no Jira activity]

SLACK
  → [High] @mention from {user} in #{channel} ({WorkspaceName}): "{excerpt}"
  → [Medium] keyword "{keyword}" in #{channel} ({WorkspaceName}): "{excerpt}"
  → [or: no Slack activity]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If nothing new across all sources:
`✓ PULSE {HH:MM} — nothing new since {last broadcast time}`

## Step 7: Write new state

Append one line to `~/.claude/office-pulse.state.jsonl`:

```json
{"ts":"{ISO_NOW}","email_last_id":"{most_recent_id}","jira_snapshots":{"{KEY}":{"comments":{N},"status":"{status}","updated":"{ts}"}},"slack_channels":{"{workspace_host}/{channel}":"{most_recent_ts}"}}
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
print(f"Trimmed state: kept {len(kept)} entries.")
EOF
```

## Modifying config mid-session

Update `~/.claude/office-pulse.json` in place, preserving all fields. Set `updated` and `updated_by`.

- "add #javascript to Drupal" → append to that workspace's `channels`
- "remove #preview from Drupal" → remove from that workspace's `channels`
- "add keyword 'deploy' to My Team" → append to that workspace's `keywords`
- "use project channels" → merge project `.claude/office-pulse.json` workspaces into main config

Confirm: "Updated. [WorkspaceName] now tracks: #ch1, #ch2, #ch3"

## Running on a loop

```
/loop 1h /office:pulse
```

Cancel with `CronDelete` using the job ID returned by `/loop`.
