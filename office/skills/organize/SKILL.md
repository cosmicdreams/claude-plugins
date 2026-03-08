---
name: organize
description: >
  Categorizes and organizes loose notes in the Obsidian vault: injects YAML
  tags, moves files to appropriate folders, and cleans up untagged or
  root-level notes. Trigger phrases: "organize my vault", "tag my notes",
  "categorize Obsidian notes", "clean up vault", "sort my notes", "find
  untagged notes", "my notes are a mess", "vault needs cleanup", "organize
  these notes", "move this note to the right folder". Do NOT trigger for
  migrating local files into the vault (use office:archive for that). Requires
  Obsidian to be running with Local REST API enabled.
---

# office:organize

## Prerequisites

Run this health check FIRST, every time:
```bash
obsidian help
```

If it fails, stop. Obsidian must be running with Local REST API enabled (Settings → Community Plugins → Local REST API → Enable). Do not proceed without a passing health check.

## Vault configuration

Resolve the vault name in priority order:
1. `$OBSIDIAN_VAULT_NAME` environment variable
2. `~/.config/office/config`
3. Default: `Neurons` (at `~/Vaults/Neurons`)

## Organize workflow

1. **Find loose notes** — search for notes that need organizing:
   ```bash
   obsidian search "" --format=json --vault=$OBSIDIAN_VAULT_NAME
   ```
   Filter for notes that meet any of these conditions:
   - In the vault root (no subdirectory in path)
   - No YAML frontmatter tags
   - No YAML frontmatter at all

2. **Analyze each loose note** — read the content and determine:
   ```bash
   obsidian read --vault=$OBSIDIAN_VAULT_NAME --path="NOTE_PATH"
   ```
   For each note, determine:
   - Appropriate tags (e.g., `meeting`, `sprint`, `research`, `todo`, `report`)
   - Target folder: `shared/` for general notes, `Projects/NAME/` for project-specific

3. **Show proposed categorization** — for each note, display:
   ```
   NOTE_TITLE
   → Move to: Projects/MyProject/NOTE_TITLE
   → Tags: #sprint, #report
   → Reasoning: contains "standup" and sprint references
   ```
   Surfacing reasoning lets the user correct misclassification before it's applied — categorization is a judgment call, not a lookup.

4. **CONFIRM batch plan** — show all proposed moves and tag changes at once. Ask:
   > "Apply these organizational changes? (yes / no / edit)"

   If the user says **"edit"**, present each proposed change individually and let them approve or modify it one at a time before moving on.

5. **Apply changes** (after confirmation only):
   ```bash
   # Inject tags
   obsidian update --vault=$OBSIDIAN_VAULT_NAME --path="NOTE" \
     --property="tags" --value="[sprint, report]"

   # Move to target folder
   obsidian move --vault=$OBSIDIAN_VAULT_NAME \
     --from="CURRENT_PATH" --to="TARGET_PATH"
   ```

6. **Summary** — report how many notes were organized, moved, and tagged.

## Categorization heuristics

Apply these in order of specificity — when content matches multiple heuristics, prefer the more specific one. For example, "sprint report" matches both sprint→meeting and Summary→report; choose based on the dominant theme of the note.

| Signal | Tags | Folder |
|---|---|---|
| "sprint", "standup", "retro" | `meeting`, `sprint` | `Projects/NAME/Meetings/` |
| "TODO", "task list", action items | `todo` | `shared/Tasks/` |
| Analysis, data, findings | `research` | `Projects/NAME/Research/` |
| "Summary" or "Report" headers | `report` | `Projects/NAME/Reports/` |
| Generic scratch notes | _(none)_ | `shared/Notes/` |
