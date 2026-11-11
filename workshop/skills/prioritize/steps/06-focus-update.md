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

If a named channel is not in the workspace's current list: "#{channel} is not in your configured channels — add it to the config first, or confirm to track it anyway."

## Record what the person says is handled

When the person says a ranked item is already done, out of date or not theirs, in this run or in reply to the table, record it so the next run does not raise it again:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/prioritize/scripts/output.py" state --data-path "${data_path}" \
  --handled "server:PROJ-123" --note "already shipped"
```

Use the item's `id` from the ranked result and the person's own reason as the note. Mark only what the person said, never what you infer. The item returns by itself when its Jira `updated` moves past the mark; `--restore ID` brings it back sooner.

## Write state

```bash
DATA_PATH=$(jq -r '.data_path // "~/.claude"' ~/.claude/workshop.json 2>/dev/null || echo "~/.claude")
DATA_PATH="${DATA_PATH/#\~/$HOME}"
# Record last run + the current top item so ambient mode can detect a change next time.
python3 "${CLAUDE_PLUGIN_ROOT}/skills/prioritize/scripts/output.py" state --data-path "${DATA_PATH}" --top "${TOP_ITEM_KEY:-}"
```

## Done

On-demand:
```
Prioritize complete. NEXT is set above.
For passive monitoring: /loop 1h /workshop:prioritize --loop
```

Ambient: no closing message beyond the one-line delta from step 5.
