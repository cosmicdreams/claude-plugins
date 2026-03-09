---
name: project-notes
description: Synthesize completed sprint beads into a structured RELEASE-NOTES.md entry. Use when asked to "write release notes", "project release notes", "document completed cards", "summarize what we shipped", "what did the sprint accomplish", or "update RELEASE-NOTES.md". Reads closed beads from .beads/sprint.db and git log, drafts entries, confirms with team-lead, then prepends to analysis-reports/RELEASE-NOTES.md. Do NOT confuse with sprint:release-notes (changelog) which reads the plugin CHANGELOG.md version history -- this skill documents project-level sprint outcomes, not plugin versions.
allowed-tools: Read, Bash, Write, Edit, Glob
---

# sprint:project-notes

Synthesize completed sprint beads from `.beads/sprint.db` into a structured `analysis-reports/RELEASE-NOTES.md` entry.

This is the project-level complement to `sprint:release-notes` (which reads the plugin CHANGELOG). This skill reads sprint outcomes, not plugin version history.

## Step 1: Read Completed Beads

Query closed sprint beads from the Beads database:

```bash
bd --db .beads/sprint.db list -s closed --json
```

If the result is empty, output:

```
No completed beads to document.
```

and stop.

For each closed bead, extract:
- `id` — the bead's hash ID
- `title` — the bead title
- `issue` — from labels matching `issue-*` (e.g., `issue-2901667` → issue `2901667`)
- `notes` — the bead's append-only notes (equivalent to the old Narrative section)

## Step 2: Check for Git Log (cards with issue: field)

For cards that have an `issue:` frontmatter field, check whether a matching worktree exists:

```bash
ls worktrees/<issue-number>/ 2>/dev/null && echo "worktree exists"
```

If the worktree exists, read the git log for context:

```bash
git -C worktrees/<issue-number>/ log --oneline --no-merges -10 2>/dev/null
```

Use the commit messages to supplement the Narrative when drafting the entry. If no worktree exists, rely solely on the card Narrative.

## Step 3: Draft RELEASE-NOTES.md Entry

Draft one entry per card using this exact format:

```markdown
## YYYY-MM-DD — {Card Title or Issue #NNNNNN: Short Title}

- **What changed**: One-sentence summary of what was added or fixed
- **Files touched**: List key files modified (from git log or Narrative; omit if unknown)
- **Approach**: One paragraph on the technical approach taken
- **MR/patch**: Link or reference when submitted (omit or write "pending" if not yet submitted)
```

Use today's date (ISO format) for `YYYY-MM-DD`.

For cards with an `issue:` field, use `Issue #<number>: <short title>` as the heading suffix.
For cards without an `issue:` field, use the card title directly.

Write all drafted entries to the conversation for review — do NOT write to any file yet.

## Step 4: Confirm with Team-Lead

Show the drafted entries and ask:

```
Draft complete. Ready to prepend to analysis-reports/RELEASE-NOTES.md?
Reply YES to confirm, or provide corrections.
```

Wait for explicit confirmation before writing.

## Step 5: Write to RELEASE-NOTES.md

On confirmation:

1. Read `analysis-reports/RELEASE-NOTES.md` if it exists (to preserve existing content)
2. Prepend the new entries (newest entries at top, separated by blank lines)
3. Write the updated file

If `analysis-reports/RELEASE-NOTES.md` does not exist, create it with just the new entries.

Do NOT close, delete, or modify beads — bead lifecycle management is the team-lead's responsibility.

## Notes

- Works with zero or multiple cards: always check the count before proceeding
- Each card becomes its own entry — do not combine multiple cards into one entry
- If a card's Narrative is sparse, synthesize from the card title and Acceptance Criteria
- The `sprint:release-notes` skill reads `sprint/CHANGELOG.md` (plugin version history) — that skill is separate and unrelated to this one
