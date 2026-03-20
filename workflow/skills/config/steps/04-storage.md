# Step 4 — Configure Data Storage

Workflow skills that store persistent data (pulse state, morning-brief history, etc.)
need a stable storage path that survives plugin upgrades.

## Determine storage path

If Obsidian was configured in Step 2 and the vault is available:

Suggest storing workflow data inside the vault:
`<vault_path>/.claude/plugin-data/`

This makes workflow-generated data visible in Obsidian and survives plugin upgrades.

Ask: "Store workflow data in your Obsidian vault at '<vault_path>/.claude/plugin-data/'? (yes/no, or enter a custom path)"

If no vault, or user declines:

Default to: `~/.claude/plugin-data/`

## Write to config

```json
"data_path": "~/Vaults/Neurons/.claude/plugin-data"
```

## Note on legacy data

If `~/.claude/office-pulse.json` exists, it will be migrated in the final step.
Workflow skills will read from `data_path` going forward.
