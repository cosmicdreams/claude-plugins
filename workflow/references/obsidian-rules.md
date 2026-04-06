# Obsidian Vault Rules

Vault root: `~/Vaults/$OBSIDIAN_VAULT_NAME` (default: `Neurons`)

## Placing content

Before creating any folder, scan what already exists and prefer an existing folder
over creating a new one — even if the casing or singular/plural differs slightly.
Only create a new folder when nothing in the vault is a reasonable match.

When ingesting content or creating wiki pages, read `wiki-schema.md` at vault root first.

## Top-level structure

| Folder | What belongs here |
|--------|-------------------|
| `Raw/` | Unprocessed input: daily notes, web clips, funnel graduates. Ingest processes these. |
| `Sources/` | Processed summaries of raw inputs (one per ingested item) |
| `Concepts/` | Living topic pages — patterns, techniques, trends. Updated as knowledge arrives. |
| `Entities/` | People, tools, companies, products. Updated as knowledge arrives. |
| `Projects/` | Work scoped to a specific client, internal project, or open source effort |
| `Next-Experiments/` | Actionable experiments graduated from the funnel or ingest |
| `Architecture/` | System design, ADRs, component relationships, diagrams |
| `Retrospectives/` | Sprint and team retrospectives |
| `Scratches/` | Working scratch space, organized by project |
| `Personal/` | Personal notes, ideas, non-work content |
| `Research/` | General research topics (AI-Ecosystem, Claude-Plugins, Security) |
| `Archive/` | Retired content, historical records |

## Projects structure

Each project gets its own folder. Within a project, use purpose subfolders
that mirror the top-level taxonomy where relevant.

```
Projects/
  <project-name>/
    Research/
    Analysis/
    Decisions/
    Architecture/
    ...
  OpenSource/
    Drupal.org/
      drupal/
      <module-name>/
```

Only create subfolders that are actually needed — don't pre-populate empty folders.

## Wiki page conventions

See `wiki-schema.md` at vault root for full details on page types and ingest workflow.

- **Concepts and Entities** use title-case names without date prefixes (`MCP.md`, `Anthropic.md`)
- **Sources** use date-prefixed names (`2026-04-06-llm-wiki-pattern.md`)
- **Experiments** use date-prefixed names (`2026-04-06-ollama-evaluation.md`)

## Path pattern

`<Purpose>/<Topic>/<descriptor.ext>`

Add the `<Topic>` level when multiple files share the same subject. Keep it flat
(`<Purpose>/<descriptor.ext>`) when there is only one file on that subject.

## File naming

- kebab-case: `obsidian-skill-gap-analysis.md`
- Date-prefix for time-ordered content: `YYYY-MM-DD-topic.md`
- No spaces, no underscores

## What does not belong here

There is no `shared/` folder. Everything in the vault is shared by definition.
If you see a `shared/` prefix on an existing path, it should be removed and the
file moved to the top-level purpose folder.
