---
name: organize
description: >
  Categorize loose notes in the Obsidian vault: inject YAML tags, move files into the
  right folders, clean up untagged and root-level notes. Not for migrating local files
  into the vault (lib:archive).
---

# workshop:organize

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Categorizes and organizes loose notes in the Obsidian vault: injects YAML tags, moves files to appropriate folders, and cleans up untagged or root-level notes. Trigger phrases: "organize my vault", "tag my notes", "categorize Obsidian notes", "clean up vault", "sort my notes", "find untagged notes", "my notes are a mess", "vault needs cleanup", "organize these notes", "move this note to the right folder". Do NOT trigger for migrating local files into the vault (use lib:archive for that).

Categorize and tag loose notes in the Obsidian vault.

## Setup

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
RULES="${CLAUDE_PLUGIN_ROOT}/references/obsidian-rules.md"
cat "$RULES"
```

Read the rules file before proposing any moves.

## Step 1 — Find Loose Notes

```bash
# Notes sitting in vault root
find "$VAULT_ROOT" -maxdepth 1 -name "*.md" | sort

# Notes with no YAML frontmatter anywhere in vault
grep -rL "^---" "$VAULT_ROOT" --include="*.md" | sort
```

Collect both lists. Read each note to determine appropriate tags and target folder.

## Step 2 — Propose Categorization

For each loose note, applying `obsidian-rules.md`, determine:
- Appropriate tags
- Target folder (prefer matching an existing folder over creating a new one)

Display proposed changes before applying anything:

```
NOTE_TITLE
→ Move to: Research-Lab/Topics/topic/note-title.md
→ Tags: #research, #drupal
→ Reasoning: contains investigation findings on Drupal caching
```

Show all proposed moves at once, then ask:
> "Apply these organizational changes? (yes / no / edit)"

- **"edit"**: present each change individually for approval
- **"no"**: stop here
- **"yes"**: proceed to Step 3

## Step 3 — Apply Changes

Only run after user confirmation.

Move with the Obsidian CLI so Obsidian rewrites every link to the note. This vault links by path (`[[Folder/Note]]`), so a plain `mv` breaks those links. Run from the vault root so the CLI targets this vault:

```bash
cd "$VAULT_ROOT"
obsidian vault                                   # must print this vault's path
obsidian eval code="app.vault.getConfig('alwaysUpdateLinks')"   # must print => true
obsidian move path="<current-path>" to="<target-path>"
```

- If `alwaysUpdateLinks` is not `true`, each move stops on an "Update links?" dialog in Obsidian and the command waits. Ask the user to turn on Settings → Files and links → Automatically update internal links first.
- The CLI exits 0 even when a move fails. Count a move only when it prints `Moved:` and the file exists at the new path; report any `Error:` line.
- If `obsidian` is missing or Obsidian is not open on this vault, do not fall back to `mv`. List the pending moves for the user and stop.
- Create no folders first; `obsidian move` creates them. Obsidian may rewrite moved links in its configured link format (shortest path by default); they still resolve.

Then update frontmatter tags using the Edit tool on each moved file.

Report: how many notes were moved and tagged.
