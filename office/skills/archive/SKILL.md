---
name: archive
description: >
  Migrates local agent-produced Markdown and text files into the Obsidian vault for
  long-term memory. Trigger when the user says: "archive to Obsidian", "migrate to
  vault", "save to Obsidian", "archive my notes", "move this to my vault", "store in
  Obsidian", or any request to move local .md or .txt files into a vault. Do NOT
  trigger for simply reading or viewing vault notes (use office:organize for vault
  management). Do NOT attempt to run this if Obsidian is closed — the skill will fail
  at the health check.
---

# office:archive

## Prerequisites — run the health check before anything else

**Obsidian must be running** with the Local REST API community plugin enabled.

Run the health check before anything else. If it fails, stop — do not proceed without
a working Obsidian connection:

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

If the vault name is not the default, confirm with the user: "Using vault: NAME. Correct?"

## Archiving workflow

1. **Health check**: run `obsidian help` — stop if it fails (see Prerequisites)
2. **Discover files**: find `.md` and `.txt` files in the specified local directory
   ```bash
   find DIRECTORY -name "*.md" -o -name "*.txt" | sort
   ```
3. **Preview**: show the user the complete list of files that will be migrated
4. **Confirm before proceeding** — file deletion is irreversible. Always require explicit
   confirmation before touching any files:
   > Found X files to archive:
   > - path/to/file1.md
   > - path/to/file2.md
   >
   > These will be moved to Obsidian vault 'Neurons' under Projects/ProjectName/.
   > Proceed? (yes/no)

   Do NOT proceed without explicit "yes". File deletion is irreversible.

5. **For each file** (after confirmation):
   a. Read the file content
   b. Determine the vault path: `Projects/ProjectName/FileName` where ProjectName
      is inferred from the file's parent directory name or asked from the user once
   c. Write to vault:
      ```bash
      obsidian create --vault=$OBSIDIAN_VAULT_NAME \
        --path="Projects/ProjectName/FileName" \
        --content="FILE_CONTENT"
      ```
   d. Verify exit code 0 (success)
   e. **Only after confirmed success** — delete the local file. Never delete the local
      file before the vault write is confirmed — there is no recovery if the write
      fails mid-transfer:
      ```bash
      rm "LOCAL_PATH"
      ```
   f. Report: "Archived: FILENAME"

6. **Summary**: list all successfully archived files and any failures

## Error handling

- Vault write fails: report the error, keep the local file, continue with next file
- `obsidian: command not found`: direct user to install the obsidian CLI
- Partial failure: show which files succeeded and which failed; local files for failed
  items are always preserved
