# Step 4 — Focus Update and Write State

## Offer focus update

Show current config and offer to narrow it for the day:

```
Currently configured:
  {WorkspaceName}: #{ch1}, #{ch2}, #{ch3}
  {WorkspaceName2}: #{ch1}

Want to focus on specific channels today?
Say which to watch (e.g. "focus on #preview and #deployments"),
or "keep current" to leave config unchanged.
```

- User names channels → update the active config file (whichever was loaded in setup)
- User says "keep current" / "no" → skip config update

## Update config (only if requested)

Update `channels` for the relevant workspace(s) in the loaded config file.
Preserve all other fields.

If a named channel is not in the workspace's current list:
"#{channel} is not in your configured channels — add it to the config first, or confirm to track it anyway."

## Write state

```bash
DATA_PATH=$(jq -r '.data_path // "~/.claude"' ~/.claude/workflow.json 2>/dev/null || echo "~/.claude")
echo '{"last_run": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > "${DATA_PATH}/workflow-morning-brief.state.json"
```

## Done

```
Morning brief complete.
Pulse is tracking: {WorkspaceName}: #{ch1}, #{ch2} · {WorkspaceName2}: #{ch1}
Run /loop 1h /workflow:pulse to start monitoring.
```
