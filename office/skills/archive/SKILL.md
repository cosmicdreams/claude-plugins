---
name: archive
description: >
  Migrates local agent-produced Markdown and text files into the Obsidian vault for
  long-term memory. Trigger when the user says: "archive to Obsidian", "migrate to
  vault", "save to Obsidian", "archive my notes", "move this to my vault", "store in
  Obsidian", or any request to move local .md or .txt files into a vault. Do NOT
  trigger for simply reading or viewing vault notes (use office:organize for vault
  management).
---

# office:archive

## Vault configuration

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
```

## Placement rules

Before determining where any file goes, read `obsidian-rules.md`:
```bash
cat ~/.claude/plugins/cache/local/office/*/references/obsidian-rules.md | tail -1 | xargs cat
```
Use the purpose taxonomy and path patterns there to decide each file's destination.
Do not assume all files belong under `Projects/` — content type determines placement.

## Archiving workflow

1. **Discover files**: find `.md` and `.txt` files in the specified local directory
   ```bash
   find DIRECTORY -name "*.md" -o -name "*.txt" | sort
   ```

2. **Determine placement**: for each file, read its content and apply `obsidian-rules.md`
   to determine the correct vault path. Check existing vault folders first — prefer
   matching an existing folder over creating a new one.

3. **Preview and confirm** — file deletion is irreversible. Always require explicit
   confirmation before touching any files:
   > Found X files to archive:
   > - file1.md → Research/topic/file1.md
   > - file2.md → Projects/my-project/file2.md
   >
   > Proceed? (yes/no)

   Do NOT proceed without explicit "yes".

4. **For each file** (after confirmation):
   a. Resolve full destination: `$VAULT_ROOT/<vault-path>`
   b. Create destination directory:
      ```bash
      mkdir -p "$VAULT_ROOT/<destination-folder>"
      ```
   c. Copy to vault:
      ```bash
      cp "LOCAL_PATH" "$VAULT_ROOT/<destination>"
      ```
   d. Verify the file exists at the destination before deleting the source.
   e. **Only after confirmed success** — delete the local file:
      ```bash
      rm "LOCAL_PATH"
      ```
   f. Report: "Archived: FILENAME → VAULT_PATH"

5. **Summary**: list all successfully archived files and any failures

## Error handling

- Copy fails: report the error, keep the local file, continue with next file
- Partial failure: show which files succeeded and which failed; local files for failed
  items are always preserved
