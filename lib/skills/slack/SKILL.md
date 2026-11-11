---
name: slack
description: >
  Read-only Slack access through the host's Slack connector: read channels and threads,
  search, find channels. Returns raw data and never sends or posts. For a ranked view of
  what matters use workshop:prioritize.
---

# lib:slack — Read Slack

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Read Slack through the host's Slack connector: read channels, fetch messages, search, and find channels. Returns raw data only; no summarization or prioritization. Use when the user asks to READ or FETCH from Slack: "what's in #channel", "what's happening in #engineering", "search slack for X", "list my slack channels", "show messages from #general", "check slack", "fetch slack messages", "catch up on slack", "any updates in #X", "show me slack". Also use when workshop:prioritize needs raw Slack data. Do NOT use for: sending, posting, or writing to Slack (this skill is read-only); summarized priority views or "what should I work on" (use workshop:prioritize).

Read-only: this skill does NOT send, post, react, or modify Slack in any way, even though the connector can. No summarization, no prioritization: return what the connector returned for the calling skill to process.

## Connector

Slack is read with the host's Slack connector tools: `slack_search_channels`, `slack_read_channel`, `slack_read_thread`, `slack_search_public_and_private` and `slack_search_users`. Tool names carry a host prefix and may be deferred; find them with tool search first.

If the session has no Slack connector, say so and that it is set up in the host's connector settings, then stop. Do not fall back to a command-line tool, a token or a browser session.

The connector acts as the account signed in to the host and reaches that account's one workspace. If the channels returned are not the ones the user means, they are probably signed in to a different workspace: say so.

## Load config

Read `~/.claude/office-slack.local.md` if it exists. Parse frontmatter fields:

- `channels` — list of channel names or IDs to watch (used as default when no channel is specified)
- `message_limit` — default number of messages to fetch per channel (default: `50`)

If the file does not exist, proceed without defaults — the caller must supply channel names explicitly.

## Operations

### Find a channel

`slack_search_channels` with the channel name as a keyword. Pass `channel_types: "public_channel,private_channel"` to include private channels. It returns the channel ID every other call needs. When invoked directly, present results as a Markdown table:

| Channel | ID | Topic |
|---|---|---|

### Read recent messages from a channel

`slack_read_channel` with `channel_id` and `limit` (1 to 100; default from config `message_limit`, else 50). Messages come newest first. To read a direct-message history, pass the other person's user ID as `channel_id`; find it with `slack_search_users`.

To read several channels, make the calls in parallel.

### Read since a timestamp

Pass `oldest` (a Slack timestamp, Unix seconds with a decimal such as `1709900000.123456`) to `slack_read_channel`. Follow `cursor` until the window is covered; if you stop early, report partial coverage.

### Read a thread

`slack_read_thread` with `channel_id` and the parent message's `message_ts`.

### Search messages

`slack_search_public_and_private` with subject words in `keywords` and people, channels and dates in `filters` (`in:<#C123>`, `from:<@U123>`, `after:YYYY-MM-DD`). It returns at most 20 results per page; follow `cursor` for more.

## Passing data to calling skills

Return what the connector returned. Do not summarize or interpret. The calling skill (e.g. `workshop:prioritize`) is responsible for all ranking, filtering, and presentation.

## Error handling

| Error | Action |
|---|---|
| No Slack connector in the session | Say so and stop; it is set up in the host's connector settings |
| `channel_not_found` | Look the name up with `slack_search_channels`; the name may be wrong or the channel may be in another workspace |
| Rate limit | Wait 10 seconds and retry once; if it fails again, report the error |
| Any other error | Show it and stop — do not retry |
