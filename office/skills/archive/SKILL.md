---
name: archive
description: >
  Migrates local agent-produced Markdown and text files into the Obsidian vault for
  long-term memory. Use when the user asks to archive reports, save local notes to
  Obsidian, migrate .md files to the vault, or run vault archiving. Trigger phrases:
  "archive to Obsidian", "migrate to vault", "save to Obsidian", "archive my notes",
  "move this to my vault", "store in Obsidian". Requires Obsidian to be running
  with the Local REST API plugin enabled.
---

# office:archive

Sweeps local project directories and migrates agent-produced documents into the
Obsidian vault for persistent long-term memory.

## Prerequisites

**Obsidian must be running** with the Local REST API community plugin enabled.

Health check — run this FIRST, every time:
```bash
obsidian help
```

If that fails (non-zero exit or command not found):
> Obsidian is not reachable. Please:
> 1. Launch the Obsidian app
> 2. Go to Settings → Community Plugins → Browse → install "Local REST API"
> 3. Enable the plugin and note the port (default: 27123)
> Then try again.

Only proceed after `obsidian help` succeeds.

## Vault configuration

Default vault: `Neurons` (at `~/Vaults/Neurons`)

The vault name is read from (in priority order):
1. `$OBSIDIAN_VAULT_NAME` environment variable
2. `~/.config/office/config` (line: `OBSIDIAN_VAULT_NAME=MyVault`)
3. Fallback default: `Neurons`

If the vault name is not the default, confirm with the user: "Using vault: <name>. Correct?"

## Archiving workflow

1. **Health check**: run `obsidian help` — stop if it fails
2. **Discover files**: find `.md` and `.txt` files in the specified local directory
   ```bash
   find <directory> -name "*.md" -o -name "*.txt" | sort
   ```
3. **Preview**: show the user the complete list of files that will be migrated
4. **CONFIRM**: Ask the user before proceeding:
   > Found X files to archive:
   > - path/to/file1.md
   > - path/to/file2.md
   >
   > These will be moved to Obsidian vault 'Neurons' under Projects/<ProjectName>/.
   > Proceed? (yes/no)

   Do NOT proceed without explicit "yes".

5. **For each file** (after confirmation):
   a. Read the file content
   b. Determine the vault path: `Projects/<ProjectName>/<FileName>` where ProjectName
      is inferred from the file's parent directory name or asked from the user once
   c. Create in vault:
      ```bash
      obsidian create --vault=$OBSIDIAN_VAULT_NAME \
        --path="Projects/<ProjectName>/<FileName>" \
        --content="<file_content>"
      ```
   d. Verify exit code 0 (success)
   e. **Only after confirmed success**: delete the local file
      ```bash
      rm "<local_path>"
      ```
   f. Report: "✅ Archived: <filename>"

6. **Summary**: List all successfully archived files and any failures. Never delete
   a local file if the vault write failed.

## Error handling

- Vault write fails: report the error, keep local file, continue with next file
- `obsidian: command not found`: direct user to install obsidian CLI
- Partial failure: show which files succeeded and which failed, local files for
  failed items are preserved
