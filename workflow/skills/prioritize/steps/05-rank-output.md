# Step 5 — Rank and Output

## Merge all items

Combine slack_items and jira_items into a single list. Each item has:
- `action`: RESPOND, UNBLOCK, REVIEW, or FYI
- `source`: where it came from (e.g. "Velir #ahri-support", "velir AHRIPS-769")
- `summary`: one-line description
- `excerpt` or `detail`: supporting context
- `stale`: true if a standing obligation, false if overnight

## Score and rank

Base score by action tier:

| Action  | Base Score |
|---------|-----------|
| RESPOND | 100       |
| UNBLOCK | 80        |
| REVIEW  | 40        |
| FYI     | 10        |

- **Stale bonus:** `stale: true` → +5 within tier (forgotten work sorts above fresh FYI of the same tier).
- Within the same tier and stale status, preserve subagent order (already recency/relevance-ranked).

These weights are the **default ranking function**. They are intended to live in
`workflow.json` under a `prioritize.weights` block so they can be tuned without editing this skill;
if that block is present, use it, otherwise use the table above.

## Choose the single NEXT action

The top-ranked item is the candidate for `NEXT:`. Adjust using availability (from step 4):

- If `availability` is known and `free_hours_today` is small (e.g. < 1h) or the `next_free_block` is
  short, prefer the highest-ranked item that **fits** the next free block — a quick RESPOND you can
  actually close beats a deep UNBLOCK you can't start before a meeting. Note the tradeoff in the why.
- If `availability: unknown`, just take the top-ranked item.

`NEXT:` is one action + a one-line why, and (when known) the capacity context.

## Output format (on-demand mode)

```
NEXT → [{action}] {source}: {summary}
       why: {one line} · you have ~{free_hours_today}h free before {next_meeting}

━━━ PRIORITIZE — {YYYY-MM-DD HH:MM} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 #   Action    Source                  Summary
 1   RESPOND   Velir #ahri-support     Unanswered question from @dev about tracking (2d ago)
 2   UNBLOCK   velir AHRIPS-769        Blocked: waiting on API credentials from client
 3   REVIEW    velir SPSX-536          Status changed: In Progress → Code Review
 ...

 Quiet: #pncb-support, #massport-support
 No items needing attention: KDRRCPS, PPS
 (work email/calendar: not connected)
 ⚠ ACU Jira not configured — run: jira init --config ~/.config/jira/acu.yml

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Output format (ambient `--loop` mode)

Delta-only and quiet. Surface only if the top item **changed** since last broadcast (compare to
state). Otherwise emit a single quiet line.

```
PRIORITIZE {HH:MM} — new top: [{action}] {source}: {summary} ({why})
```
or, when unchanged: `✓ PRIORITIZE {HH:MM} — top unchanged ({source})`

## Formatting rules

- **`NEXT:` always leads** in on-demand mode — one action, never a list.
- **Table is the secondary view.** Numbered, action-tagged, one line each. Action column left-aligned, padded to 8, no emoji.
- **Source column**: workspace+channel or server+issue key; truncate to 22 chars with ellipsis.
- **Summary**: one sentence; weave the excerpt in. For stale items include the wait ("2d ago", "In Progress 8 days").
- **Always print `(work email/calendar: not connected)`** while the Microsoft Graph slot is unconfigured, so the coverage gap stays visible.
- **Quiet line**: channels/projects with zero items needing attention.
- **Error line**: config issues with actionable fix commands, prefixed ⚠.
- **No items at all**: "Nothing needs your attention across any configured source. Clean slate."
- **Cap at 15 rows**; if more, show top 15 and note "{N} more items omitted."

Proceed to `steps/06-focus-update.md`.
