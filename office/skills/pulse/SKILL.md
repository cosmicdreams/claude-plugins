---
name: pulse
description: Ambient priority watchdog — scans email and Jira for what needs your attention right now. Outputs two views: (1) top priority, (2) what changed since last broadcast. Designed to run hourly via /loop. Requires ~/.claude/office-pulse.local.md config. Trigger phrases: "pulse check", "what needs attention", "priority check", "office:pulse".
triggers:
  - "pulse check"
  - "what needs attention"
  - "priority check"
  - "office:pulse"
allowed-tools: Bash, Read, Write
---

# office:pulse — Ambient Priority Watchdog

Scan email and Jira, compute what changed since last run, surface the top priority.

## Step 1: Load config

Read `~/.claude/office-pulse.local.md`. The config lives at user scope — not project-local — because pulse scans all your email and Jira regardless of which project you're in.

If the file does not exist, output:

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

## Step 2: Load previous state

Read the last line of `~/.claude/office-pulse.state.jsonl` (if it exists):

```bash
tail -1 ~/.claude/office-pulse.state.jsonl 2>/dev/null
```

Parse as JSON. Fields:
- `ts` — ISO timestamp of last run
- `email_last_id` — most recent email message ID seen
- `jira_snapshots` — object mapping issue key → `{ comments, status, updated }`

If the file does not exist or is empty, treat as first run — all current data is "new."

## Step 3: Fetch current data

Run all fetches in parallel where possible.

### Email (Gmail)

```bash
gws mail list --unread --limit 20 --format json
```

Extract: message IDs, subjects, senders, received timestamps, any priority/urgent signals (subject contains "urgent", "action required", "approval needed", flagged by sender).

If `gws` is not available or auth fails, skip email with a note: `[email unavailable]`

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

If `jira` is not available, skip with a note: `[jira unavailable]`

If both email and Jira are unavailable, output:
```
PULSE {HH:MM} — all sources unavailable (email: gws not found / Jira: jira not found)
```
Then stop — do not write state.

## Step 4: Compute deltas

**Email delta:** Messages with IDs not seen in previous state = new messages.

**Jira delta:** Issues where `updated` timestamp is after `last_run_ts`, or comment count increased vs snapshot.

## Step 5: Rank priorities

Score each item:

| Signal | Weight |
|---|---|
| Jira issue assigned to you, status = Blocked | Critical |
| Email subject contains urgent/approval/action required | High |
| Jira issue where you are mentioned in new comment | High |
| Jira issue status changed | Medium |
| New email from manager or key stakeholder | Medium |
| Jira comment on issue you're watching | Low |
| New unread email (general) | Low |

Filter to items at or above `priority_threshold`. Sort descending.

## Step 6: Output

```
━━━ PULSE — {HH:MM} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOP PRIORITY
→ [{source}] {summary} — {why it's top priority}

SINCE LAST BROADCAST ({N} minutes ago)
EMAIL
  → {N} new messages — {notable subjects}
  → [or: no new email]

JIRA
  → {KEY}: {what changed} ({project})
  → {KEY}: {what changed} ({project})
  → [or: no Jira activity]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If nothing has changed across all sources: output a single line —
`✓ PULSE {HH:MM} — nothing new since {last broadcast time}`

## Step 7: Write new state

Append one line to `~/.claude/office-pulse.state.jsonl`:

```json
{"ts":"{ISO_NOW}","email_last_id":"{most_recent_id}","jira_snapshots":{"{KEY}":{"comments":{N},"status":"{status}","updated":"{ts}"}}}
```

Then trim the file to the last 7 days of entries:

```bash
python3 scripts/trim-state.py
```

## Running on a loop

To run every hour:

```
/loop 1h /office:pulse
```

Cancel with `CronDelete` using the job ID returned by `/loop`.
