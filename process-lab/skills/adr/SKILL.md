---
name: adr
description: >
  Record an Architecture Decision Record (ADR) for a decision that is hard to reverse,
  surprising without context, and a real trade-off. Writes to the repository's docs/adr/,
  or to the Neurons vault outside a repository. Not for checking what a project's process
  still requires (process-lab:lint).
allowed-tools: Bash, Read, Write
---

# process-lab:adr — Architecture Decision Record

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Record why a project made a decision, so the next developer or agent doesn't argue it again or "fix" something that was deliberate. Use for architectural shape, integration patterns, technology choices with lock-in, boundary and scope decisions, deliberate deviations from the obvious path, constraints not visible in the code, and documenting why something was NOT done. Trigger phrases: "architecture decision", "adr", "document this decision", "record this decision", "why we chose", "process-lab:adr".

## Step 1: Test the decision

Write an ADR only when all three are true:

1. **Hard to reverse:** changing your mind later has a real cost.
2. **Surprising without context:** a future reader would ask "why did they do it this way?"
3. **A real trade-off:** there were genuine alternatives, and one was picked for specific reasons.

If any is false, name the condition that failed, say you won't write it, and stop. An easy-to-reverse choice gets reversed; an unsurprising one raises no question; one with no alternative has nothing to record.

When the user explicitly asks to record it anyway ("record this decision"), write it and note which condition it failed.

## Step 2: Gather fields

Extract what you can from `$ARGUMENTS` and the conversation; ask only for what's missing.

| Field | Required | Description |
|---|---|---|
| `title` | yes | Short decision title |
| `summary` | yes | One to three sentences: the context, what was decided, and why |
| `status` | no | `proposed`, `accepted` (default), `deprecated`, or `superseded` |
| `options` | no | Only when the rejected alternatives are worth remembering |
| `consequences` | no | Only when non-obvious downstream effects need calling out |
| `supersedes` | no | The ADR this replaces |

## Step 3: Choose where it goes

- **Repository (default).** When `git rev-parse --show-toplevel` succeeds, write to `docs/adr/` at that root. Create the folder on first use. Number the file after the highest existing one: `NNNN-<slug>.md`, starting at `0001`. This is an edit to the repository, so it follows the project's worktree rules like any other edit.
- **Vault.** When not in a repository, or when the user asks for the vault (cross-project decisions), write to `$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}/Architecture/ADRs/<YYYY-MM-DD>-<slug>.md`.

Slug: lowercase title, spaces to hyphens, special characters stripped, at most 50 characters.

## Step 4: Write it

```markdown
---
title: {title}
date: {YYYY-MM-DD}
status: {status}
{supersedes: {old ADR}   ← only if provided}
---

# {title}

{summary}

{## Considered options   ← only if provided}

{## Consequences   ← only if provided}
```

An ADR can be a single paragraph. Its value is recording that a decision was made, and why.

On a write failure, print the formatted ADR in the conversation so it is not lost, then report the error.

## Step 5: Confirm

Report the title, status and path. If `supersedes` was set, offer to set the old ADR's status to `superseded` and add a line to its body linking the new one.
