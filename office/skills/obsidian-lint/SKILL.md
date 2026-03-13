---
name: obsidian-lint
description: >
  Audits the Obsidian vault against obsidian-rules.md and corrects violations:
  misplaced files, wrong folder structure, legacy shared/ prefixes, and naming
  that doesn't follow conventions. Runs a dry-run by default — shows proposed
  moves before applying anything. Trigger phrases: "lint my vault", "audit the
  vault", "fix vault structure", "check vault paths", "vault has wrong folders",
  "clean up vault structure", "remove shared/ from vault".
---

# office:obsidian-lint

Audits and corrects vault structure against `obsidian-rules.md`. Filesystem-only —
does not require Obsidian to be running.

## Setup

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
RULES=$(ls ~/.claude/plugins/cache/local/office/*/references/obsidian-rules.md 2>/dev/null | sort -V | tail -1)
```

Read the rules file before scanning: `cat "$RULES"`

## Phase 1: Scan for violations

Check the vault for each of these violation types:

**1. Legacy `shared/` prefix**
```bash
find "$VAULT_ROOT/shared" -type f 2>/dev/null | sort
```
Any file under `shared/` is a violation — `shared/` is not a valid top-level folder.

**2. Drupal content outside OpenSource/**
```bash
find "$VAULT_ROOT/Drupal.org" -type f 2>/dev/null | sort
```
Drupal.org content should live under `OpenSource/Drupal.org/`, not at vault root.

**3. Files in vault root**
```bash
find "$VAULT_ROOT" -maxdepth 1 -type f -name "*.md" | sort
```
All notes should be inside a purpose folder.

**4. Empty folders**
```bash
find "$VAULT_ROOT" -type d -empty | sort
```

## Phase 2: Propose corrections

For each violation, determine the correct destination by applying `obsidian-rules.md`.
Check whether the target folder already exists — prefer existing folders.

Present a dry-run report:
```
VIOLATIONS FOUND: N

[legacy shared/] shared/Research/topic/file.md
  → Research/topic/file.md

[wrong location] Drupal.org/drupal/3345989-issue.md
  → OpenSource/Drupal.org/drupal/3345989-issue.md

[vault root] my-loose-note.md
  → Research/topic/my-loose-note.md  (inferred from content)
```

Show count of violations by type. Ask:
> "Apply these corrections? (yes / no / edit)"

If **"edit"**: walk through each violation individually.
If **"no"**: report the violations list only, apply nothing.

## Phase 3: Apply corrections (after confirmation only)

For each correction:
```bash
mkdir -p "$VAULT_ROOT/$(dirname "<destination>")"
mv "$VAULT_ROOT/<source>" "$VAULT_ROOT/<destination>"
```

After all moves, remove any empty directories left behind:
```bash
find "$VAULT_ROOT" -type d -empty -delete
```

## Phase 4: Summary

Report:
- Files moved: N
- Violations remaining (skipped by user): N
- Empty folders removed: N
