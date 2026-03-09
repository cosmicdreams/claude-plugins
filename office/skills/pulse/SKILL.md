---
name: pulse
description: Ambient priority watchdog — scans email, Jira, and Slack for what needs your attention right now. Outputs two views: (1) top priority, (2) what changed since last broadcast. Designed to run hourly via /loop. Requires ~/.claude/office-pulse.local.md config. Trigger phrases: "pulse check", "what needs attention", "priority check", "office:pulse".
triggers:
  - "pulse check"
  - "what needs attention"
  - "priority check"
  - "office:pulse"
  - "anything urgent"
  - "check pulse"
  - "what's new"
allowed-tools: Bash, Read, Write
---

# office:pulse — Ambient Priority Watchdog

Scan email, Jira, and Slack, compute what changed since last run, surface the top priority.

## Step 1: Load config

### Static config (always from ~/.claude/office-pulse.local.md)

Read `~/.claude/office-pulse.local.md`. If the file does not exist, output:

```
office:pulse is not configured.
Create ~/.claude/office-pulse.local.md — see references/config-template.md for the template.
```

Then stop.

Parse frontmatter fields:
- `enabled` — if `false`, output "office:pulse is disabled." and stop
- `jira_projects` — list of project codes
- `email_source` — `gmail` (only supported value)
- `priority_threshold` — `low` / `medium` / `high` / `critical` (default: `medium`)
- `slack_default_workspace` — default Slack workspace URL (e.g. `https://drupal.slack.com`)
- `slack_keywords` — list of keywords to watch for in Slack messages (case-insensitive)
- `slack_channels` — initial channel list; used only to seed `office-pulse.json` on first run

### Runtime channel config (source of truth: ~/.claude/office-pulse.json)

Read `~/.claude/office-pulse.json`.

**If the file does not exist:** seed it from `slack_channels` in `office-pulse.local.md`:

```bash
python3 << 'EOF'
import json, os
from datetime import datetime

# Populate `channels` from the parsed slack_channels list in .local.md
channels = []  # agent fills this from parsed .local.md slack_channels

seed = {
    "updated": datetime.now().isoformat(),
    "updated_by": "pulse-init",
    "slack_channels": channels
}
path = os.path.expanduser("~/.claude/office-pulse.json")
with open(path, "w") as f:
    json.dump(seed, f, indent=2)
print(f"Seeded {path} from local config ({len(channels)} channels).")
EOF
```

Then read it back.

**If the file exists:** read `slack_channels` from it — this is the authoritative list for this run.

### Project config detection

Check for `.claude/office-pulse.local.md` in the current working directory:

```bash
[ -f .claude/office-pulse.local.md ] && cat .claude/office-pulse.local.md
```

If found, parse its `slack_channels`. Compare to the current `office-pulse.json` channels.
If they differ, note in output header:
```
[project config available — say "use project channels" to switch]
```

Do NOT automatically apply the project config. Apply only when the user explicitly asks
(e.g. "use project channels", "switch to project config"). When switching, write the project
`slack_channels` into `~/.claude/office-pulse.json` with `updated_by: "project-switch"`.

## Step 2: Load previous state

Read the last line of `~/.claude/office-pulse.state.jsonl` (if it exists):

```bash
tail -1 ~/.claude/office-pulse.state.jsonl 2>/dev/null
```

Parse as JSON. Fields:
- `ts` — ISO timestamp of last run
- `email_last_id` — most recent email message ID seen
- `jira_snapshots` — object mapping issue key → `{ comments, status, updated }`
- `slack_channels` — object mapping `"workspace_host/channel"` → last seen Slack `ts`

If the file does not exist or is empty, treat as first run — all current data is "new."

## Step 3: Fetch current data

Run all fetches in parallel where possible.

### Email (Gmail)

```bash
gws mail list --unread --limit 20 --format json
```

Extract: message IDs, subjects, senders, received timestamps, priority/urgent signals
(subject contains "urgent", "action required", "approval needed", or flagged by sender).

If `gws` is not available or auth fails, skip with note: `[email unavailable]`

### Jira

For each project in `jira_projects`:

```bash
jira issue list --project {PROJECT} --updated-after "{last_run_ts}" --plain --columns KEY,SUMMARY,STATUS,PRIORITY,UPDATED,ASSIGNEE
```

If `last_run_ts` is unknown (first run), use 24h ago:

```bash
date -v-24H +"%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d '24 hours ago' +"%Y-%m-%dT%H:%M:%S"
```

For issues assigned to you or where you are mentioned, also fetch comment counts:

```bash
jira issue view {KEY} --plain --comments 5
```

If `jira` is not available, skip with note: `[jira unavailable]`

If both email and Jira are unavailable, output:
```
PULSE {HH:MM} — all sources unavailable (email: gws not found / Jira: jira not found)
```
Then stop — do not write state.

### Slack

If `slack_channels` in `office-pulse.json` is empty, skip Slack with note:
`[slack: no channels — say "add #channel" to start tracking]`

Otherwise:

1. Auth check:
   ```bash
   agent-slack auth whoami
   ```
   If `agent-slack` not found or auth fails, skip with note: `[slack: agent-slack unavailable]`

2. Get your user ID from `agent-slack auth whoami` output (look for `user_id` or `id` field).

3. For each entry in `slack_channels`, use entry's `workspace` if set, else `slack_default_workspace`:
   ```bash
   agent-slack message list <channel> --workspace <workspace> --limit 50
   ```
   Run fetches sequentially (rate limit caution). Skip channels that error with a note.

4. Filter: keep messages with `ts` > `slack_channels["host/channel"]` from state.
   On first run, keep all messages.

5. Classify each new message:
   - **DM**: channel name is `directmessage` or `im`
   - **@mention**: `text` contains `<@{your_user_id}>`
   - **Thread reply**: `thread_ts` set, `thread_ts` != `ts`, `thread_ts` matches a `ts` from your prior messages
   - **Keyword match**: `text` contains any `slack_keywords` entry (case-insensitive)
   - **General**: any other new message

## Step 4: Compute deltas

**Email delta:** Messages with IDs not seen in previous state.

**Jira delta:** Issues where `updated` is after `last_run_ts`, or comment count increased vs snapshot.

**Slack delta:** Messages with `ts` > last seen per channel (from state `slack_channels`).

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
  slack: #{channel1}, #{channel2}  (set {N}m ago by {updated_by})
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
  → [High] @mention from {user} in #{channel}: "{excerpt}"
  → [Medium] keyword "{keyword}" in #{channel}: "{excerpt}"
  → [or: no Slack activity]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If nothing has changed across all sources: output a single line —
`✓ PULSE {HH:MM} — nothing new since {last broadcast time}`

## Step 7: Write new state

Append one line to `~/.claude/office-pulse.state.jsonl`:

```json
{"ts":"{ISO_NOW}","email_last_id":"{most_recent_id}","jira_snapshots":{"{KEY}":{"comments":{N},"status":"{status}","updated":"{ts}"}},"slack_channels":{"drupal.slack.com/preview":"{most_recent_ts}","drupal.slack.com/experience-builder":"{most_recent_ts}"}}
```

`slack_channels` key: `"{workspace_hostname}/{channel_name}"` → most recent message `ts` seen.

Then trim the file to the last 7 days of entries:

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
kept = []
for line in lines:
    try:
        entry = json.loads(line)
        if entry.get("ts", "") >= cutoff:
            kept.append(line)
    except Exception:
        pass
with open(path, "w") as f:
    f.write("\n".join(kept) + ("\n" if kept else ""))
print(f"Trimmed state: kept {len(kept)} entries (7-day window).")
EOF
```

## Modifying the channel list mid-session

When the user asks to change channels (e.g. "add #javascript", "remove #preview",
"switch to #css and #theming", "use project channels"), update `~/.claude/office-pulse.json`:

```json
{
  "updated": "{ISO_NOW}",
  "updated_by": "user",
  "slack_channels": [
    { "workspace": "https://drupal.slack.com", "channel": "javascript" }
  ]
}
```

Confirm: "Updated. Pulse will now track: #javascript"

To reset channels to defaults: say "reset slack channels" — agent reads `slack_channels`
from `~/.claude/office-pulse.local.md` and writes them into `office-pulse.json`.

## Running on a loop

To run every hour:

```
/loop 1h /office:pulse
```

Cancel with `CronDelete` using the job ID returned by `/loop`.
