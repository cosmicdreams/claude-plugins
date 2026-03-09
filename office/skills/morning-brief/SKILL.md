---
name: morning-brief
description: >
  Morning briefing that scans overnight Slack activity across all candidate channels,
  proposes a focused watch list for the day, and writes ~/.claude/office-slack-focus.json.
  Run once each morning. Trigger phrases: "morning brief", "office:morning-brief",
  "what happened overnight", "set today's focus".
triggers:
  - "morning brief"
  - "office:morning-brief"
  - "what happened overnight"
  - "set today's focus"
allowed-tools: Bash, Read, Write
---

# office:morning-brief — Morning Briefing & Slack Focus Setter

Scan overnight Slack activity, rank channels by relevance, propose a focused watch list,
and write `~/.claude/office-slack-focus.json` for `office:pulse` to use throughout the day.

## Step 1: Auth check

```bash
agent-slack auth whoami
```

If `agent-slack` is not found, tell the user:
> `agent-slack` is not installed. Install with: `npm i -g agent-slack`
> Then authenticate: `agent-slack auth import-desktop`

If auth fails, tell the user to run `agent-slack auth import-desktop` and stop.

## Step 2: Load config

Read `~/.claude/office-pulse.local.md` — parse frontmatter fields:
- `slack_keywords` — list of keywords to watch for (case-insensitive)
- `slack_default_workspace` — default workspace URL

Read `~/.claude/office-slack.local.md` — parse frontmatter fields:
- `channels` — list of candidate channel names to scan
- `workspace` — workspace URL (overrides `slack_default_workspace` if present)

If neither file exists, output:
```
office:morning-brief is not configured.
Create ~/.claude/office-slack.local.md with a channels list.
See ~/.claude/plugins/cache/local/office/<ver>/skills/pulse/references/config-template.md for reference.
```
Then stop.

Use the first workspace found (`office-slack.local.md` → `office-pulse.local.md` → `https://slack.com` as fallback).

## Step 3: Load state

Read `~/.claude/office-morning-brief.state.json` if it exists. Parse `last_run` ISO timestamp.

If the file does not exist or `last_run` is missing: default to 10pm of the previous calendar day.

```bash
# Compute previous 10pm in local time
python3 -c "
from datetime import datetime, timedelta
now = datetime.now()
prev_10pm = now.replace(hour=22, minute=0, second=0, microsecond=0) - timedelta(days=1)
print(prev_10pm.isoformat())
"
```

## Step 4: Scan all candidate channels

For each channel in the `channels` list from `office-slack.local.md`, fetch recent messages:

```bash
agent-slack message list <channel> --workspace <workspace> --limit 100
```

Run fetches sequentially (rate limit caution). If a channel returns an error, skip it with a note and continue.

For each channel, filter to messages where `ts` (Unix epoch) > `last_run` timestamp.

Compute per-channel metrics:
- `total_messages` — count of messages since `last_run`
- `mention_count` — messages where `text` contains `<@` followed by your user ID (from `agent-slack auth whoami`)
- `keyword_hits` — messages where `text` contains any `slack_keywords` entry (case-insensitive)
- `thread_replies` — messages where `thread_ts` is set and `thread_ts` differs from `ts` (i.e. reply, not root)

## Step 5: Score and rank channels

Score each channel:

```
score = (mention_count × 3) + (keyword_hits × 2) + (thread_replies × 2) + floor(total_messages / 5)
```

Sort descending by score. Take top 3–5 channels (skip channels with score = 0 and total_messages = 0).

## Step 6: Propose focus

Output the morning brief:

```
━━━ MORNING BRIEF — {YYYY-MM-DD} ━━━━━━━━━━━━━━━━━━━━━━━

OVERNIGHT SLACK ACTIVITY (since {last_run_time})

Proposed focus for today:
  1. #{channel} ({workspace_short}) — {mention_count} @mentions, {total_messages} messages
  2. #{channel} ({workspace_short}) — keyword "{hit}", {total_messages} messages
  3. #{channel} ({workspace_short}) — {total_messages} messages (active)

Notable:
  → @{user} mentioned you in #{channel}: "{excerpt}"
  → keyword "{keyword}" appeared in #{channel}: "{excerpt}"

  [or: No notable overnight activity.]

Confirm this focus list? (or say which channels to add/remove)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

`workspace_short` = hostname only (e.g. `drupal` from `drupal.slack.com`).

If no channels have any activity, propose the top 3 by historical activity or the full list if ≤ 3.

## Step 7: Wait for confirmation

Wait for the user to confirm or adjust:

- "yes" / "looks good" / "confirm" → use the proposed list as-is
- "add #channel" → append to list
- "remove #channel" / "drop #channel" → remove from list
- "just #channel1 and #channel2" → replace list entirely
- "skip" / "no slack today" → write an empty channels list

## Step 8: Write focus file

Write `~/.claude/office-slack-focus.json`:

```json
{
  "updated": "{ISO_NOW}",
  "set_by": "morning-brief",
  "context": "Focus set from morning brief on {date}",
  "channels": [
    { "workspace": "{workspace_url}", "channel": "{channel_name}" }
  ]
}
```

If the user skipped or the list is empty, write:

```json
{
  "updated": "{ISO_NOW}",
  "set_by": "morning-brief",
  "context": "No Slack focus set for today",
  "channels": []
}
```

## Step 9: Write state

Write `~/.claude/office-morning-brief.state.json`:

```json
{"last_run": "{ISO_NOW}"}
```

## Step 10: Done

Output:

```
Focus set: #{channel1}, #{channel2} (and N more)
Run /loop 1h /office:pulse to start monitoring.
```

Or if channels is empty:
```
No Slack focus set. Pulse will skip Slack today.
Run /office:morning-brief again tomorrow morning.
```
