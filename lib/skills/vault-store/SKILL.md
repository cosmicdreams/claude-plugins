---
name: vault-store
description: >
  Routes and stores documents, reports, diagrams, and analysis into the Obsidian
  Neurons vault. Invoke after any skill produces output worth keeping, or when the
  user wants to save something to the vault. Trigger phrases: "save to vault",
  "store in Obsidian", "archive this report", "put this in the vault", "save to
  Neurons". Also triggered when other skills (retro, ideate, drupal-lab) produce
  reports that should be preserved. Do NOT use for organizing or moving notes
  already in the vault — use workflow:organize for that.
---

# lib:vault-store

Route and store documents to the correct Neurons vault location using the 5-step process below.

## Vault root

Default: `~/Vaults/Neurons`

Override: set `OBSIDIAN_VAULT_NAME` in env or `~/.config/office/config`. Only needed if your vault is named something other than `Neurons`.

## Step 1: Determine vault path

Read `obsidian-rules.md` to determine correct placement:
```bash
ls ~/.claude/plugins/cache/local/workflow/*/references/obsidian-rules.md | sort -V | tail -1 | xargs cat
```

Check existing vault folders before creating new ones — prefer matching an existing
folder over creating a new one.

Quick reference (substitute actual values for placeholders):

| Content type | Vault path |
|---|---|
| Retro session report | `Retrospectives/YYYY-MM-DD+project+sprint/SESSION-RETROSPECTIVE.md` |
| Retro agent interview | `Retrospectives/YYYY-MM-DD+project+sprint/interviews/agent.md` |
| Brainstorm canvas | `Decisions/topic/YYYY-MM-DD-topic.md` |
| Excalidraw diagram | `Architecture/topic/YYYY-MM-DD-name.excalidraw` |
| Comparison analysis | `Analysis/topic/YYYY-MM-DD-name.md` |
| Research session | `Research/topic/YYYY-MM-DD-topic.md` |
| Drupal issue analysis | `OpenSource/Drupal.org/project/issue-number-short-title.md` |
| Drupal contribution comment | `OpenSource/Drupal.org/project/issue-number-contribution-comment.md` |
| Log analysis report | `Projects/project/Reports/YYYY-MM-DD-log-analysis.md` |
| Skill eval record | `Skill-Evals/plugin/skill-name/YYYY-MM-DD-eval.md` |

## Step 4: Author as Obsidian Flavored Markdown

Before writing, wrap the content in proper OFM structure using the `obsidian-markdown` skill conventions.

**Required frontmatter** (add to top of every `.md` note):

```yaml
---
title: "Human-readable title"
date: YYYY-MM-DD
tags:
  - relevant-tag
  - second-tag
source: "origin of the content (skill name, notebook title, URL, etc.)"
---
```

**Tag selection:** Choose from existing vault tags where applicable (`#drupal`, `#sprint`, `#ai-agents`, `#mcp`, `#skills`, `#research`, `#automation`, etc.). Add new tags only when no existing tag fits.

**Wikilinks:** If the content references topics that have related notes already in the vault, add `[[wikilinks]]` inline. Don't force links — only add them when the connection is genuine and the target note exists.

**Callouts:** Use `> [!note]`, `> [!warning]`, `> [!tip]` for key takeaways or important caveats worth highlighting.

Skip OFM authoring (pass content through as-is) when:
- The file is not `.md` (e.g., `.excalidraw`, `.canvas`, `.base`)
- The content already has valid YAML frontmatter

## Step 5: Write to vault

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
DEST_PATH="<resolved-path>"
mkdir -p "$VAULT_ROOT/$(dirname "$DEST_PATH")"
cat > "$VAULT_ROOT/$DEST_PATH" << 'EOF'
<authored-content-with-frontmatter>
EOF
```

Report: "Saved to Neurons: DEST_PATH"
On failure: report the error, preserve the local file, do not retry automatically.

## Step 6: Add vault link to local output

If the document was also written locally, append a breadcrumb line to the local file:

```
---
_Archived to Obsidian: Neurons/path_
```

**Why this matters:** The breadcrumb ensures local files and vault copies stay linked. Without it, you lose the connection between the local report and its vault location after the session ends.
