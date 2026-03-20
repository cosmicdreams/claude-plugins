# Auth, State, and Error Handling

## Authentication

Before any operation, verify `agent-slack` is ready:

```bash
agent-slack auth whoami
```

If `agent-slack: command not found`:
> Install with: `npm i -g agent-slack`, then authenticate: `agent-slack auth import-desktop`

If auth fails:
> Run: `agent-slack auth import-desktop`

## `--workspace` flag

Only needed if you have multiple Slack workspaces:
```bash
python3 "$SCRIPT" init <channel> --workspace <url> ...
```

## State file

Stored at `~/.deploy-post-state.json`. Contains channel, release info, message ts, and per-step status.

If the ts is missing after init, Slack edits will fail gracefully with a local-only update.
To recover: find the message in Slack (right-click → Copy link, extract the `p`-prefixed number)
and manually add it to the state file.

## Error handling

| Error | Action |
|---|---|
| `command not found` | `npm i -g agent-slack` |
| Auth error | `agent-slack auth import-desktop` |
| Channel not found | Verify name; suggest `agent-slack channel list` |
| Edit fails (no ts) | Update state locally, warn user |
| Any other non-zero exit | Show stderr and stop |
