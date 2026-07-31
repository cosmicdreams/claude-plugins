---
name: vault-search
description: >
  Search the Obsidian Neurons vault by content, follow [[wikilinks]] one hop to show each
  hit's neighborhood, and open the top result. For storing new content use
  lib:vault-store.
triggers:
  - vault-search
  - search the vault
  - find in vault
  - search my notes
  - find in my notes
  - do I have a note about
  - look up in my vault
  - what notes mention
  - where did I write about
---

# vault-search

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Graph-aware search across the Obsidian Neurons vault. Finds notes by content, then follows [[wikilinks]] one hop to show the neighborhood around each hit. Opens the top result in Obsidian. Use when the user asks to search, find, or look up anything in the vault or their notes. Trigger phrases: "search the vault", "find in vault", "vault search", "search my notes", "find in my notes", "do I have a note about X", "look up X in my vault", "what notes mention X", "where did I write about X". Do NOT trigger for: listing or browsing vault files (use Glob), linting notes (workshop:obsidian-lint), organizing notes (workshop:organize), storing new content (lib:vault-store), or Pulse/board operations.

Graph-aware search of the Neurons vault. Read-only — never modifies vault files.

## Vault root

```
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
VAULT_NAME="${OBSIDIAN_VAULT_NAME:-Neurons}"
```

Use `VAULT_ROOT` for all file operations. Use `VAULT_NAME` for the Obsidian URI.

## Step 1 — Parse the query

Extract search term(s) from the user's message. Strip any slash-command prefix.
If no query is provided, ask: "What are you searching for?"

## Step 2 — Search

Use the **Grep** tool — never Bash `rg` or `grep`.

Run a single content search with context for both file identification and excerpt display:

```
Grep(
  pattern: "<QUERY>",
  path: VAULT_ROOT,
  glob: "*.md",
  -i: true,
  -C: 1,
  output_mode: "content",
  head_limit: 50
)
```

Discard any results in `.obsidian/`, `Archive/`, or `Scratches/` directories.

If zero results remain, report "No matches for '<QUERY>'" and stop.

Extract the list of unique matching file paths from the output.

## Step 3 — Gather wikilinks from hits

For each matching file (cap at top 5 by match count), extract outbound `[[wikilinks]]` using Grep:

```
Grep(
  pattern: "\\[\\[([^\\]|]+)",
  path: "<matching-file>",
  output_mode: "content"
)
```

Parse link targets: strip `[[` prefix and any `|display text` suffix.

Run these Grep calls in parallel — one per file.

## Step 4 — Resolve neighbors

For each unique link target, resolve to a vault file using Glob:

```
Glob(
  pattern: "**/<link-target>.md",
  path: VAULT_ROOT
)
```

Batch these Glob calls in parallel. Collect resolved paths as the 1-hop neighborhood.

Stop at 1 hop — deeper traversal produces noise.

## Step 5 — Rank and display

Rank matching files by match count (number of query hits in the file). Break ties by link density (more outbound wikilinks = more connected).

Present top 5:

```
Search: "<query>"
Found: N files

1. <relative-path-from-vault-root>
   "<matching line excerpt, truncated at 80 chars>"
   Links to: [[Note A]], [[Note B]]

2. <relative-path>
   "<excerpt>"
   Links to: [[Note C]]

Neighborhood (1-hop):
  - Note A  (path/to/note-a.md)
  - Note B  (path/to/note-b.md)
  - Note C  (path/to/note-c.md)
```

## Step 6 — Open in Obsidian

Open the #1 result via URI scheme:

```bash
open "obsidian://open?vault=${VAULT_NAME}&file=<url-encoded-relative-path>"
```

URL-encode the relative path from vault root (spaces to `%20`, slashes to `%2F`).

Tell the user: "Opened in Obsidian. Pin the Local Graph panel to auto-focus on each opened note."

## Step 7 — Follow-up

Ask: "Open another result, search a connected note, or done?"

- User picks a number: open that result via the same URI pattern.
- User names a connected note: re-run from Step 2 with that title as the query.

## Constraints

- **Read-only.** Never modify vault files.
- **Grep and Glob only.** Never use Bash for searching or file resolution.
- **One Obsidian open per turn.** Multiple opens confuse the Local Graph focus.
- **Excluded dirs:** `.obsidian/`, `Archive/`, `Scratches/` — always filter these out.
