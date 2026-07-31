---
name: analyze-issue
description: >
  Analyze one Drupal.org issue by number into a structured report — fetches the issue,
  filters comments, finds patches and merge requests, assesses complexity. Not for
  browsing or listing issues (drupal-lab:browse-drupal-issues).
---

# Analyze Drupal Issue

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Analyze a Drupal.org issue and produce a structured analysis report. Use when asked to analyze, research, or investigate a drupal.org issue number -- e.g. "analyze issue 2901667", "look into this Drupal bug", "research this drupal.org issue". Fetches issue data, filters comments, discovers patches/MRs, assesses complexity, and saves a report to analysis-reports/. Do NOT use for browsing or listing issues -- use drupal-lab:browse-drupal-issues instead.

Analyze a Drupal issue and produce `analysis.json` plus a human-readable render.

## Input

Issue number or URL from drupal.org (e.g., `2901667`,
`https://www.drupal.org/project/drupal/issues/2901667`)

Resolve project root from `~/.claude/drupal-lab.json`. See
`drupal-lab/references/project-context.md`.

## Workflow

### 1. Fetch Issue Data

Fetch from `https://www.drupal.org/project/drupal/issues/{issue_number}`.

Extract: title, status, priority, component, version, assigned users, created/updated dates.

### 2. Comment Analysis

Prioritize: maintainer responses, comments with patches/MRs/code, solution proposals,
status changes. Skip: "+1" comments, "thank you" messages, non-technical content.
Include the latest 3–5 substantive comments.

### 3. Patch and MR Discovery

Find most recent `.patch` files and interdiffs. Extract GitLab MR links, status, branch
info, and review feedback. Summarize scope of changes (files affected, line counts).

### 4. Analyze Affected Code

Use LSP for code navigation where PHP-aware traversal is valuable:
- `goToDefinition` to trace a class or method to its source — not `Grep "class Foo"`
- `findReferences` to map all callers of a changed method (reveals blast radius)
- `goToImplementation` to find all implementations of an interface affected by the issue
- `hover` to check method signatures and return types when assessing API compatibility

Fall back to Grep for string literals, config keys, hook names, and non-PHP files.

Identify jQuery patterns, conversion opportunities, or bug root causes. Note API changes,
dependencies, and backwards compatibility implications.

### 5. Assess Complexity

- **Simple**: 1–3 files, straightforward fix, clear approach
- **Medium**: 4–10 files, multiple concerns, needs tests
- **Complex**: 10+ files, architectural decisions, cross-module impact

### 6. Write Output

Write `analysis-reports/drupal-issue/<issue>/analysis.json`. Full schema in
`drupal-lab/references/issue-handoffs.md`.

Also render a human-readable summary to `analysis-reports/drupal-issue/<issue>.md`.

## Obsidian Archive

Archive to the Neurons vault at:
```
~/Vaults/Neurons/OpenSource/Drupal.org/<project>/<issue-number>-<kebab-slug-of-title>.md
```

Extract the project name from the issue URL:
- `https://www.drupal.org/project/drupal/issues/3345989` → project = `drupal`
- `https://www.drupal.org/project/webform/issues/3401234` → project = `webform`

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
DEST_PATH="OpenSource/Drupal.org/${DRUPAL_PROJECT}/${ISSUE_NUMBER}-${ISSUE_SLUG}.md"
mkdir -p "$VAULT_ROOT/$(dirname "$DEST_PATH")"
```

Prepend YAML frontmatter:
```yaml
---
drupal_project: drupal
issue_number: 3345989
issue_title: "Loading indicator accessibility"
date: 2026-03-07
tags: [drupal, issue-analysis, <project>]
---
```
