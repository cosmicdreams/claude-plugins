# Auth and Error Handling

## Authentication

Before posting, verify `agent-slack` is ready:

```bash
agent-slack auth whoami
```

If `agent-slack: command not found`:
> Install with: `npm i -g agent-slack`, then authenticate: `agent-slack auth import-desktop`

If auth fails:
> Run: `agent-slack auth import-desktop`

## `--workspace` flag

Only needed if the user has multiple Slack workspaces:

```bash
agent-slack message send '#<channel>' "<post>" --workspace <url>
```

## Error handling

| Error | Action |
|---|---|
| `command not found` | `npm i -g agent-slack` |
| Auth error | `agent-slack auth import-desktop` |
| Channel not found | Verify name; suggest `agent-slack channel list` |
| Any other non-zero exit | Show stderr and stop |
