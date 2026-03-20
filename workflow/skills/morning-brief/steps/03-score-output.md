# Step 3 — Score and Output

## Score channels

For each channel in the merged results:

```
score = (mention_count × 3) + (keyword_hits × 2) + (thread_replies × 2) + floor(total_messages / 5)
```

Sort descending by score within each workspace.

## Output format

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

Proceed to `steps/04-focus-update.md`.
