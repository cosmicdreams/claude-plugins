# Step 2 — Fetch Slack: Spawn Per-Channel Subagents

Spawn one subagent per Slack channel, all simultaneously. Wait for all to return
before proceeding to Jira fetch.

## Goal

Surface Slack items that need your attention today — not just what's new, but
anything unresolved that you should act on. Two passes:

1. **Overnight pass**: messages since last_run (new activity)
2. **Unanswered pass**: recent messages (last 48h) where someone asked a question
   or requested help and got no reply — these are standing obligations

## Per-channel subagent prompt

(Substitute values for each channel)

```
You are a READ-ONLY data collection agent for workshop:prioritize. Fetch Slack
messages and identify items that need the user's attention TODAY.
Do not narrate or explain. Do NOT post messages, react, or write to Slack in any way.

CHANNEL: {channel_name}
WORKSPACE_URL: {workspace_url}
WORKSPACE_NAME: {workspace_name}
WORKSPACE_KEYWORDS: {keywords array for this workspace, or []}
OLDEST_TS: {oldest_ts}
YOUR_USER_ID: {your_user_id, or null}

INSTRUCTIONS:

**Pass 1 — Overnight activity (new since last check):**
  agent-slack message list {channel_name} --workspace {workspace_url} \
    --oldest {oldest_ts} --limit 20

**agent-slack quirk:** When no messages match the --oldest filter, agent-slack returns
`{ "channel_id": "C..." }` with NO `messages` key. This is NOT an error — it means
the channel had no activity since the cutoff. Treat a missing `messages` key as
an empty array, not a failure.

**Pass 2 — Unanswered requests (standing obligations):**
If Pass 1 returned fewer than 10 messages, also fetch recent history to find
unanswered items:
  agent-slack message list {channel_name} --workspace {workspace_url} --limit 30

Scan these messages for unanswered questions or requests — messages that:
  - Ask a question ("can someone", "does anyone know", "?") with no thread reply
  - Request action ("please", "need", "can you", "when will") with no follow-up
  - Tag someone (including <@{YOUR_USER_ID}>) without a response in the thread
Only include items from the last 48 hours that remain unanswered.

**Build priority items.** Each item has:
  - action: one of RESPOND, REVIEW, FYI
  - source: "{workspace_name} #{channel_name}"
  - summary: one-line description of what needs attention
  - excerpt: relevant quote (keep under 120 chars)
  - stale: true if from Pass 2 (unanswered/standing), false if from Pass 1 (overnight)

**Action classification:**
  - RESPOND — message contains <@{YOUR_USER_ID}>, a direct question to you, or an
    urgent/unanswered request. If YOUR_USER_ID is null, classify as RESPOND if the
    message contains urgent language ("urgent", "asap", "can someone", "need help",
    "please look at", "blocking") or is an unanswered question.
  - REVIEW — keyword hit from WORKSPACE_KEYWORDS, or a message sharing a link/deploy/PR
    that implies review is needed.
  - FYI — general activity worth noting. Collapse low-signal activity into a single
    FYI summary item (e.g. "12 messages, 3 threads").

**Rules:**
  - Emit at most 5 items per channel. Prioritize RESPOND > REVIEW > FYI.
  - Unanswered items from Pass 2 should be RESPOND, not FYI — they need action.
  - If the channel has activity but nothing actionable, emit one FYI summary.
  - If the channel has no activity AND no unanswered items, emit nothing (empty items).
  - Do NOT duplicate: if a message appears in both passes, include it once.

Return ONLY valid JSON (no markdown):
{
  "workspace_name": "{workspace_name}",
  "channel": "{channel_name}",
  "error": null,
  "total_messages": 0,
  "items": [
    { "action": "RESPOND", "source": "...", "summary": "...", "excerpt": "...", "stale": false }
  ]
}
```

## Failure handling

If any channel subagent fails entirely, treat it as:
`{ "error": "subagent failed", "total_messages": 0, "items": [] }`

If ALL subagents return `{ "error": "agent-slack unavailable" }`, output:
```
Prioritize failed: agent-slack unavailable
Check agent-slack auth: agent-slack auth import-desktop
```
Then stop.

## Merge results

Collect all items from all channels into a flat list. Track which channels had
zero activity AND zero unanswered items (for the "Quiet" line).

Proceed to `steps/03-fetch-jira.md` with: slack_items list, quiet_channels list.
