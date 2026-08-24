# Step 5 — Rank and Output

## Merge all items

Combine slack_items and jira_items into a single list. Each item has:
- `action`: RESPOND, UNBLOCK, REVIEW, or FYI
- `scope`: "sprint", "release", or "backlog" (Jira items only; Slack items have none)
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

Then apply the **scope modifier**, which is the dominant signal for Jira items:

| Scope     | Modifier | Meaning                                              |
|-----------|----------|------------------------------------------------------|
| sprint    | +30      | Committed in the current sprint                       |
| release   | +20      | Attached to an unreleased fix version                 |
| backlog   | −30      | Assigned but never planned into a sprint or release   |
| (none)    | 0        | Slack items and anything without scope data           |

The modifier is deliberately large enough to reorder across a tier: an in-sprint REVIEW
(40+30=70) outranks a backlog UNBLOCK (80−30=50). That is the intent — planned work the
team is counting on beats an old assignment nobody scheduled.

**Guardrail:** never let the backlog penalty push a RESPOND or UNBLOCK item off the
table entirely. Someone waiting on a reply, or work blocking another person, is a real
obligation regardless of sprint membership. Apply the penalty to ordering only; these
items still appear.

- **Stale bonus:** `stale: true` → +5 within tier (forgotten work sorts above fresh FYI of the same tier).
- Within the same tier, scope, and stale status, preserve subagent order (already recency/relevance-ranked).

These weights are the **default ranking function**. They are intended to live in
`workshop.json` under a `prioritize.weights` block so they can be tuned without editing this skill;
if that block is present, use it, otherwise use the table above. The scope modifiers live
under `prioritize.weights.scope` and can be tuned the same way — set them all to 0 to
restore the old assignee-queue-only behavior.

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

 #   Action    Scope     Source                  Summary
 1   RESPOND   sprint    velir PPS-333           Client asked 4 questions on 7/01 — still unanswered
 2   UNBLOCK   sprint    velir AHRIPS-769        Blocked: waiting on credentials from client
 3   REVIEW    sprint    velir KDRRCPS-44        QA Rejected — 4 open questions before more code
 4   RESPOND   backlog   Velir #ahri-support     Unanswered question from @dev about tracking (2d ago)
 ...

 Committed: 31 in sprint · 1 in unreleased version
 Unplanned backlog: 46 assigned but in no sprint or release (22 Massport, 9 PNCB) — not ranked above
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
- **Scope column**: `sprint`, `release`, `backlog`, or blank for Slack items. Padded to 8.
- **Source column**: workspace+channel or server+issue key; truncate to 22 chars with ellipsis.
- **Summary**: one sentence; weave the excerpt in. For stale items include the wait ("2d ago", "In Progress 8 days").
- **Always print `(work email/calendar: not connected)`** while the Microsoft Graph slot is unconfigured, so the coverage gap stays visible.
- **Committed line**: counts of sprint and release items, so the user sees the size of the real commitment.
- **Unplanned backlog line**: total assigned issues in no sprint or release, with the worst
  offending projects named. Print this whenever the count is non-zero — a large number here
  is itself the finding (it means the assignee queue has drifted from what is planned), and
  silently dropping those items would read as "you have nothing else on."
- **Quiet line**: channels/projects with zero items needing attention.
- **Error line**: config issues with actionable fix commands, prefixed ⚠.
- **No items at all**: "Nothing needs your attention across any configured source. Clean slate."
- **Cap at 15 rows**; if more, show top 15 and note "{N} more items omitted."

Proceed to `steps/06-focus-update.md`.
