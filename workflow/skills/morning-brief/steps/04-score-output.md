# Step 4 — Score and Output

## Score Slack channels

For each channel in the merged Slack results:

```
score = (mention_count × 3) + (keyword_hits × 2) + (thread_replies × 2) + floor(total_messages / 5)
```

Sort descending by score within each workspace.

## Score Jira servers

For each server in the merged Jira results:

```
score = (blocked × 4) + (assigned_to_me × 2) + (new_comments × 2) + (status_changes × 1)
```

## Output format

```
━━━ MORNING BRIEF — {YYYY-MM-DD} ━━━━━━━━━━━━━━━━━━━━━━━

OVERNIGHT SLACK (since {last_run_time})
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

OVERNIGHT JIRA (since {last_run_date})
Scanned {P} projects across {S} servers · {total_updated} updated issues

{ServerName}
  Blocked:
    PROJ-123  {summary} — {reason}
  Assigned to me:
    PROJ-456  {summary}  [{status}]
  New comments:
    PROJ-789  {summary} — @{commenter}: "{excerpt}"
  Status changes:
    PROJ-012  {summary}  {from} → {to}
  No activity: PROJECT1, PROJECT2

{ServerName2}
  ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Show Slack channels with activity ranked by score within each workspace.
List zero-activity channels as "Quiet: ..." per workspace.

Show Jira sections in priority order: blocked, assigned, comments, status changes.
List zero-activity projects as "No activity: ..." per server.

If no Slack activity: "No overnight Slack activity."
If no Jira activity or Jira not configured: omit the Jira section entirely.

Proceed to `steps/05-focus-update.md`.
