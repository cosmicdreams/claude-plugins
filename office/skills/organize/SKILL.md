---
name: organize
description: >
  Categorizes and organizes loose notes in the Obsidian vault: injects YAML
  tags, moves files to appropriate folders, and cleans up untagged or
  root-level notes. Trigger phrases: "organize my vault", "tag my notes",
  "categorize Obsidian notes", "clean up vault", "sort my notes", "find
  untagged notes", "my notes are a mess", "vault needs cleanup", "organize
  these notes", "move this note to the right folder". Do NOT trigger for
  migrating local files into the vault (use office:archive for that).
---

# office:organize

## Vault configuration

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
```

## Placement rules

Before proposing any moves, read `obsidian-rules.md`:
```bash
ls ~/.claude/plugins/cache/local/office/*/references/obsidian-rules.md | sort -V | tail -1 | xargs cat
```

Use the purpose taxonomy and path patterns there to determine where each note belongs.
Check existing vault folders first — prefer matching an existing folder over creating
a new one.

## Organize workflow

1. **Find loose notes** — scan the vault for notes that need organizing:
   ```bash
   # Notes sitting in vault root
   find "$VAULT_ROOT" -maxdepth 1 -name "*.md" | sort

   # Notes with no YAML frontmatter anywhere in vault
   grep -rL "^---" "$VAULT_ROOT" --include="*.md" | sort
   ```

2. **Read each loose note** and determine:
   - Appropriate tags
   - Target folder (applying `obsidian-rules.md`)

3. **Show proposed categorization** — for each note, display:
   ```
   NOTE_TITLE
   → Move to: Research/topic/note-title.md
   → Tags: #research, #drupal
   → Reasoning: contains investigation findings on Drupal caching
   ```
   Surfacing reasoning lets the user correct misclassification before it's applied.

4. **CONFIRM batch plan** — show all proposed moves at once. Ask:
   > "Apply these organizational changes? (yes / no / edit)"

   If the user says **"edit"**, present each change individually for approval.

5. **Apply changes** (after confirmation only):
   ```bash
   # Move file
   mkdir -p "$VAULT_ROOT/<target-folder>"
   mv "$VAULT_ROOT/<current-path>" "$VAULT_ROOT/<target-path>"
   ```
   Update frontmatter tags using the Edit tool on each file after moving.

6. **Summary** — report how many notes were moved and tagged.
