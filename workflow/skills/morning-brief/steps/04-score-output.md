# Step 4 — Score and Output

## Merge all items

Combine slack_items and jira_items into a single list. Each item has:
- `action`: RESPOND, UNBLOCK, REVIEW, or FYI
- `source`: where it came from (e.g. "Velir #ahri-support", "velir AHRIPS-769")
- `summary`: one-line description
- `excerpt` or `detail`: supporting context

## Score and rank

Assign a numeric score to each item by action tier:

| Action  | Base Score |
|---------|-----------|
| RESPOND | 100       |
| UNBLOCK | 80        |
| REVIEW  | 40        |
| FYI     | 10        |

Within the same tier, preserve the order returned by subagents (which already
prioritizes by recency/relevance).

Sort all items descending by score. This produces a single priority-ordered list
across all sources.

## Output format

```
━━━ MORNING BRIEF — {YYYY-MM-DD} ━━━━━━━━━━━━━━━━━━━━━━━

 #   Action    Source                  Summary
 1   RESPOND   Velir #ahri-support     @dev asked you to look at the GTM tracking issue on prod
 2   UNBLOCK   velir AHRIPS-769        Blocked: waiting on API credentials from client
 3   REVIEW    velir MWS-411           Status changed: In Progress → Code Review
 4   REVIEW    velir SPSX-536          New comment from @miguel: "deploy is ready for QA"
 5   FYI       Velir #ahri-support     20 messages, 5 threads overnight
 6   FYI       Drupal #groups-drupal…  3 messages about initiative roadmap

Quiet: #_pncb-support-group, #massport-support, #_kellogg-drrc-support
No overnight changes: KDRRCPS, PPS
⚠ ACU Jira not configured — run: jira init --config ~/.config/jira/acu.yml

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Formatting rules

- **Table is the primary output.** Numbered, action-tagged, one line per item.
- **Action column is left-aligned**, padded to 8 chars. Use the action name as-is
  (RESPOND, UNBLOCK, REVIEW, FYI) — no emoji, no color codes.
- **Source column**: workspace name + channel/issue key. Truncate to 22 chars with
  ellipsis if needed.
- **Summary column**: one sentence max. If an excerpt exists, weave it in naturally
  rather than showing it separately.
- **Quiet line**: list channels and projects with zero overnight activity on one line.
- **Error line**: show config issues (e.g. unconfigured Jira servers) with actionable
  fix commands, prefixed with ⚠.
- **No items at all**: "No overnight activity across any configured source."
- **Cap at 15 rows.** If more items exist, show top 15 and note "{N} more items omitted."

Proceed to `steps/05-focus-update.md`.
