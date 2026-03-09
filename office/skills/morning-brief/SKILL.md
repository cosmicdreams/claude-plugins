---
name: morning-brief
description: >
  Morning briefing that scans overnight Slack activity across all configured channels,
  highlights notable activity, and optionally writes ~/.claude/office-slack-focus.json
  to temporarily focus pulse on specific channels for the day.
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
and optionally set a focused channel list for the day's `office:pulse` runs.

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
Create it with at least slack_channels and slack_default_workspace configured.
See the config template in the office plugin for reference.
```
Then stop.

Parse:
- `slack_default_workspace` — workspace URL to apply to channels that omit `workspace`
- `slack_keywords` — keywords to flag (case-insensitive)
- `slack_channels` — full list of channel entries (`{ channel, workspace? }`)

If `slack_channels` is empty or missing, output:
```
No slack_channels configured in ~/.claude/office-pulse.local.md.
Add a slack_channels list to enable morning-brief.
```
Then stop.

Resolve each channel entry: if `workspace` is omitted, use `slack_default_workspace`.

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

Run fetches sequentially (rate limit caution). If a channel returns an error, skip it with a note and continue.

For each channel, filter to messages where `ts` (Unix epoch float) > `last_run` Unix timestamp.

Compute per-channel metrics:
- `total_messages` — count of messages since `last_run`
- `mention_count` — messages where `text` contains `<@{your_user_id}>`
- `keyword_hits` — messages where `text` contains any `slack_keywords` entry (case-insensitive); record which keyword and an excerpt
- `thread_replies` — messages where `thread_ts` is set and `thread_ts` != `ts`
- `notable` — collect up to 2 notable messages per channel (mentions first, then keyword hits)

## Step 5: Score and rank channels

Score each channel:

```
score = (mention_count × 3) + (keyword_hits × 2) + (thread_replies × 2) + floor(total_messages / 5)
```

Sort descending by score.

## Step 6: Output morning brief

```
━━━ MORNING BRIEF — {YYYY-MM-DD} ━━━━━━━━━━━━━━━━━━━━━━━

OVERNIGHT SLACK ACTIVITY (since {last_run_time})
Scanned {N} channels • {total_msg_count} messages

  #{channel}  — {mention_count} @mentions, {keyword_hits} keyword hits, {total_messages} messages
    → @{user}: "{excerpt}"
  #{channel}  — {keyword_hits} keyword hits, {total_messages} messages
    → keyword "{keyword}": "{excerpt}"
  #{channel}  — {total_messages} messages (no notable activity)
  ...
  [or: No overnight activity across any configured channel.]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Show all channels that had activity. Suppress channels with zero messages (list their names in a compact footer line: "Quiet: #channel1, #channel2").

`workspace_short` = hostname only (e.g. `drupal` from `drupal.slack.com`). Omit if all channels share the same workspace.

## Step 7: Offer focus override (optional)

After the brief, offer:

```
Want to focus pulse on specific channels today?
Say which channels (e.g. "focus on #preview and #experience-builder")
or "no focus" to use your configured channels as-is.
```

- If the user names channels → write focus file (Step 8)
- If user says "no" / "no focus" / "use defaults" → delete `~/.claude/office-slack-focus.json` if it exists, confirm "Pulse will use your configured channels."
- If user says nothing or "skip" → leave focus file unchanged

## Step 8: Write focus file (only if requested)

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

Channels listed here must come from the configured `slack_channels` list. If the user names a channel not in the list, tell them it is not in their config and ask to confirm adding it.

## Step 9: Write state

Write `~/.claude/office-morning-brief.state.json`:

```json
{"last_run": "{ISO_NOW}"}
```

## Step 10: Done

Output:

```
Morning brief complete.
Pulse channels: {source description}
Run /loop 1h /office:pulse to start monitoring.
```

Where `{source description}` is one of:
- `focus override: #channel1, #channel2` — if focus file was written
- `project config (.claude/office-pulse.local.md)` — if a project config exists in cwd
- `global config (N channels)` — otherwise
