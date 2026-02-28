---
name: project-notes
description: Synthesize completed sprint cards into a RELEASE-NOTES.md entry. Use when asked to "write release notes", "project release notes", "document completed cards", or "RELEASE-NOTES.md". Reads 7_done/ cards and git log, drafts a structured entry, asks for confirmation, then prepends to analysis-reports/RELEASE-NOTES.md.
allowed-tools: Read, Bash, Write, Edit, Glob
---

# sprint:project-notes

Synthesize completed kanban cards from `kanban/sprint-run/7_done/` into a structured `analysis-reports/RELEASE-NOTES.md` entry.

This is the project-level complement to `sprint:release-notes` (which reads the plugin CHANGELOG). This skill reads sprint outcomes, not plugin version history.

## Step 1: Read Completed Cards

Scan `kanban/sprint-run/7_done/` for all `.md` files.

```bash
ls kanban/sprint-run/7_done/*.md 2>/dev/null || echo "EMPTY"
```

If the directory is empty or no `.md` files exist, output:

```
No completed cards to document.
```

and stop.

For each card found, extract:
- `id` — from frontmatter `id:` field
- `title` — from the first `# ` heading in the body
- `issue` — from frontmatter `issue:` field (optional; may not be present)
- `## Narrative` — the full narrative section from the card body

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

Do NOT delete, archive, or modify the `7_done/` cards — card management is the team-lead's responsibility.

## Notes

- Works with zero or multiple cards: always check the count before proceeding
- Each card becomes its own entry — do not combine multiple cards into one entry
- If a card's Narrative is sparse, synthesize from the card title and Acceptance Criteria
- The `sprint:release-notes` skill reads `sprint/CHANGELOG.md` (plugin version history) — that skill is separate and unrelated to this one
