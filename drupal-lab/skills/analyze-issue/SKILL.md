---
name: analyze-issue
description: Analyze Drupal issues from drupal.org issue queue and generate standardized analysis reports. Use when asked to analyze an issue, research a drupal.org issue number, or investigate a Drupal bug. Fetches issue data, filters comments, discovers patches/MRs, and assesses complexity.
---

# Analyze Drupal Issue

Analyze a Drupal issue and generate a standardized analysis report.

## Input

## Context Awareness
**Important**: All relative paths (e.g. `./worktrees/...`) assume you are executing from the **Project Root** (e.g. `~/OpenSource/SAME_PAGE_PREVIEW`).
- The Project Root is the folder that *contains* the `worktrees/` and `kanban/` directories.
- If you are inside a worktree (e.g. `.../worktrees/1234`), you must `cd ../..` to return to the Project Root before running commands.

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

After the analysis report is written to `./analysis-reports/{issue_number}.md`, also archive it to the Neurons vault. This step is **optional and non-blocking** — skip silently if Obsidian is not running.

### Project Mapping

Extract the Drupal project name from the issue URL:
- `https://www.drupal.org/project/drupal/issues/3345989` → project = `drupal`
- `https://www.drupal.org/project/webform/issues/3401234` → project = `webform`
- Drupal core issues use the `drupal` folder; contrib modules use the module's machine name.

### Vault Path

```
~/Vaults/Neurons/Drupal.org/<project>/<issue-number>-<kebab-slug-of-title>.md
```

Examples:
```
Drupal.org/drupal/3345989-loading-indicator-accessibility.md
Drupal.org/webform/3401234-validation-bug.md
```

### Archive Command

```bash
# Health check — non-blocking
obsidian help || { echo "Vault storage skipped (Obsidian not running)"; exit 0; }

# Resolve project name from issue URL
# e.g. https://www.drupal.org/project/drupal/issues/3345989 → DRUPAL_PROJECT="drupal"
# e.g. https://www.drupal.org/project/webform/issues/3401234 → DRUPAL_PROJECT="webform"
DRUPAL_PROJECT="<extracted-from-issue-url>"
ISSUE_NUMBER="<issue-number>"
ISSUE_SLUG="<kebab-title>"

obsidian create \
  --vault=Neurons \
  --path="Drupal.org/${DRUPAL_PROJECT}/${ISSUE_NUMBER}-${ISSUE_SLUG}.md" \
  --content="<analysis-report-content>"
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
