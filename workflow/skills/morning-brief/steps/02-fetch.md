# Step 2 — Fetch: Spawn Per-Channel Subagents

Spawn one subagent per Slack channel, all simultaneously. Wait for all to return
before proceeding to scoring.

## Per-channel subagent prompt

(Substitute values for each channel)

```
You are a data collection agent for workflow:morning-brief. Fetch one Slack channel and return JSON.
Do not narrate or explain.

CHANNEL: {channel_name}
WORKSPACE_URL: {workspace_url}
WORKSPACE_HOST: {workspace_hostname}
WORKSPACE_KEYWORDS: {keywords array for this workspace, or []}
OLDEST_TS: {oldest_ts}
YOUR_USER_ID: {your_user_id, or null}

INSTRUCTIONS:

Fetch:
  agent-slack message list {channel_name} --workspace {workspace_url} \
    --oldest {oldest_ts} --limit 20
If oldest_ts is null, omit --oldest and use --limit 20.
If the fetch fails, set error to the error message and messages=[].
Do NOT run agent-slack auth whoami.

Compute from returned messages (all are already newer than oldest_ts):
   - total_messages: count of all returned messages
   - mention_count: messages containing <@{YOUR_USER_ID}> (0 if YOUR_USER_ID is null)
   - keyword_hits: messages matching any keyword in WORKSPACE_KEYWORDS (case-insensitive);
     record { keyword, user, excerpt } for each hit
   - thread_replies: messages where thread_ts is set and thread_ts != ts
   - notable: up to 2 messages — mentions first, then keyword hits; each as { user, excerpt }
   - most_recent_ts: highest ts value seen (if no messages, use oldest_ts)

Return ONLY valid JSON (no markdown):
{
  "workspace_host": "{workspace_hostname}",
  "channel": "{channel_name}",
  "your_user_id": "U...",
  "error": null,
  "most_recent_ts": "...",
  "total_messages": 0,
  "mention_count": 0,
  "keyword_hits": [ { "keyword": "...", "user": "...", "excerpt": "..." } ],
  "thread_replies": 0,
  "notable": [ { "user": "...", "excerpt": "..." } ]
}
```

## Failure handling

If any channel subagent fails entirely, treat it as:
`{ "error": "subagent failed", "total_messages": 0, "mention_count": 0, "keyword_hits": [], "thread_replies": 0, "notable": [] }`

If ALL subagents return `{ "error": "agent-slack unavailable" }`, output:
```
Morning brief failed: agent-slack unavailable
Check agent-slack auth: agent-slack auth import-desktop
```
Then stop.

## Merge results

Collect all subagent results into:

```json
{
  "your_user_id": "U...",
  "workspaces": {
    "{workspace_hostname}": {
      "{channel_name}": { ...per-channel result... }
    }
  }
}
```

Proceed to `steps/03-score-output.md` with the merged results.
