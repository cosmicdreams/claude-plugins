---
name: vault-store
description: >
  Intelligently routes and stores documents, reports, diagrams, and analysis into
  the Obsidian Neurons vault. Handles project-vs-shared routing, health checks,
  and write confirmation. Use when any skill produces a persistent document that
  should be saved to Obsidian. Called by other office skills after producing output.
  Trigger phrases: "save to vault", "store in Obsidian", "archive this report",
  "put this in the vault", "save to Neurons". Also used internally by other skills
  that produce reports (retro, ideate, drupal-lab).
---

# office:vault-store

Central Obsidian routing skill. Determines where a document belongs in the Neurons
vault and writes it there. Called after any skill produces output worth preserving.

## Vault root

Default: `~/Vaults/Neurons`
Override: set `OBSIDIAN_VAULT_NAME=Neurons` (or another vault name) in env or
`~/.config/office/config`.

## Step 1: Health check (always first)

```bash
obsidian help
```

If this fails: warn the user that Obsidian is not reachable, but **do not block the
calling skill from completing**. Vault storage is always optional/additive — the
primary output was already produced. Just note: "Vault storage skipped (Obsidian not running)."

## Step 2: Determine document scope

Ask: **Is this document tied to a specific project, issue, or client?**

Route to `Projects/` if ANY of these are true:
- The content references a specific named project
- It contains a Jira/GitHub issue number or Drupal issue number
- It is a sprint release note, retro, or analysis for one specific codebase
- The user explicitly says "this is for [project name]"

Route to `shared/` if ANY of these are true:
- The content captures general methodology, patterns, or process learnings
- It is a brainstorm, decision record, or architectural comparison not tied to one project
- It is a retrospective pattern that spans multiple projects
- The user explicitly says it should be reusable across projects

When unsure: ask the user one question: "Is this specific to [detected project name], or shared knowledge?"

## Step 3: Determine vault path

See `references/vault-paths.md` for the full path template table.

Quick reference:

| Content type | Scope | Vault path |
|---|---|---|
| Retro session report | Project | `Retrospectives/<YYYY-MM-DD>+<project>+<sprint>/SESSION-RETROSPECTIVE.md` |
| Retro agent interview | Project | `Retrospectives/<YYYY-MM-DD>+<project>+<sprint>/interviews/<agent>.md` |
| Brainstorm canvas | Shared | `shared/Decisions/<topic>/<YYYY-MM-DD>-<topic>.md` |
| Excalidraw diagram | Shared or Project | `shared/Architecture/<topic>/<YYYY-MM-DD>-<name>.excalidraw` |
| Comparison analysis | Shared | `shared/Analysis/<topic>/<YYYY-MM-DD>-<name>.md` |
| Research session | Shared | `shared/Research/<topic>/<YYYY-MM-DD>-<topic>.md` |
| Drupal issue analysis | Project | `Drupal.org/<project>/<issue-number>-<short-title>.md` |
| Drupal contribution comment | Project | `Drupal.org/<project>/<issue-number>-contribution-comment.md` |
| Log analysis report | Project | `Projects/<project>/Reports/<YYYY-MM-DD>-log-analysis.md` |

## Step 4: Write to vault

```bash
obsidian create \
  --vault="$OBSIDIAN_VAULT_NAME" \
  --path="<resolved-path>" \
  --content="<document-content>"
```

On success: report "✅ Saved to Neurons: <path>"
On failure: report the error, preserve the local file, do not retry automatically.

## Step 5: Add vault link to local output (optional)

If the document was also written locally, append a line to the local file:
```
---
_Archived to Obsidian: Neurons/<path>_
```

This creates a breadcrumb so the local file is traceable.
