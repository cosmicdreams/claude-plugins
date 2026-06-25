# Step 5 — Rank and Output

## Merge all items

Combine slack_items and jira_items into a single list. Each item has:
- `action`: RESPOND, DUE, UNBLOCK, REVIEW, or FYI
- `source`: where it came from (e.g. "Velir #ahri-support", "velir AHRIPS-769")
- `summary`: one-line description
- `excerpt` or `detail`: supporting context
- `stale`: true if a standing obligation, false if overnight

## Score and rank

Base score by action tier:

| Action  | Base Score |
|---------|-----------|
| RESPOND | 100       |
| DUE     | 90        |
| UNBLOCK | 80        |
| REVIEW  | 40        |
| FYI     | 10        |

- **Stale bonus:** `stale: true` → +5 within tier (forgotten work sorts above fresh FYI of the same tier).
- **Overdue bonus:** a `DUE` item whose deadline is already **past** (not just today) → +15. An overdue
  deadline outranks a fresh RESPOND — it is the one thing a missed day cannot undo.
- Within the same tier and stale status, preserve subagent order (already recency/relevance-ranked).

These weights are the **default ranking function**. They are intended to live in
`workshop.json` under a `prioritize.weights` block so they can be tuned without editing this skill;
if that block is present, use it, otherwise use the table above.

## Choose the single NEXT action

The top-ranked item is the candidate for `NEXT:`. Adjust using availability (from step 4):

- If `availability` is known and `free_hours_today` is small (e.g. < 1h) or the `next_free_block` is
  short, prefer the highest-ranked item that **fits** the next free block — a quick RESPOND you can
  actually close beats a deep UNBLOCK you can't start before a meeting. Note the tradeoff in the why.
- If `availability: unknown`, just take the top-ranked item.
- A `DUE` item that is due today/overdue **and** blocks other people (it gates a release, a
  build, or a teammate) is the strongest possible NEXT — say so in the why ("due today,
  blocks N people"). Deadline + dependency beats a high-tier item that can slip a day.

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

## Companion HTML brief (on-demand mode only)

The terminal `NEXT:` line stays — it is the glanceable answer. In **on-demand mode**, also
write a self-contained HTML brief and open it, so the full picture has a calm, branded home
instead of a wall of monospace. **Skip this in ambient (`--loop`) mode** — ambient stays quiet.

1. Render `assets/brief.template.html` (next to this skill) by substituting the placeholders:
   - `{{GENERATED_AT}}` — `YYYY-MM-DD HH:MM TZ`
   - `{{HERO_*}}` — action, source, summary, why, and the supporting tags for the NEXT item
   - `{{METRICS}}` — up to three lead metrics (e.g. deadline, people blocked, fix status); omit the strip if none apply
   - `{{QUEUE_ROWS}}` — the ranked table rows (number, action, what, where), capped at 15
   - `{{COVERAGE_NOTES}}` — quiet sources, the `(work email/calendar: not connected)` line, and any config-gap warnings
2. Write it to `~/.claude/workshop-prioritize.brief.html` (overwrite each run) and open it:
   `open ~/.claude/workshop-prioritize.brief.html` (macOS) / `xdg-open` (Linux).

**Brand:** if `~/.velir/DESIGN.md` exists, the brief MUST follow those tokens — flat (no drop
shadows or gradients), light surface, IBM Plex Sans, navy `#001B67` chrome, Velir Blue `#0051FF`
section headings, accent green `#00FF99` only as tiny punctuation. The template already encodes this.
**Never** signal an emphasized block with the 4px colored left-border "bracket" callout — color-block
the panel or use a top hairline + eyebrow label instead. If `~/.velir/DESIGN.md` is absent, render the
template as-is (it degrades to a clean neutral light theme). Do not invent a dark, glossy, gradient style.

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
- **Cap at 15 rows**; if more, show top 15 and note "{N} more items omitted." The same cap
  applies to the HTML brief's queue table.
- **Action column** order/padding includes DUE: pad to 8 (`RESPOND `, `DUE     `, `UNBLOCK `,
  `REVIEW  `, `FYI     `). In the HTML brief, DUE uses the critical-state color (Velir
  `severity-critical` / `#A1153A`); RESPOND uses Velir Blue; UNBLOCK amber; REVIEW muted.

Proceed to `steps/06-focus-update.md`.
