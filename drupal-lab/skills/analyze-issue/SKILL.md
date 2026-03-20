---
name: analyze-issue
description: Analyze a Drupal.org issue and produce a structured analysis report. Use when asked to analyze, research, or investigate a drupal.org issue number -- e.g. "analyze issue 2901667", "look into this Drupal bug", "research this drupal.org issue". Fetches issue data, filters comments, discovers patches/MRs, assesses complexity, and saves a report to analysis-reports/. Do NOT use for browsing or listing issues -- use drupal-lab:browse-drupal-issues instead.
---

# Analyze Drupal Issue

Analyze a Drupal issue and generate a standardized analysis report.

## Input

## Context Awareness
**Important**: Resolve the active project root from `~/.claude/drupal-lab.json` before running any commands. See `drupal-lab/references/project-context.md` for the resolution steps. All relative paths (`./worktrees/...`) are relative to that root. If inside a worktree (`..../worktrees/1234`), `cd ../..` to return to the project root.

Issue number or URL from drupal.org (e.g., `2901667`, `https://www.drupal.org/project/drupal/issues/2901667`)

## Workflow

### 1. Fetch Issue Data
- Fetch from `https://www.drupal.org/project/drupal/issues/{issue_number}`
- Extract: title, status, priority, component, version, assigned users, created/updated dates

### 2. Comment Analysis
- Prioritize: maintainer responses, comments with patches/MRs/code, solution proposals, status changes
- Skip: "+1" comments, "thank you" messages, non-technical content
- Include latest 3-5 substantive comments

### 3. Patch & MR Discovery
- Find most recent .patch files and interdiffs
- Extract GitLab MR links, status, branch info, review feedback
- Summarize scope of changes (files affected, line counts)

### 4. Analyze Affected Code
- Grep/Read affected files in the codebase
- Use `LSP goToDefinition` to trace classes and methods to their source — don't grep for `class ClassName`
- Use `LSP findReferences` to map all callers of a changed method — this reveals blast radius
- Use `LSP goToImplementation` to find all implementations of an interface affected by the issue
- Use `LSP hover` to check method signatures and return types when assessing API compatibility
- Fall back to Grep for string literals, config keys, hook names, and non-PHP files
- Identify jQuery patterns, conversion opportunities, or bug root causes
- Note API changes, dependencies, backwards compatibility implications

### 5. Assess Complexity
- **Simple**: 1-3 files, straightforward fix, clear approach
- **Medium**: 4-10 files, multiple concerns, needs tests
- **Complex**: 10+ files, architectural decisions, cross-module impact

### 6. Generate Report
Save to `./analysis-reports/{issue_number}.md`

## Report Sections

```
# Issue #{issue_number} Analysis

## Issue Details (title, status, component, priority, link)
## Problem Summary (1-2 sentences)
## Affected Files (list)
## Key Discussion Points (summarized high-value comments)
## Current Solutions (latest patch, MR status, alternative approaches)
## Complexity Assessment (level, files to modify, test coverage needed)
## Implementation Notes (edge cases, dependencies, blockers)
## Next Steps (create worktree, implement, test, validate)
```

## Key Points

- Be concise but thorough
- Focus on actionable information
- Identify jQuery patterns needing conversion (if applicable)
- Flag testing requirements early
- Note existing MRs/patches to build on rather than starting from scratch

## Obsidian Storage

After the analysis report is written to `./analysis-reports/{issue_number}.md`, also archive it to the Neurons vault. Obsidian is assumed to be running — if the write fails, run `obsidian help` to diagnose the connection.

### Project Mapping

Extract the Drupal project name from the issue URL:
- `https://www.drupal.org/project/drupal/issues/3345989` → project = `drupal`
- `https://www.drupal.org/project/webform/issues/3401234` → project = `webform`
- Drupal core issues use the `drupal` folder; contrib modules use the module's machine name.

### Vault Path

```
~/Vaults/Neurons/OpenSource/Drupal.org/<project>/<issue-number>-<kebab-slug-of-title>.md
```

Examples:
```
OpenSource/Drupal.org/drupal/3345989-loading-indicator-accessibility.md
OpenSource/Drupal.org/webform/3401234-validation-bug.md
```

### Archive Command

```bash
DRUPAL_PROJECT="<extracted-from-issue-url>"
ISSUE_NUMBER="<issue-number>"
ISSUE_SLUG="<kebab-title>"
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
DEST_PATH="OpenSource/Drupal.org/${DRUPAL_PROJECT}/${ISSUE_NUMBER}-${ISSUE_SLUG}.md"

mkdir -p "$VAULT_ROOT/$(dirname "$DEST_PATH")"
cat > "$VAULT_ROOT/$DEST_PATH" << 'EOF'
<analysis-report-content>
EOF
```

### YAML Frontmatter

Prepend the following frontmatter to the stored document (substitute actual values):

```yaml
---
drupal_project: drupal
issue_number: 3345989
issue_title: "Loading indicator accessibility"
date: 2026-03-07
tags: [drupal, issue-analysis, <project>]
---
```

This frontmatter enables cross-issue pattern queries — e.g., find all `drupal` + `accessibility` tagged issues across the vault.
