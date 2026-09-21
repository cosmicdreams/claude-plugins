# Step 5 — Rank and Output

## Merge all items

Combine slack_items and jira_items into a single list. Each item has:
- `action`: RESPOND, DUE, UNBLOCK, REVIEW, or FYI
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
| DUE     | 90        |
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

**Guardrail:** never let the backlog penalty push a RESPOND, UNBLOCK, or due-today/overdue item off the
table entirely. Someone waiting on a reply, or work blocking another person, is a real
obligation regardless of sprint membership. Apply the penalty to ordering only; these
items still appear.

- **Stale bonus:** `stale: true` → +5 within tier (forgotten work sorts above fresh FYI of the same tier).
- **Overdue bonus:** +15 only for action DUE with due_date strictly before local TODAY.
  Due dates survive deduplication even if RESPOND becomes the action. Deadline retention
  is independent of score: DUE90 does not always outrank RESPOND100, especially after scope.
  No extra dependency override is introduced; use the actual resulting scores.
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

## Canonical result and artifacts

Do not independently assemble terminal, JSON and HTML data. Write one input JSON into
`${data_path}/workshop-prioritize.input.json` and run:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/prioritize/scripts/output.py" \
  "${data_path}/workshop-prioritize.input.json" --data-path "${data_path}"
```

Input contract (all collection is performed by the earlier steps, not the script):

```json
{
  "generated_at": "2026-08-24T15:00:00Z",
  "today": "2026-08-24",
  "mode": "on-demand",
  "items": [
    {"id":"velir:PPS-333","server_name":"velir","project":"PPS",
     "action":"RESPOND","scope":"sprint","source":"velir PPS-333",
     "summary":"Reply to the client","detail":"Four unanswered questions",
     "stale":true,"due_date":"2026-08-24",
     "url":"https://velir.atlassian.net/browse/PPS-333"}
  ],
  "counts":{"committed_sprint":31,"committed_release":1,"unplanned_backlog":46,
            "unplanned_backlog_by_project":{"velir:MWS":22,"velir:PPS":24}},
  "quiet_sources":[],
  "no_attention_sources":[],
  "errors":[],
  "coverage":{"slack":"connected","jira":"connected","calendar":"unknown",
              "work_calendar":"not_connected","work_email":"not_connected"},
  "availability":{"free_hours_today":null,"next_meeting":null,"next_free_block":null,
                  "work_calendar":"not_connected"},
  "why":"Highest-ranked committed request"
}
```

Supply all attention candidates, not all assigned issues and not just the display quota.
Jira IDs include the server; Slack IDs include workspace, channel ID and message ts.
Use null scope/project/server_name/due_date/url for Slack unless a verified value is
available. Merge duplicates before invoking the helper, preserving deadline and context;
it rejects duplicate IDs. Use `today` in the user's local timezone, generated_at in UTC.
Counts are complete workload counts from Pass 0 scope sets and Pass 2 assigned
workload, not candidate counts. Use the step 3 coordinator's merged counts without
refetching or inference from attention-only candidates. Qualify project keys
with server names to avoid collisions. `quiet_sources` are Slack channels and
`no_attention_sources` are successfully checked Jira projects quiet across both passes.
Coverage values are `connected`, `partial`, `unavailable`, `not_configured`,
`not_connected`, or `unknown`, based on actual fetches. A working Google calendar
does not imply a connected work calendar. Partial source errors remain in `errors`;
never label failed or unexamined sources quiet. Pagination/fetch limitations must be
reported, never presented as a fully observed workload.

Optional `weights` is the config's `prioritize.weights` object (action keys plus `scope`).
The helper applies the existing scope modifiers, stale +5, DUE-overdue +15 and stable ties.
Optional `next_id` selects the capacity-adjusted NEXT from the ranked candidates; explain
the tradeoff in `why`. Do not reorder items to match it.

The helper validates input before publication. Required strings are generated_at
(UTC ISO timestamp), today (YYYY-MM-DD), mode (on-demand or ambient), and each
item's id, action and source/summary. Optional detail/excerpt/why/next_id are strings;
scope is sprint/release/backlog or null, project/server_name/url are strings or null,
due_date is YYYY-MM-DD or null, and stale/overdue are booleans when supplied.
Items and quiet_sources/no_attention_sources/errors are lists (the latter three
contain strings and default to empty). Counts require all four fields above:
nonnegative integer totals and a server:project map of nonnegative integers summing
to unplanned_backlog. Coverage requires all five source keys above with the documented
status values. Weights are finite numbers, never booleans, under action keys or
scope.sprint/release/backlog.
Availability may be absent, null, "unknown", or an object; empty/missing capacity
fields normalize to null. Known free_hours_today is a finite nonnegative number;
next_meeting is null or {title: string, start: ISO timestamp with UTC offset};
next_free_block is null or {start: ISO timestamp with UTC offset, minutes:
nonnegative integer}. work_calendar is connected or not_connected (default).
All three outputs, including terminal text, are rendered before either artifact
is replaced. Each replacement is atomic, but the two files are not a transaction.

The helper emits schema_version 1: generated_at, mode, next (ranked item + why or null),
items (full ranked items including id, rank, score, scope, due_date, overdue, mandatory),
omitted_count (always 0), counts, quiet_sources, no_attention_sources, errors, coverage,
availability, and display (item_ids, omitted_count, backlog_suppressed).
Unknown availability is always an object with null capacity fields.

Display selection is scope-first for five ordinary Jira candidates per server/project;
RESPOND, UNBLOCK and due-today/overdue candidates bypass that quota and the 15-row cap.
NEXT also remains visible. Final display order always follows canonical rank. The
snapshot retains every candidate, including display-suppressed backlog.

On-demand only, the helper atomically replaces each local artifact under data_path:
`workshop-prioritize.snapshot.json` and `workshop-prioritize.brief.html`. The same result
drives terminal output, the uncapped snapshot and the HTML template with a text-only
queue filter. Untrusted text is HTML-escaped and links allow only HTTP(S); no remote
fonts/scripts are loaded. After successful rendering, open the brief with `open` on
macOS or `xdg-open` on Linux if a desktop opener is available; otherwise show its path.
If writing fails, report it rather than claiming the artifact is fresh.

Ambient mode never replaces either artifact. Its helper output is internal JSON for
the existing state comparison below, not a full table to broadcast. Do not change loop
registration or mode detection as part of this pipeline. Full on-demand runs with
source failures record partial coverage; "uncapped" does not mean every source succeeded.

## Output format (on-demand mode)

```
NEXT → [{action}] {source}: {summary}
       why: {one line} · you have ~{free_hours_today}h free before {next_meeting}

━━━ PRIORITIZE — {YYYY-MM-DD HH:MM} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 #   Action    Scope     Source                  Summary
 1   RESPOND   sprint    velir PPS-333           Client asked 4 questions on 7/01 — still unanswered
 2   UNBLOCK   sprint    velir AHRIPS-769        Blocked: waiting on credentials from client
 3   REVIEW    sprint    velir KDRRCPS-44        QA Rejected — 4 open questions before more code
 4   RESPOND             Velir #ahri-support     Unanswered question from @dev about tracking (2d ago)
 ...

 Committed: 31 in sprint · 1 in unreleased version
 Unplanned backlog: 46 assigned but in no sprint or release (22 Massport, 9 PNCB)
 Quiet: #pncb-support, #massport-support
 No items needing attention: KDRRCPS, PPS
 (work email/calendar: not connected)
 ⚠ ACU Jira unreachable — check the acu site in workshop:config (api-token auth needs JIRA_API_TOKEN)

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

- **Use the concise output style.** This skill's entire value is compressing a wide
  signal sweep into something a low-focus person can act on. Do not restate the plan
  in prose after the table, do not explain your gathering process, do not add a
  closing summary. The `NEXT:` line and the table ARE the output. If the host sets a
  verbose output style, this instruction still wins — a long day-plan defeats the
  skill's purpose, because a wall of text is the activation paralysis it exists to
  prevent.
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
- **Default 15 rows**, extended to retain every mandatory obligation and NEXT; report
  the actual display omitted count. Never cap the snapshot.

Proceed to `steps/06-focus-update.md`.
