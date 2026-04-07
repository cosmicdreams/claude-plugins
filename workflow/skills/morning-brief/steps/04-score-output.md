# Step 4 — Score and Output

## Merge all items

Combine slack_items and jira_items into a single list. Each item has:
- `action`: RESPOND, UNBLOCK, REVIEW, or FYI
- `source`: where it came from (e.g. "Velir #ahri-support", "velir AHRIPS-769")
- `summary`: one-line description
- `excerpt` or `detail`: supporting context
- `stale`: true if this is a standing obligation, false if overnight

## Score and rank

Assign a numeric score to each item by action tier:

| Action  | Base Score |
|---------|-----------|
| RESPOND | 100       |
| UNBLOCK | 80        |
| REVIEW  | 40        |
| FYI     | 10        |

**Stale bonus:** items with `stale: true` get +5 within their tier. Standing
obligations that haven't been addressed should sort above fresh FYI items of the
same tier, since they represent forgotten work.

Within the same tier and stale status, preserve the order returned by subagents
(which already prioritizes by recency/relevance).

Sort all items descending by score. This produces a single priority-ordered list
across all sources.

## Output format

```
━━━ MORNING BRIEF — {YYYY-MM-DD} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 #   Action    Source                  Summary
 1   RESPOND   Velir #ahri-support     Unanswered question from @dev about GTM tracking (2d ago)
 2   UNBLOCK   velir AHRIPS-769        Blocked: waiting on API credentials from client
 3   RESPOND   velir MWS-411           New comment from @miguel asking for your review
 4   REVIEW    velir SPSX-536          Status changed: In Progress → Code Review
 5   REVIEW    velir KDRRCPS-42        In Progress for 8 days with no update — stale?
 6   FYI       Velir #ahri-support     5 new messages overnight, 2 threads

Quiet: #_pncb-support-group, #massport-support, #_kellogg-drrc-support
No items needing attention: KDRRCPS, PPS
⚠ ACU Jira not configured — run: jira init --config ~/.config/jira/acu.yml

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Formatting rules

- **Table is the primary output.** Numbered, action-tagged, one line per item.
- **Action column is left-aligned**, padded to 8 chars. Use the action name as-is
  (RESPOND, UNBLOCK, REVIEW, FYI) — no emoji, no color codes.
- **Source column**: workspace name + channel/issue key. Truncate to 22 chars with
  ellipsis if needed.
- **Summary column**: one sentence max. If an excerpt exists, weave it in naturally
  rather than showing it separately. For stale items, include how long they've been
  waiting (e.g. "2d ago", "In Progress for 8 days").
- **Quiet line**: list channels and projects with zero items needing attention.
- **Error line**: show config issues (e.g. unconfigured Jira servers) with actionable
  fix commands, prefixed with ⚠.
- **No items at all**: "Nothing needs your attention across any configured source. Clean slate."
- **Cap at 15 rows.** If more items exist, show top 15 and note "{N} more items omitted."

Proceed to `steps/05-focus-update.md`.
