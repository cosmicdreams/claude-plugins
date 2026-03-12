---
name: deploy-post
description: >
  Post a formatted deployment checklist message to a Slack channel using agent-slack.
  Use when the user says "post deployment checklist", "send deploy checklist", "post to slack for deployment",
  "send the deployment post", "post deploy status to slack", "office:deploy-post", or references
  sending a deployment announcement to a Slack channel.
  Takes a channel name as the first argument (with or without #).
  Optionally takes a release branch and previous tag as additional arguments.
  Do NOT use for reading Slack messages (use office:slack); do NOT use for non-deployment Slack posts.
triggers:
  - "office:deploy-post"
  - "post deployment checklist"
  - "send deploy checklist"
  - "post to slack for deployment"
  - "send the deployment post"
  - "deployment announcement"
allowed-tools: Bash, Read
---

# office:deploy-post — Deployment Checklist to Slack

Post the standard deployment checklist message to a Slack channel.

## Arguments

- **Channel** (required): channel name with or without `#` (e.g. `#deployments` or `deployments`)
- **Release** (optional): release branch name (e.g. `release/2025.12.02-build`). Defaults to `release/TBD`.
- **Previous tag** (optional): previous git tag (e.g. `tags/2025-11-05`). Defaults to `tags/TBD`.

## Steps

### 1. Parse arguments

Extract the channel, release, and previous tag from the skill arguments. Strip the leading `#` from the channel if present — agent-slack accepts either form, but be consistent.

Example invocations:
```
/office:deploy-post #deployments release/2025.12.02-build tags/2025-11-05
/office:deploy-post deployments
```

### 2. Check authentication

```bash
agent-slack auth whoami
```

If `agent-slack: command not found`, tell the user:
> `agent-slack` is not installed. Run: `npm i -g agent-slack`, then `agent-slack auth import-desktop`

If auth fails (non-zero exit or "not authenticated"), tell the user:
> Run `agent-slack auth import-desktop` to authenticate with your Slack Desktop app.

### 3. Load the message template

Read the template from:
```
${CLAUDE_PLUGIN_ROOT}/skills/deploy-post/assets/checklist.txt
```

Replace `{RELEASE}` with the release argument and `{PREV_TAG}` with the previous tag argument.

### 4. Send the message

```bash
agent-slack message send "#<channel>" "<message text>"
```

Pass the full multi-line message as the text argument. Use a shell variable to hold the message to avoid quoting issues:

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
TEMPLATE="$PLUGIN_ROOT/skills/deploy-post/assets/checklist.txt"

RELEASE="release/2025.12.02-build"   # from args
PREV_TAG="tags/2025-11-05"           # from args
CHANNEL="deployments"                 # from args, no #

MESSAGE=$(sed "s/{RELEASE}/$RELEASE/g; s/{PREV_TAG}/$PREV_TAG/g" "$TEMPLATE")

agent-slack message send "#$CHANNEL" "$MESSAGE"
```

### 5. Confirm success

On success (exit 0), print:
> Deployment checklist posted to #<channel>.

On non-zero exit, show stderr and stop.

## Error handling

| Error | Action |
|---|---|
| `command not found` | Prompt: `npm i -g agent-slack` |
| Auth error | Prompt: `agent-slack auth import-desktop` |
| Channel not found | Tell user to verify the channel name; suggest `agent-slack channel list` |
| Any other non-zero exit | Show stderr and stop |
