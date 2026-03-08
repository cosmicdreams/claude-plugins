---
name: organize
description: >
  Categorizes and organizes loose notes in the Obsidian vault: finds untagged or
  root-level notes, injects YAML properties and tags, and moves files to appropriate
  folders. Use when the user asks to organize the vault, tag notes, categorize
  Obsidian notes, or clean up the vault. Trigger phrases: "organize my vault",
  "tag my notes", "categorize Obsidian notes", "clean up vault", "sort my notes",
  "find untagged notes". Requires Obsidian to be running with Local REST API enabled.
---

# office:organize

Keeps the Obsidian vault clean by finding untagged or root-level notes, categorizing
them intelligently, and moving them to appropriate project or shared folders.

## Prerequisites

Health check — run this FIRST, every time:
```bash
obsidian help
```

If that fails: same guidance as office:archive — Obsidian must be running with
Local REST API plugin enabled.

## Vault configuration

Default vault: `Neurons` (at `~/Vaults/Neurons`)

Priority order for vault name:
1. `$OBSIDIAN_VAULT_NAME` environment variable
2. `~/.config/office/config`
3. Default: `Neurons`

## Organize workflow

1. **Health check**: `obsidian help` — stop if it fails

2. **Find loose notes**: Search for untagged or root-level notes:
   ```bash
   obsidian search "" --format=json --vault=$OBSIDIAN_VAULT_NAME
   ```
   Filter results for notes that:
   - Are in the vault root (no subdirectory in path)
   - Have no YAML frontmatter tags
   - Have no YAML frontmatter at all

3. **For each loose note**:
   a. Read the note content:
      ```bash
      obsidian read --vault=$OBSIDIAN_VAULT_NAME --path="<note_path>"
      ```
   b. Analyze the content to determine:
      - Appropriate tags (e.g., `meeting`, `sprint`, `research`, `todo`, `report`)
      - Target folder: `shared/` for general notes, `Projects/<name>/` for project-specific
   c. Show your proposed categorization to the user:
      > **<note_title>**
      > → Move to: `Projects/MyProject/<note_title>`
      > → Tags: `#sprint`, `#report`

4. **CONFIRM batch plan**: Show all proposed moves and tag changes at once.
   Ask: "Apply these organizational changes? (yes/no/edit)"

5. **Apply changes** (after confirmation):
   a. Inject YAML frontmatter tags:
      ```bash
      obsidian update --vault=$OBSIDIAN_VAULT_NAME --path="<note>" \
        --property="tags" --value="[sprint, report]"
      ```
   b. Move to target folder:
      ```bash
      obsidian move --vault=$OBSIDIAN_VAULT_NAME \
        --from="<current_path>" --to="<target_path>"
      ```

6. **Summary**: Report how many notes were organized, moved, and tagged.

## Categorization heuristics

Use these as starting guidance:
- Contains "sprint", "standup", "retro" → tag `meeting`, folder `Projects/<project>/Meetings/`
- Contains "TODO", "task list", action items → tag `todo`, folder `shared/Tasks/`
- Contains analysis, data, findings → tag `research`, folder `Projects/<project>/Research/`
- Contains headers like "Summary" or "Report" → tag `report`, folder `Projects/<project>/Reports/`
- Generic scratch notes → folder `shared/Notes/`

Always show the user your reasoning and let them override.
