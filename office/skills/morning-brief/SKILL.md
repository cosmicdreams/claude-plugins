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
allowed-tools: Bash, Read, Write
---

# office:morning-brief — Morning Briefing

Scan overnight Slack activity across all configured channels, surface what matters,
and optionally update `~/.claude/office-pulse.json` to focus pulse for the day.

## Step 1: Auth check

```bash
agent-slack auth whoami
```

If `agent-slack` is not found, tell the user:
> `agent-slack` is not installed. Install with: `npm i -g agent-slack`
> Then authenticate: `agent-slack auth import-desktop`

If auth fails, tell the user to run `agent-slack auth import-desktop` and stop.

Get your user ID from the output (look for `user_id` or `id` field).

## Step 2: Load config

Read `~/.claude/office-pulse.json`. If it does not exist, output:
```
office:morning-brief requires ~/.claude/office-pulse.json.
Create it with slack.workspaces configured.
See office/skills/pulse/references/config-template.md for the template.
```
Then stop.

Parse:
- `slack.workspaces` — list of workspace objects, each with `url`, `name`, `channels`, and optional `keywords`

Keywords are scoped per workspace — each workspace watches only its own `keywords` list.

If `slack.workspaces` is empty or missing, output:
```
No slack.workspaces configured in ~/.claude/office-pulse.json.
Add at least one workspace with channels to enable morning-brief.
```
Then stop.

## Step 3: Load state

Read `~/.claude/office-morning-brief.state.json` if it exists. Parse `last_run` ISO timestamp.

If the file does not exist or `last_run` is missing: default to 10pm of the previous calendar day.

```bash
python3 -c "
from datetime import datetime, timedelta
now = datetime.now()
prev_10pm = now.replace(hour=22, minute=0, second=0, microsecond=0) - timedelta(days=1)
print(prev_10pm.isoformat())
"
```

## Step 4: Scan all channels

For each workspace in `slack.workspaces`, iterate over its `channels`. Fetch sequentially within each
workspace (rate limit caution — parallel across workspaces is fine):

```bash
agent-slack message list <channel> --workspace <workspace_url> --limit 100
```

Skip channels that error with a note.

Filter to messages where `ts` (Unix epoch float) > `last_run` Unix timestamp.

Compute per-channel metrics:
- `total_messages` — count since `last_run`
- `mention_count` — messages containing `<@{your_user_id}>`
- `keyword_hits` — messages matching any entry in this workspace's `keywords` list; record keyword + excerpt
- `thread_replies` — messages where `thread_ts` set and `thread_ts` != `ts`
- `notable` — up to 2 notable messages per channel (mentions first, then keyword hits)

## Step 5: Score and rank

```
score = (mention_count × 3) + (keyword_hits × 2) + (thread_replies × 2) + floor(total_messages / 5)
```

Sort descending by score. Group output by workspace.

## Step 6: Output morning brief

```
━━━ MORNING BRIEF — {YYYY-MM-DD} ━━━━━━━━━━━━━━━━━━━━━━━

OVERNIGHT SLACK ACTIVITY (since {last_run_time})
Scanned {N} channels across {W} workspaces · {total_msg_count} messages

{WorkspaceName} ({workspace_url})
  #{channel}  — {mention_count} @mentions, {keyword_hits} keyword hits, {total_messages} messages
    → @{user}: "{excerpt}"
  #{channel}  — keyword "{keyword}", {total_messages} messages
    → "{excerpt}"
  #{channel}  — {total_messages} messages
  Quiet: #channel1, #channel2

{WorkspaceName2} ({workspace_url})
  ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Show channels with activity ranked by score within each workspace.
List zero-activity channels compactly as "Quiet: ..." per workspace.
If no channels had any activity: output "No overnight activity across any configured channel."

## Step 7: Offer focus update

After the brief, show the current channel configuration and offer to narrow it for the day:

```
Currently configured:
  {WorkspaceName}: #{ch1}, #{ch2}, #{ch3}
  {WorkspaceName2}: #{ch1}

Want to focus on specific channels today?
Say which to watch (e.g. "focus on #preview and #experience-builder in Drupal"),
or "keep current" to leave office-pulse.json unchanged.
```

- If user names channels → update `office-pulse.json` (Step 8)
- If user says "keep current" / "no" / "leave it" → skip Step 8

## Step 8: Update office-pulse.json (only if requested)

Read `~/.claude/office-pulse.json`. Update the `channels` list for the relevant workspace(s),
preserving all other fields. Update `updated` and `updated_by`:

```json
{
  "updated": "{ISO_NOW}",
  "updated_by": "morning-brief",
  "slack": {
    "keywords": ["...unchanged..."],
    "workspaces": [
      {
        "url": "https://drupal.slack.com",
        "name": "Drupal",
        "channels": ["preview", "experience-builder"]
      }
    ]
  }
}
```

Channels must already exist in the workspace's channel list.
If the user names a channel not in any workspace, flag it:
"#{channel} is not in your configured channels — add it to ~/.claude/office-pulse.json first, or confirm to track it anyway."

## Step 9: Write state

Write `~/.claude/office-morning-brief.state.json`:

```json
{"last_run": "{ISO_NOW}"}
```

## Step 10: Done

Output:

```
Morning brief complete.
Pulse is tracking: {WorkspaceName}: #{ch1}, #{ch2} · {WorkspaceName2}: #{ch1}
Run /loop 1h /office:pulse to start monitoring.
```
