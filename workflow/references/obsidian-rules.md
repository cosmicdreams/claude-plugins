# Obsidian Vault Rules

Vault root: `~/Vaults/$OBSIDIAN_VAULT_NAME` (default: `Neurons`)

## Placing content

Before creating any folder, scan what already exists and prefer an existing folder
over creating a new one — even if the casing or singular/plural differs slightly.
Only create a new folder when nothing in the vault is a reasonable match.

## Top-level structure

| Folder | What belongs here |
|--------|-------------------|
| `Projects/` | Work scoped to a specific client or internal project |
| `OpenSource/` | Open source contributions, issues, and research |
| `Research/` | Background reading, investigation findings, external sources |
| `Analysis/` | Structured comparisons, evaluations, gap analyses |
| `Decisions/` | ADRs, option selections, rationale documents |
| `Architecture/` | System design, component relationships, diagrams |
| `Retrospectives/` | Sprint and team retrospectives |
| `Skill-Evals/` | Skill evaluation records |

## OpenSource structure

Open source work is grouped by domain (the platform or ecosystem it belongs to).
Each domain gets its own folder. Within a domain, each project gets its own folder.

```
OpenSource/
  Drupal.org/
    drupal/          ← Drupal core contributions
    same_page_preview/
    <module-name>/   ← each contrib module gets its own folder
  <other-domain>/    ← other ecosystems follow the same pattern
```

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
```

Only create subfolders that are actually needed — don't pre-populate empty folders.

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
