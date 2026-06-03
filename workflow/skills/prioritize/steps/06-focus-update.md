# Step 6 — Focus Update and Write State

**Ambient (`--loop`) mode:** skip the focus offer; just write state and exit quietly.

## Offer focus update (on-demand mode)

Show current config and offer to narrow it for the day:

```
Currently configured:
  {WorkspaceName}: #{ch1}, #{ch2}, #{ch3}
  {WorkspaceName2}: #{ch1}

Want to focus on specific channels today?
Say which to watch (e.g. "focus on #preview and #deployments"),
or "keep current" to leave config unchanged.
```

- User names channels → update the active config file (whichever was loaded in setup).
- User says "keep current" / "no" → skip the config update.

If a named channel is not in the workspace's current list:
"#{channel} is not in your configured channels — add it to the config first, or confirm to track it anyway."

## Write state

```bash
DATA_PATH=$(jq -r '.data_path // "~/.claude"' ~/.claude/workflow.json 2>/dev/null || echo "~/.claude")
DATA_PATH="${DATA_PATH/#\~/$HOME}"
# Record last run + the current top item so ambient mode can detect a change next time.
printf '{"last_run":"%s","top":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${TOP_ITEM_KEY:-}" \
  > "${DATA_PATH}/workflow-prioritize.state.json"
```

## Done

On-demand:
```
Prioritize complete. NEXT is set above.
For passive monitoring: /loop 1h /workflow:prioritize --loop
```

Ambient: no closing message beyond the one-line delta from step 5.
