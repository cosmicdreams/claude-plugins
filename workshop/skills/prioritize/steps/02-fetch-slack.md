# Step 2 — Fetch Slack

Read Slack with the host's Slack connector, in the main thread. The connector is signed in to one workspace (resolved in step 1) and its calls are cheap, so there are no per-channel subagents. Make the per-channel reads in parallel.

This step is read-only: do not post, react, or write to Slack in any way, even though the connector can.

## Goal

Surface Slack items that need your attention today — not just what's new, but anything unresolved that you should act on. Two passes:

1. **Overnight pass**: messages since last_run (new activity)
2. **Unanswered pass**: recent messages (last 48h) where someone asked a question or requested help and got no reply — these are standing obligations

## Rules for every read

Ignore messages from bots and messages with no human author in both passes and the mention search; raw mention counts are not evidence of a human request. Resolve relative deadlines against the message timestamp in the user's local timezone, not the time it was read. An old message is not automatically urgent; retain a genuinely unresolved obligation, but do not revive expired informational reminders. Follow `cursor` through the applicable time window; if you stop early, report partial coverage rather than claiming completeness.

## Mentions and direct messages

The connector does not expose unread state, so search in its place. With `slack_search_public_and_private`, find messages since `oldest_ts` that mention the user (`<@{user_id}>` as a keyword) and messages sent to them directly (`channel_types: "im,mpim"`, `after` set to `oldest_ts`). Exclude configured channels (the channel reads own them). Summarize channel name, type and human message count before opening bodies. On-demand, classify unanswered human asks as standing obligations. Ambient, only classify messages newer than `oldest_ts`. Say in `errors` that unread state was not available.

## Per channel

Resolve each configured channel name to an ID with `slack_search_channels` (include `private_channel` in `channel_types`). A channel that is not found is a coverage gap, not a quiet channel.

**Pass 1 — Overnight activity (new since last check):** `slack_read_channel` with `oldest` set to `oldest_ts`. No messages means no activity since the cutoff, not a failure.

**Pass 2 — Unanswered requests (standing obligations):** on-demand only, `slack_read_channel` for the last 48 hours, even if Pass 1 was busy. Scan for unanswered questions or requests — messages that:

- Ask a question ("can someone", "does anyone know", "?") with no thread reply
- Request action ("please", "need", "can you", "when will") with no follow-up
- Tag someone (including `<@{user_id}>`) without a response in the thread

Where a message has replies, open the thread with `slack_read_thread` before calling it unanswered. Only include items from the last 48 hours that remain unanswered.

**Build priority items.** Each item has:
  - id: "{workspace_url}:{channel_id}:{message_ts}" (stable across passes and the mention search)
  - action: one of RESPOND, REVIEW, FYI
  - source: "{workspace_name} #{channel_name}"
  - summary: one-line description of what needs attention
  - excerpt: relevant quote (keep under 120 chars)
  - stale: true if from Pass 2 (unanswered/standing), false if from Pass 1 (overnight)

**Action classification.** If TYPESAFE_API_KEY is set, write the candidates as JSON — {"source": "slack", "user": {"user_id": "{user_id}", "keywords": the workspace's `keywords`}, "items": [{id, summary, excerpt, stale, mentions_user, unanswered}]} — and run:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/jev_prioritize.py" < items.json
```

Use the returned `action` for every item whose `action_source` is "jev" or "rule" (a mention of you always floors at RESPOND). Items with `action_source` "fallback" — and every item when the script reports Jev unavailable — get the rules below, exactly as before. Keep the returned `jev` record out of the output; it is for your own audit only.

Rules:
  - RESPOND — message contains <@{user_id}>, a direct question to you, or an urgent/unanswered request. If user_id is null, classify as RESPOND if the message contains urgent language ("urgent", "asap", "can someone", "need help", "please look at", "blocking") or is an unanswered question.
  - REVIEW — keyword hit from the workspace's `keywords`, or a message sharing a link/deploy/PR that implies review is needed.
  - FYI — general activity worth noting. Collapse low-signal activity into a single FYI summary item (e.g. "12 messages, 3 threads").

**Rules:**
  - Return every attention candidate, uncapped; display selection happens in step 5. Prioritize RESPOND > REVIEW > FYI in collection order.
  - Unanswered items from Pass 2 should be RESPOND, not FYI — they need action.
  - If the channel has activity but nothing actionable, emit one FYI summary.
  - If the channel has no activity AND no unanswered items, emit nothing (empty items).
  - Do NOT duplicate: if a message appears in both passes, include it once.

## Failure handling

If a channel read fails, record it in `errors`, count that channel as not read (never as quiet), and report `coverage.slack` as `partial`.

If every Slack call fails, output:
```
Prioritize failed: Slack connector unavailable
Check that the host's Slack connector is signed in.
```
Then stop.

## Merge results

Collect all items from all channels into a flat list. Track which channels had zero activity AND zero unanswered items (for the "Quiet" line).

Proceed to `steps/03-fetch-jira.md` with: slack_items list, quiet_channels list.
