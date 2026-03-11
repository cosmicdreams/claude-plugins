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
allowed-tools: Bash, Read, Write
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

Parse these top-level fields:
- `enabled` — if `false`, output "office:pulse is disabled." and stop
- `jira.projects` — list of project codes
- `email_source` — `gmail` (only supported value)
- `priority_threshold` — `low` / `medium` / `high` / `critical` (default: `medium`)
- `slack.keywords` — global keywords to watch across all workspaces (case-insensitive)
- `slack.workspaces` — list of workspace objects, each with `url`, `name`, `channels`, and optional `keywords`

For each workspace, the effective keyword list = global `slack.keywords` ∪ workspace-level `keywords`.

If `slack.workspaces` is empty or missing, Slack will be skipped (noted in output).

### Project config detection

Check for `.claude/office-pulse.json` in the current working directory:

```bash
[ -f .claude/office-pulse.json ] && cat .claude/office-pulse.json
```

If found, parse `slack.workspaces`. Compare to the active config in `~/.claude/office-pulse.json`.
If different, note in output header:
```
[project config available — say "use project channels" to switch]
```
Do NOT automatically apply. Apply only when the user explicitly asks (e.g. "use project channels").
When switching, merge project `slack.workspaces` into `~/.claude/office-pulse.json` with
`updated_by: "project-switch"`.

Also parse from project config:
- `jira.server` — alternate Jira instance URL (e.g. `https://acme.atlassian.net`). Store for Step 3.
- `jira.config_file` — path to alternate jira-cli config. Expand `~` to `$HOME`.
- `jira.projects` — project codes for the alternate instance, fetched using `jira.config_file`.

If `jira.config_file` is set but the file does not exist, skip project Jira with note:
`[project Jira: config not found at {path} — run: JIRA_CONFIG_FILE={path} jira init]`

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

Fetch projects from two sources, running in parallel where possible:

**Global projects** (from `~/.claude/office-pulse.json` `jira.projects`, using default jira-cli config):

```bash
jira issue list --project {PROJECT} --updated-after "{last_run_ts}" --plain --columns KEY,SUMMARY,STATUS,PRIORITY,UPDATED,ASSIGNEE
```

**Project-local projects** (from `.claude/office-pulse.json` `jira.projects`, using `jira.config_file`):

```bash
JIRA_CONFIG_FILE={expanded_jira_config_file} jira issue list --project {PROJECT} --updated-after "{last_run_ts}" --plain --columns KEY,SUMMARY,STATUS,PRIORITY,UPDATED,ASSIGNEE
```

If `last_run_ts` is unknown (first run), use 24h ago:

```bash
date -v-24H +"%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -d '24 hours ago' +"%Y-%m-%dT%H:%M:%S"
```

For issues assigned to you or where you are mentioned, also fetch comment counts:

```bash
[JIRA_CONFIG_FILE={path}] jira issue view {KEY} --plain --comments 5
```

Label project-local issues in output with the `jira.server` hostname (e.g. `[acme.atlassian.net]`).

If `jira` is not available, skip with note: `[jira unavailable]`

If both email and Jira are unavailable, output:
```
PULSE {HH:MM} — all sources unavailable (email: gws not found / Jira: jira not found)
```
Then stop — do not write state.

### Slack

If `slack.workspaces` is empty, skip Slack with note:
`[slack: no workspaces configured — add a workspace to office-pulse.json to start tracking]`

Otherwise:

1. Auth check:
   ```bash
   agent-slack auth whoami
   ```
   If `agent-slack` not found or auth fails, skip with note: `[slack: agent-slack unavailable]`

2. Get your user ID from `agent-slack auth whoami` output (look for `user_id` or `id` field).

3. For each workspace in `slack.workspaces`, iterate over its `channels`. Fetch sequentially per workspace
   (rate limit caution — parallel across workspaces is fine, sequential within a workspace):
   ```bash
   agent-slack message list <channel> --workspace <workspace_url> --limit 50
   ```
   Skip channels that error with a note.

4. Filter: keep messages with `ts` > `slack_channels["{workspace_host}/{channel}"]` from state.
   On first run, keep all messages.

5. Classify each new message using the effective keywords for that workspace:
   - **DM**: channel name is `directmessage` or `im`
   - **@mention**: `text` contains `<@{your_user_id}>`
   - **Thread reply**: `thread_ts` set, `thread_ts` != `ts`, `thread_ts` matches a `ts` from your prior messages
   - **Keyword match**: `text` contains any keyword in global `slack.keywords` ∪ workspace `keywords`
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
  → [High] @mention from {user} in #{channel} ({workspace}): "{excerpt}"
  → [Medium] keyword "{keyword}" in #{channel} ({workspace}): "{excerpt}"
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

## Modifying config mid-session

When the user asks to change channels or keywords, update `~/.claude/office-pulse.json` in place,
preserving all other fields. Update `updated` and `updated_by` on every write.

Examples:
- "add #javascript to Drupal" → find workspace with `name: "Drupal"` (or matching URL), append to `channels`
- "remove #preview from Drupal" → remove from that workspace's `channels`
- "add keyword 'deploy' to My Team workspace" → add to that workspace's `keywords` array
- "use project channels" → merge project `.claude/office-pulse.json` workspaces into main config

Confirm each change: "Updated. [Workspace] now tracks: #ch1, #ch2, #ch3"

## Running on a loop

To run every hour:

```
/loop 1h /office:pulse
```

Cancel with `CronDelete` using the job ID returned by `/loop`.

**First run:** if no state file exists, all current data is treated as "new." The first
broadcast will be verbose — subsequent runs show only what changed.
