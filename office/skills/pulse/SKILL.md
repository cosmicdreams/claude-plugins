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

If absent or empty: first run — treat `oldest_ts` as 24h ago for Slack.

Convert `ts` to a Unix float (`oldest_ts`) for use in `--oldest` flags:

```bash
python3 -c "
from datetime import datetime, timedelta
import sys
ts = '{state_ts}'
if ts:
    dt = datetime.fromisoformat(ts)
else:
    dt = datetime.now() - timedelta(hours=24)
print(dt.timestamp())
"
```

## Step 3: Spawn parallel data-collection subagents

Spawn all fetch subagents at the same time — one per Slack channel, plus one for email/Jira.
All run in parallel; wait for all before proceeding.

### 3a. Email + Jira subagent

One subagent handles email and Jira (non-Slack sources). Prompt:

```
You are a data collection agent for office:pulse. Fetch email and Jira data and return JSON.
Do not narrate — just fetch and return structured data.

CONFIG:
{paste full office-pulse.json content}

LAST_RUN_TS: {oldest_ts unix float, or null}

INSTRUCTIONS:

1. Email: Run `gws mail list --unread --limit 20 --format json`.
   If unavailable or auth fails, set email.available=false, email.messages=[].

2. Jira (for each project in config.jira.projects, default jira-cli config):
   jira issue list --project {PROJECT} --updated-after "{last_run_iso}" --plain \
     --columns KEY,SUMMARY,STATUS,PRIORITY,UPDATED,ASSIGNEE
   If last_run_iso unknown, use: date -v-24H +"%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d '24 hours ago' +"%Y-%m-%dT%H:%M:%S"
   For issues assigned to you or with your user mentioned in comments:
     jira issue view {KEY} --plain --comments 5
   If unavailable, set jira.available=false, jira.issues=[].

3. Jira project-local (only if config has jira.config_file):
   Same commands prefixed with JIRA_CONFIG_FILE={expanded_path}.
   Tag each issue with source="project".

Return ONLY valid JSON (no markdown):
{
  "email": {
    "available": true,
    "messages": [ { "id": "...", "subject": "...", "from": "...", "received": "...", "urgent": false } ]
  },
  "jira": {
    "available": true,
    "issues": [ { "key": "...", "summary": "...", "status": "...", "priority": "...", "updated": "...", "assignee": "...", "source": "global|project", "comments": 0 } ]
  }
}
```

### 3b. One subagent per Slack channel (all spawned in parallel)

For every channel across all workspaces, spawn a dedicated subagent simultaneously.
Each subagent fetches exactly one channel. Prompt template (substitute values per channel):

```
You are a data collection agent for office:pulse. Fetch one Slack channel and return JSON.
Do not narrate — just fetch and return structured data.

CHANNEL: {channel_name}
WORKSPACE_URL: {workspace_url}
OLDEST_TS: {oldest_ts}   ← Unix float timestamp; fetch only messages after this point

INSTRUCTIONS:

1. Auth: Run `agent-slack auth whoami` to get your user ID (field: user_id or id).

2. Fetch: Run:
     agent-slack message list {channel_name} --workspace {workspace_url} \
       --oldest {oldest_ts} --limit 200
   If oldest_ts is null or unknown, omit --oldest and use --limit 50.
   If the channel errors, set error to the error message and messages=[].

3. Compute most_recent_ts: highest ts value across ALL returned messages (not just new ones).
   If no messages returned, use oldest_ts as most_recent_ts.

Return ONLY valid JSON (no markdown):
{
  "workspace_host": "{hostname of workspace_url}",
  "channel": "{channel_name}",
  "your_user_id": "U...",
  "error": null,
  "most_recent_ts": "...",
  "messages": [ { "ts": "...", "user": "...", "text": "...", "thread_ts": null } ]
}
```

Wait for ALL subagents (email/Jira + all per-channel) to return before continuing.

If the email/Jira subagent fails entirely, note `[email/Jira collection failed]` and continue with Slack only.
If a channel subagent fails entirely, treat it as `{ "error": "subagent failed", "messages": [] }`.

## Step 4: Merge and compute deltas

Collect all subagent results into a unified structure:

```python
{
  "your_user_id": ...,   # from any channel subagent result
  "email": { ... },      # from email/Jira subagent
  "jira": { ... },       # from email/Jira subagent
  "slack": {
    "workspaces": {
      "{workspace_host}": {
        "{channel}": { "error": ..., "most_recent_ts": ..., "messages": [...] }
      }
    }
  }
}
```

Because `--oldest` was passed, all returned messages are already new. No ts-comparison needed.

Classify each Slack message using the workspace's `keywords` list:
- **DM**: channel is `directmessage` or `im`
- **@mention**: text contains `<@{your_user_id}>`
- **Thread reply**: `thread_ts` set and `thread_ts` != `ts`
- **Keyword match**: text matches any entry from this workspace's `keywords` (case-insensitive)
- **General**: anything else

**Email delta:** Messages with IDs not in `email_last_id` from state.

**Jira delta:** Issues where `updated` > `last_run_ts`, or `comments` count > snapshot.

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
