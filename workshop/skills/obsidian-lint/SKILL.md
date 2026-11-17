---
name: obsidian-lint
description: >
  Audit the Obsidian vault against obsidian-rules.md and fix structural violations —
  misplaced files, wrong folders, legacy shared/ prefixes, off-convention naming. Dry-run
  by default.
---

# workshop:obsidian-lint

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Audits the Obsidian vault against obsidian-rules.md and corrects violations: misplaced files, wrong folder structure, legacy shared/ prefixes, and naming that doesn't follow conventions. Runs a dry-run by default — shows proposed moves before applying anything. Trigger phrases: "lint my vault", "audit the vault", "fix vault structure", "check vault paths", "vault has wrong folders", "clean up vault structure", "remove shared/ from vault".

Audit and correct vault structure against `obsidian-rules.md`. Filesystem-only — Obsidian does not need to be running.

## Setup

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
RULES="${CLAUDE_PLUGIN_ROOT}/references/obsidian-rules.md"
cat "$RULES"
```

Read the rules before scanning.

## Step 1 — Scan for Violations

```bash
# Files in vault root (other than allowed exceptions)
find "$VAULT_ROOT" -maxdepth 1 -type f -name "*.md" \
  ! -name "index.md" \
  ! -name "wiki-schema.md" \
  ! -name "AGENTS.md" \
  | sort

# .base files in root are allowed — not violations
find "$VAULT_ROOT" -maxdepth 1 -type f -name "*.base" | sort

# Empty folders
find "$VAULT_ROOT" -type d -empty | sort
```

Any `.md` file in root that isn't `index.md`, `wiki-schema.md`, or `AGENTS.md` is a violation.

## Step 2 — Propose Corrections

For each violation, determine the correct destination using `obsidian-rules.md`. Check whether the target folder already exists — prefer existing folders.

Present a dry-run report:

```
VIOLATIONS FOUND: N

[vault root — misplaced] loose-note.md
  → Projects/CLAUDE-PLUGINS/loose-note.md

[vault root — confirm intent] random-thoughts.md
  → Raw/random-thoughts.md  (inferred from content — or intentional?)
```

Show count by violation type. Ask:
> "Apply these corrections? (yes / no / edit)"

- **"edit"**: walk through each violation individually
- **"no"**: report violations only, apply nothing
- **"yes"**: proceed to Step 3

## Step 3 — Apply Corrections

Only run after user confirmation.

Move with the Obsidian CLI so Obsidian rewrites every link to the note. This vault links by path (`[[Folder/Note]]`), so a plain `mv` breaks those links. Run from the vault root so the CLI targets this vault:

```bash
cd "$VAULT_ROOT"
obsidian vault                                   # must print this vault's path
obsidian eval code="app.vault.getConfig('alwaysUpdateLinks')"   # must print => true
obsidian move path="<source>" to="<destination>"
```

- If `alwaysUpdateLinks` is not `true`, each move stops on an "Update links?" dialog in Obsidian and the command waits. Ask the user to turn on Settings → Files and links → Automatically update internal links first.
- The CLI exits 0 even when a move fails. Count a move only when it prints `Moved:` and the file exists at the new path; report any `Error:` line.
- If `obsidian` is missing or Obsidian is not open on this vault, do not fall back to `mv`. List the pending moves for the user and stop.
- Create no folders first; `obsidian move` creates them. Obsidian may rewrite moved links in its configured link format (shortest path by default); they still resolve.

After all moves, remove empty directories:
```bash
find "$VAULT_ROOT" -type d -empty -delete
```

Report:
- Files moved: N
- Violations remaining (skipped by user): N
- Empty folders removed: N
