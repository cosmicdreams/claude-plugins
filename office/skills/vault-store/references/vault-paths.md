# Vault Path Templates Reference

Complete path template table for all skills that produce output worth preserving in
the Neurons vault. Consult this reference during Step 3 of the `office:vault-store` skill.

---

## Variable Substitution Guide

| Variable | Format | Description |
|---|---|---|
| `{date}` | `YYYY-MM-DD` | ISO date of document creation (today's date unless document is historical) |
| `{project}` | `kebab-case` | Project name slug (e.g., `my-drupal-site`, `client-portal`) |
| `{sprint}` | `kebab-case` | Sprint name slug (e.g., `sprint-3`, `q1-hardening`) |
| `{topic}` | `kebab-case` | Subject of a brainstorm, analysis, or research document |
| `{issue}` | numeric or alphanumeric | Issue number from Drupal.org, GitHub, or Jira (e.g., `3412876`, `GH-142`) |
| `{agent}` | `kebab-case` | Agent role name from a sprint (e.g., `deep-debugger`, `reality-checker`) |
| `{name}` | `kebab-case` | Short descriptive name for the document (e.g., `auth-flow-comparison`) |
| `{module}` | machine name | Drupal module machine name (e.g., `webform`, `paragraphs`) |

When a variable cannot be determined automatically, ask the user once. If they do not
provide a value, use the fallback slug shown in the Special Cases section below.

---

## Full Path Template Table

### retro plugin output

| Output type | Scope | Vault path template | Notes |
|---|---|---|---|
| Session retrospective report | Project | `Retrospectives/{date}+{project}+{sprint}/SESSION-RETROSPECTIVE.md` | Top-level retro summary |
| Agent interview | Project | `Retrospectives/{date}+{project}+{sprint}/interviews/{agent}.md` | One file per agent |
| Retrospective action card | Project | `Retrospectives/{date}+{project}+{sprint}/actions/{date}-{name}.md` | Kanban action items worth preserving |
| Cross-sprint pattern note | Shared | `shared/Patterns/{topic}/{date}-{topic}.md` | Patterns that span multiple sprints or projects |

**Examples:**
- `Retrospectives/2026-03-07+client-portal+sprint-3/SESSION-RETROSPECTIVE.md`
- `Retrospectives/2026-03-07+client-portal+sprint-3/interviews/deep-debugger.md`
- `shared/Patterns/agent-coordination/2026-03-07-task-overflow-pattern.md`

---

### ideate plugin output

| Output type | Scope | Vault path template | Notes |
|---|---|---|---|
| Brainstorm canvas | Shared | `shared/Decisions/{topic}/{date}-{topic}.md` | Full canvas: ideas + annotations + synthesis |
| Decision record | Shared | `shared/Decisions/{topic}/{date}-decision-record.md` | Final synthesized decision only |
| Comparison analysis | Shared | `shared/Analysis/{topic}/{date}-{name}.md` | Side-by-side option comparison |
| Brainstorm canvas (project-specific) | Project | `Projects/{project}/Decisions/{date}-{topic}.md` | When ideation is scoped to one project |

**Examples:**
- `shared/Decisions/vault-routing-approach/2026-03-07-vault-routing-approach.md`
- `shared/Analysis/mcp-vs-skills/2026-03-07-mcp-vs-skills.md`
- `Projects/client-portal/Decisions/2026-03-07-auth-strategy.md`

---

### drupal-lab plugin output

| Output type | Scope | Vault path template | Notes |
|---|---|---|---|
| Issue analysis | Project | `Drupal.org/{project}/{issue}-{name}.md` | Analysis of a specific Drupal.org issue |
| Contribution comment draft | Project | `Drupal.org/{project}/{issue}-contribution-comment.md` | Drafted comment for posting to Drupal.org |
| Module research note | Shared | `shared/Research/drupal/{module}/{date}-{topic}.md` | General module research not tied to one issue |
| Core API exploration | Shared | `shared/Research/drupal/core/{date}-{topic}.md` | Drupal core internals research |
| Patch or diff description | Project | `Drupal.org/{project}/{issue}-patch-notes.md` | Notes accompanying a patch submission |

**Examples:**
- `Drupal.org/drupal/3412876-ckeditor5-toolbar-regression.md`
- `Drupal.org/webform/3398201-contribution-comment.md`
- `shared/Research/drupal/paragraphs/2026-03-07-nested-paragraph-limits.md`
- `shared/Research/drupal/core/2026-03-07-render-pipeline-hooks.md`

---

### sprint plugin output

| Output type | Scope | Vault path template | Notes |
|---|---|---|---|
| Sprint release notes | Project | `Projects/{project}/Releases/{date}+{sprint}-release-notes.md` | Post-sprint RELEASE-NOTES.md |
| Sprint plan | Project | `Projects/{project}/Plans/{date}-{sprint}-plan.md` | Sprint plan produced by `sprint:plan` |
| Asset audit report | Shared | `shared/Analysis/sprint-assets/{date}-asset-audit.md` | Output of `sprint:asset-audit` |

**Examples:**
- `Projects/client-portal/Releases/2026-03-07+sprint-3-release-notes.md`
- `Projects/client-portal/Plans/2026-03-07-sprint-4-plan.md`
- `shared/Analysis/sprint-assets/2026-03-07-asset-audit.md`

---

### office plugin output (this plugin)

| Output type | Scope | Vault path template | Notes |
|---|---|---|---|
| Log analysis report | Project | `Projects/{project}/Reports/{date}-log-analysis.md` | Output of a log-analyzer skill |
| Architecture diagram | Shared or Project | `shared/Architecture/{topic}/{date}-{name}.excalidraw` | Excalidraw diagrams |
| Architecture diagram (project) | Project | `Projects/{project}/Architecture/{date}-{name}.excalidraw` | Project-scoped diagrams |
| Research session | Shared | `shared/Research/{topic}/{date}-{topic}.md` | General research not fitting other categories |
| Meeting notes | Project | `Projects/{project}/Meetings/{date}-{name}.md` | Notes from a specific meeting |
| Reference document | Shared | `shared/Reference/{topic}/{date}-{name}.md` | Evergreen reference material |

**Examples:**
- `Projects/client-portal/Reports/2026-03-07-log-analysis.md`
- `shared/Architecture/plugin-system/2026-03-07-plugin-lifecycle.excalidraw`
- `shared/Research/obsidian-mcp/2026-03-07-obsidian-mcp.md`
- `Projects/client-portal/Meetings/2026-03-07-kickoff.md`

---

## Special Cases

### Drupal.org Project Mapping

When routing Drupal.org content, map the project to a vault folder name:

| Project type | Example | Vault folder |
|---|---|---|
| Drupal core | `drupal/drupal` | `drupal` |
| Contributed module | `project/webform` | `webform` |
| Contributed theme | `project/olivero` | `olivero` |
| Distribution | `project/thunder` | `thunder` |
| Custom/client module | (no Drupal.org URL) | Use `{project}` slug instead, route to `Projects/{project}/` |

Always use the module or project **machine name** (snake_case as it appears on Drupal.org),
not a human-readable label.

### Unknown Project Name

If the project name cannot be determined from context and the user does not provide one:

1. Check document content for clues: git remote URLs, Jira project keys, directory names
2. Ask the user once: "What project should this be filed under? (used as the folder name)"
3. If no answer after one ask: use `unknown-project` as the fallback slug
4. File at: `Projects/unknown-project/...` — user can rename the folder in Obsidian later

### Unknown Sprint Name

If the sprint name cannot be determined:
1. Check for a `kanban/sprint-run/` directory or recent git branch names
2. Ask the user once: "What sprint name should I use? (e.g., sprint-3, q1-hardening)"
3. Fallback: `sprint-unknown`

### Conflicting Files

If a file already exists at the resolved vault path:
- Do not silently overwrite
- Report: "A file already exists at `<path>`. Overwrite, append, or use a new name?"
- Default if no answer: append a numeric suffix (`-2`, `-3`, etc.)

### No Date Available

If `{date}` cannot be determined (no system date access):
- Use `undated` as the date segment
- Example: `Retrospectives/undated+client-portal+sprint-3/SESSION-RETROSPECTIVE.md`
- This should be rare — always prefer the actual ISO date

---

## Path Construction Checklist

Before calling `obsidian create`, verify:

- [ ] Scope determined (project vs. shared)
- [ ] All variables substituted — no bare `{variable}` tokens remain in the path
- [ ] Path uses forward slashes only (no backslashes)
- [ ] File extension matches content type (`.md` for markdown, `.excalidraw` for diagrams)
- [ ] No spaces in path segments — use `kebab-case` throughout
- [ ] Vault root (`$OBSIDIAN_VAULT_NAME`) is set and accessible
