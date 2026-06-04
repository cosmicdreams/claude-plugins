---
name: organize
description: >
  Categorizes and organizes loose notes in the Obsidian vault: injects YAML
  tags, moves files to appropriate folders, and cleans up untagged or
  root-level notes. Trigger phrases: "organize my vault", "tag my notes",
  "categorize Obsidian notes", "clean up vault", "sort my notes", "find
  untagged notes", "my notes are a mess", "vault needs cleanup", "organize
  these notes", "move this note to the right folder". Do NOT trigger for
  migrating local files into the vault (use lib:archive for that).
---

# workshop:organize

Categorize and tag loose notes in the Obsidian vault.

## Setup

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
RULES="${CLAUDE_PLUGIN_ROOT}/references/obsidian-rules.md"
```

Read the rules file before proposing any moves: `cat "$RULES"`

## Steps

1. **Find loose notes** — read `steps/01-find.md`
2. **Propose categorization** — read `steps/02-propose.md`
3. **Apply changes** — read `steps/03-apply.md` (only after user confirms)
