---
name: morning-brief
description: >
  Morning briefing that scans overnight Slack activity across all configured channels,
  highlights notable activity, and optionally updates ~/.claude/office-pulse.json
  to focus pulse on specific channels for the day.
  Run once each morning. Trigger phrases: "morning brief", "office:morning-brief",
  "what happened overnight", "set today's focus".
triggers:
  - "morning brief"
  - "office:morning-brief"
  - "what happened overnight"
  - "set today's focus"
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

Read `~/.claude/office-pulse.local.md`. If it does not exist, output:
```
office:morning-brief requires ~/.claude/office-pulse.local.md.
Create it with slack_channels and slack_default_workspace configured.
See references/config-template.md for the template.
```
Then stop.

Parse:
- `slack_default_workspace` — workspace URL for channels that omit `workspace`
- `slack_keywords` — keywords to flag (case-insensitive)
- `slack_channels` — full universe of channels to scan

If `slack_channels` is empty or missing, output:
```
No slack_channels configured in ~/.claude/office-pulse.local.md.
Add a slack_channels list to enable morning-brief.
```
Then stop.

Resolve each channel entry: if `workspace` is omitted, apply `slack_default_workspace`.

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

For each channel in `slack_channels`, fetch recent messages:

```bash
agent-slack message list <channel> --workspace <workspace> --limit 100
```

Run fetches sequentially (rate limit caution). Skip channels that error with a note.

Filter to messages where `ts` (Unix epoch float) > `last_run` Unix timestamp.

Compute per-channel metrics:
- `total_messages` — count since `last_run`
- `mention_count` — messages containing `<@{your_user_id}>`
- `keyword_hits` — messages matching any `slack_keywords` entry; record keyword + excerpt
- `thread_replies` — messages where `thread_ts` set and `thread_ts` != `ts`
- `notable` — up to 2 notable messages per channel (mentions first, then keyword hits)

## Step 5: Score and rank

```
score = (mention_count × 3) + (keyword_hits × 2) + (thread_replies × 2) + floor(total_messages / 5)
```

Sort descending by score.

## Step 6: Output morning brief

```
━━━ MORNING BRIEF — {YYYY-MM-DD} ━━━━━━━━━━━━━━━━━━━━━━━

OVERNIGHT SLACK ACTIVITY (since {last_run_time})
Scanned {N} channels · {total_msg_count} messages

  #{channel}  — {mention_count} @mentions, {keyword_hits} keyword hits, {total_messages} messages
    → @{user}: "{excerpt}"
  #{channel}  — keyword "{keyword}", {total_messages} messages
    → "{excerpt}"
  #{channel}  — {total_messages} messages

  Quiet: #channel1, #channel2, #channel3

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Show channels with activity ranked by score. List zero-activity channels compactly as "Quiet: ...".
If no channels had any activity: output "No overnight activity across any configured channel."

## Step 7: Offer focus update

After the brief, show the current tracking state and offer to change it:

```
Currently tracking (office-pulse.json): #{ch1}, #{ch2}

Want to focus on specific channels today?
Say which channels to watch (e.g. "focus on #preview and #experience-builder"),
or "keep current" to leave office-pulse.json unchanged.
```

- If user names channels → update `office-pulse.json` (Step 8)
- If user says "keep current" / "no" / "leave it" → skip Step 8
- If user says "reset" → restore channels from `slack_channels` in `office-pulse.local.md`

## Step 8: Update office-pulse.json (only if requested)

Read `~/.claude/office-pulse.json` and update `slack_channels` in place, preserving all other fields:

```json
{
  "updated": "{ISO_NOW}",
  "updated_by": "morning-brief",
  "slack_channels": [
    { "workspace": "{workspace_url}", "channel": "{channel_name}" }
  ]
}
```

Channels must come from the `slack_channels` universe in `office-pulse.local.md`.
If the user names a channel not in the list, flag it:
"#{channel} is not in your configured channels — add it to ~/.claude/office-pulse.local.md first, or confirm to track it anyway."

## Step 9: Write state

Write `~/.claude/office-morning-brief.state.json`:

```json
{"last_run": "{ISO_NOW}"}
```

## Step 10: Done

Output:

```
Morning brief complete.
Pulse is tracking: #{channel1}, #{channel2}  (source: {morning-brief|unchanged|reset})
Run /loop 1h /office:pulse to start monitoring.
```
