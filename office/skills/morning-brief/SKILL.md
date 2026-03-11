---
name: morning-brief
description: >
  Your morning Slack catchup. Run once at the start of your day to scan what happened
  overnight across all configured channels, surface @mentions and keyword hits, and
  optionally update ~/.claude/office-pulse.json to focus which channels office:pulse
  monitors for the rest of the day.

  Use this skill for time-bounded overnight catchup ("what happened while I was away").
  For real-time Slack monitoring use office:pulse. For raw channel data fetch use office:slack.
triggers:
  - "morning brief"
  - "office:morning-brief"
  - "what happened overnight"
  - "overnight activity"
  - "morning briefing"
  - "catch me up on overnight"
  - "what did I miss overnight"
  - "set today's focus"
  - "start of day slack summary"
  - "start of day summary"
allowed-tools: Agent, Bash, Read, Write
---

# office:morning-brief — Morning Briefing

Scan overnight Slack activity across all configured channels, surface what matters,
and optionally update `~/.claude/office-pulse.json` to focus pulse for the day.

## Step 1: Load config

Read `~/.claude/office-pulse.json`. If it does not exist, output:
```
office:morning-brief requires ~/.claude/office-pulse.json.
Create it with slack.workspaces configured.
See office/skills/pulse/references/config-template.md for the template.
```
Then stop.

Parse:
- `slack.workspaces` — list of workspace objects, each with `url`, `name`, `channels`, and optional `keywords`

If `slack.workspaces` is empty or missing, output:
```
No slack.workspaces configured in ~/.claude/office-pulse.json.
Add at least one workspace with channels to enable morning-brief.
```
Then stop.

## Step 2: Load state

```bash
cat ~/.claude/office-morning-brief.state.json 2>/dev/null
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

## Step 3: Spawn data-collection subagent

Spawn a general-purpose subagent to fetch all Slack data silently. Pass the workspace config
and `last_run` timestamp in the prompt.

Spawn one subagent per Slack channel, all simultaneously. Each subagent handles exactly one
channel. Wait for all to return before proceeding.

**Per-channel subagent prompt** (substitute values for each channel):

```
You are a data collection agent for office:morning-brief. Fetch one Slack channel and return JSON.
Do not narrate or explain.

CHANNEL: {channel_name}
WORKSPACE_URL: {workspace_url}
WORKSPACE_HOST: {workspace_hostname}
WORKSPACE_KEYWORDS: {keywords array for this workspace, or []}
OLDEST_TS: {last_run_unix_float}   ← fetch only messages after this point
YOUR_USER_ID: omit — detect via auth whoami

INSTRUCTIONS:

1. Auth: Run `agent-slack auth whoami`. Extract your user ID (field: user_id or id).
   If agent-slack is unavailable, return { "error": "agent-slack unavailable" }.

2. Fetch:
     agent-slack message list {channel_name} --workspace {workspace_url} \
       --oldest {oldest_ts} --limit 200
   If oldest_ts is null, omit --oldest and use --limit 100.
   If the channel errors, set error to the error message and messages=[].

3. Compute from returned messages (all are already newer than oldest_ts):
   - total_messages: count of all returned messages
   - mention_count: messages containing <@{your_user_id}>
   - keyword_hits: messages matching any keyword in WORKSPACE_KEYWORDS (case-insensitive);
     record { keyword, user, excerpt } for each hit
   - thread_replies: messages where thread_ts is set and thread_ts != ts
   - notable: up to 2 messages — mentions first, then keyword hits; each as { user, excerpt }
   - most_recent_ts: highest ts value seen (if no messages, use oldest_ts)

Return ONLY valid JSON (no markdown):
{
  "workspace_host": "{workspace_hostname}",
  "channel": "{channel_name}",
  "your_user_id": "U...",
  "error": null,
  "most_recent_ts": "...",
  "total_messages": 0,
  "mention_count": 0,
  "keyword_hits": [ { "keyword": "...", "user": "...", "excerpt": "..." } ],
  "thread_replies": 0,
  "notable": [ { "user": "...", "excerpt": "..." } ]
}
```

If any channel subagent fails entirely, treat it as `{ "error": "subagent failed", "total_messages": 0, ... }`.

If ALL channel subagents return `{ "error": "agent-slack unavailable" }`, output:
```
Morning brief failed: agent-slack unavailable
Check agent-slack auth: agent-slack auth import-desktop
```
Then stop.

**Merge results** into the shape the scoring step expects:
```json
{
  "your_user_id": "U...",
  "workspaces": {
    "{workspace_hostname}": {
      "{channel_name}": { ...per-channel result... }
    }
  }
}
```

## Step 4: Score and rank

For each channel in the subagent result:

```
score = (mention_count × 3) + (keyword_hits × 2) + (thread_replies × 2) + floor(total_messages / 5)
```

Sort descending by score within each workspace.

## Step 5: Output morning brief

```
━━━ MORNING BRIEF — {YYYY-MM-DD} ━━━━━━━━━━━━━━━━━━━━━━━

OVERNIGHT SLACK ACTIVITY (since {last_run_time})
Scanned {N} channels across {W} workspaces · {total_msg_count} messages

{WorkspaceName}
  #{channel}  — {mention_count} @mentions, {keyword_hits} keyword hits, {total_messages} messages
    → @{user}: "{excerpt}"
  #{channel}  — keyword "{keyword}", {total_messages} messages
    → "{excerpt}"
  #{channel}  — {total_messages} messages
  Quiet: #channel1, #channel2

{WorkspaceName2}
  ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Show channels with activity ranked by score within each workspace.
List zero-activity channels as "Quiet: ..." per workspace.
If no activity anywhere: "No overnight activity across any configured channel."

## Step 6: Offer focus update

Show current config and offer to narrow it for the day:

```
Currently configured:
  {WorkspaceName}: #{ch1}, #{ch2}, #{ch3}
  {WorkspaceName2}: #{ch1}

Want to focus on specific channels today?
Say which to watch (e.g. "focus on #preview and #experience-builder in Drupal"),
or "keep current" to leave office-pulse.json unchanged.
```

- User names channels → update `office-pulse.json` (Step 7)
- User says "keep current" / "no" / "leave it" → skip Step 7

## Step 7: Update office-pulse.json (only if requested)

Read `~/.claude/office-pulse.json`. Update the `channels` list for the relevant workspace(s).
Preserve all other fields. Set `updated` and `updated_by: "morning-brief"`.

Channels must already exist in the workspace's current list. If a named channel is not found:
"#{channel} is not in your configured channels — add it to ~/.claude/office-pulse.json first, or confirm to track it anyway."

## Step 8: Write state

```bash
echo '{"last_run": "{ISO_NOW}"}' > ~/.claude/office-morning-brief.state.json
```

## Step 9: Done

```
Morning brief complete.
Pulse is tracking: {WorkspaceName}: #{ch1}, #{ch2} · {WorkspaceName2}: #{ch1}
Run /loop 1h /office:pulse to start monitoring.
```
