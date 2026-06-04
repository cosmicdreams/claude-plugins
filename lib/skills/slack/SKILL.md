---
name: slack
description: >
  Slack CLI wrapper — read channels, fetch messages, search, and list conversations
  via agent-slack. Returns raw data only; no summarization or prioritization.
  Use when the user asks to READ or FETCH from Slack: "what's in #channel", "what's happening in #engineering",
  "search slack for X", "list my slack channels", "show messages from #general", "check slack",
  "fetch slack messages", "catch up on slack", "any updates in #X", "show me slack".
  Also use when workflow:prioritize needs raw Slack data.
  Do NOT use for: sending, posting, or writing to Slack (this skill is read-only);
  summarized priority views or "what should I work on" (use workflow:prioritize).
triggers:
  - "lib:slack"
  - "read slack"
  - "slack messages"
  - "list my slack channels"
  - "what's in #"
  - "check slack"
  - "slack updates"
  - "search slack"
allowed-tools: Bash, Read
---

# lib:slack — Slack CLI Wrapper

Thin wrapper around `agent-slack`. Read-only — this skill does NOT send, post, react,
or modify Slack in any way. No summarization, no prioritization — return raw data for
the calling skill to process.

## Authentication

Check that `agent-slack` is installed and authenticated before any operation:

```bash
agent-slack auth whoami
```

The output includes `user_id` (or `id`) — save this if @mention filtering is needed.

**If `agent-slack: command not found`**, tell the user:

> `agent-slack` is not installed. Install it with:
> ```bash
> npm i -g agent-slack
> ```
> Then authenticate:
> ```bash
> agent-slack auth import-desktop
> ```

**If auth fails** (non-zero exit, "not authenticated", or similar error):

> Authentication required. Run:
> ```bash
> agent-slack auth import-desktop   # reads from Slack Desktop app on macOS (recommended)
> ```
> If Slack Desktop is not installed, see: https://github.com/stablyai/agent-slack

## Load config

Read `~/.claude/office-slack.local.md` if it exists. Parse frontmatter fields:

- `channels` — list of channel names or IDs to watch (used as default when no channel is specified)
- `message_limit` — default number of messages to fetch per channel (default: `50`)

If the file does not exist, proceed without defaults — the caller must supply channel names explicitly.

## Operations

### List joined channels

```bash
agent-slack channel list --limit 200
```

Returns JSON array of channels. Present as a Markdown table when invoked directly:

| Channel | ID | Members |
|---|---|---|

### Read recent messages from a channel

```bash
agent-slack message list <channel-name-or-id> --workspace <workspace-url> --limit <N>
```

- `<channel-name-or-id>`: channel name WITHOUT the `#` prefix (e.g. `general`, not `#general`), or channel ID (e.g. `C01234567`)
- Default limit: value from config `message_limit`, or `50` if not set
- Returns JSON array of messages with `ts`, `user`, `text`, `thread_ts` fields
- Omit `--workspace` only if you have a single workspace configured
- To find the workspace URL: run `agent-slack auth whoami` and look for the `url` or `team_url` field

To read multiple channels, run in parallel with one command per channel.

### Read a thread

```bash
agent-slack message list <channel> --workspace <workspace-url> --thread-ts <ts>
```

Use the `thread_ts` from a parent message to fetch all replies.

### Search messages

```bash
agent-slack search messages "<query>" [--channel <channel>]
```

- Omit `--channel` to search across all channels
- Returns JSON array of matching messages with channel, user, ts, text

### Fetch since a timestamp

`agent-slack message list` returns the most recent N messages. To get messages since a
specific time, fetch with `--limit` set high enough and filter client-side by `ts` field.
Slack timestamps are Unix epoch with decimal (e.g. `1709900000.123456`).

## Passing data to calling skills

Return the raw JSON output from `agent-slack`. Do not summarize or interpret.
The calling skill (e.g. `workflow:prioritize`) is responsible for
all ranking, filtering, and presentation.

## Error handling

| Error | Action |
|---|---|
| `command not found` | Prompt user to install: `npm i -g agent-slack` |
| Auth error / not authenticated | Prompt: `agent-slack auth import-desktop` |
| Channel not found | Tell user the channel name may be wrong; suggest `channel list` |
| Rate limit (429) | Wait 10 seconds and retry once; if it fails again, report the error |
| Any other non-zero exit | Show stderr and stop — do not retry |
