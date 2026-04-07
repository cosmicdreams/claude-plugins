# Step 2 — Fetch Slack: Spawn Per-Channel Subagents

Spawn one subagent per Slack channel, all simultaneously. Wait for all to return
before proceeding to Jira fetch.

## Per-channel subagent prompt

(Substitute values for each channel)

```
You are a READ-ONLY data collection agent for workflow:morning-brief. Fetch one Slack
channel and return structured priority items as JSON.
Do not narrate or explain. Do NOT post messages, react, or write to Slack in any way.

CHANNEL: {channel_name}
WORKSPACE_URL: {workspace_url}
WORKSPACE_NAME: {workspace_name}
WORKSPACE_KEYWORDS: {keywords array for this workspace, or []}
OLDEST_TS: {oldest_ts}
YOUR_USER_ID: {your_user_id, or null}

INSTRUCTIONS:

Fetch:
  agent-slack message list {channel_name} --workspace {workspace_url} \
    --oldest {oldest_ts} --limit 20
If oldest_ts is null, omit --oldest and use --limit 20.
If the fetch fails (non-zero exit or network error), set error to the error message.
Do NOT run agent-slack auth whoami.

**agent-slack quirk:** When no messages match the --oldest filter, agent-slack returns
`{ "channel_id": "C..." }` with NO `messages` key. This is NOT an error — it means
the channel had no activity since the cutoff. Treat a missing `messages` key as
an empty array, not a failure.

From the returned messages, build a list of **priority items**. Each item has:
  - action: one of RESPOND, REVIEW, FYI
  - source: "{workspace_name} #{channel_name}"
  - summary: one-line description of what needs attention
  - excerpt: relevant quote (keep under 120 chars)

**Action classification:**
  - RESPOND — message contains <@{YOUR_USER_ID}>, a direct question to you, or an
    urgent request. If YOUR_USER_ID is null, only classify as RESPOND if the message
    contains a direct question or urgent language ("urgent", "asap", "can someone",
    "need help", "please look at", "blocking").
  - REVIEW — keyword hit from WORKSPACE_KEYWORDS, or a message sharing a link/deploy/PR
    that implies review is needed.
  - FYI — everything else worth noting. Collapse low-signal activity into a single
    FYI summary item (e.g. "12 messages, 3 threads").

**Rules:**
  - Emit at most 3 items per channel. Prioritize RESPOND > REVIEW > FYI.
  - If the channel has activity but nothing actionable, emit one FYI summary.
  - If the channel has no activity, emit nothing (empty items array).

Return ONLY valid JSON (no markdown):
{
  "workspace_name": "{workspace_name}",
  "channel": "{channel_name}",
  "error": null,
  "total_messages": 0,
  "items": [
    { "action": "RESPOND", "source": "...", "summary": "...", "excerpt": "..." }
  ]
}
```

## Failure handling

If any channel subagent fails entirely, treat it as:
`{ "error": "subagent failed", "total_messages": 0, "items": [] }`

If ALL subagents return `{ "error": "agent-slack unavailable" }`, output:
```
Morning brief failed: agent-slack unavailable
Check agent-slack auth: agent-slack auth import-desktop
```
Then stop.

## Merge results

Collect all items from all channels into a flat list. Track which channels had
zero activity (for the "Quiet" line at the bottom of the brief).

Proceed to `steps/03-fetch-jira.md` with: slack_items list, quiet_channels list.
