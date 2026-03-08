---
name: issue-summary
description: Use after a fix is implemented and validated, when ready to post a contribution comment to drupal.org. Invoke after drupal-lab:validate-patch passes. Trigger phrases: 'write the issue summary', 'generate the drupal.org comment', 'write up the fix for posting', 'prepare the contribution comment'.
---

# Issue Summary

Generate a drupal.org contribution comment that summarizes what was fixed and how to verify it. Run this after `reviewer` passes on a worktree.

## Input

Issue number. The worktree path is inferred as `./worktrees/{issue_number}/`.

## Workflow

### 1. Read Context

- Analysis report: `./analysis-reports/{issue_number}.md` — problem description and root cause
- Git diff: `git diff main` from inside the worktree — what actually changed
- Test files added or modified in the diff

### 2. Summarize the Problem

Pull from the analysis report:
- One sentence: what the bug/issue was
- Root cause if identified

### 3. Describe the Approach

From the diff, explain:
- What was changed and why
- Any alternative approaches considered (from issue-planner report if available)
- Why this approach was chosen

### 4. List Changed Files

From the diff, list files changed with a brief note on what each change does:
```
- `core/modules/settings_tray/js/settings_tray.js` — converted jQuery `.on()` to native addEventListener
- `core/modules/settings_tray/tests/src/FunctionalJavascript/SettingsTrayTest.php` — updated test assertions
```

### 5. How to Test

Write step-by-step manual testing instructions:
1. Apply the patch / check out the MR branch
2. Clear caches: `drush cr`
3. Navigate to... [specific URL or admin page]
4. Perform... [specific action]
5. Verify... [expected result]

### 6. Test Coverage

Note what automated tests cover the fix:
- Test class and method names
- Test type (Unit / Kernel / Functional / FunctionalJavaScript)
- How to run: `ddev phpunit core/modules/{module}/tests/src/.../SpecificTest.php`

## Output Format

```markdown
## Summary

[One sentence problem statement.]

## Root Cause

[Technical explanation of why it was broken.]

## Approach

[What was changed and why this approach was chosen.]

## Files Changed

- `path/to/file.php` — [what changed]
- `path/to/test.php` — [what changed]

## How to Test

1. Apply this patch / check out MR branch
2. `drush cr`
3. Navigate to [URL]
4. [Action]
5. Verify [expected outcome]

## Automated Tests

Added/updated tests in `path/to/TestClass.php`:
- `testMethodName()` — [what it tests]

Run with: `ddev phpunit path/to/tests/`
```

## Key Points

- Keep the problem statement non-technical enough for issue maintainers to understand
- How-to-test steps should be reproducible by someone unfamiliar with the codebase
- If the patch is on an MR, note the MR URL at the top
- Do not paste the full diff — link to it or reference files by name

## Obsidian Storage

After the contribution comment is generated, also archive it to the Neurons vault. This step is **optional and non-blocking** — skip silently if Obsidian is not running.

### Project Mapping

Extract the Drupal project name from the issue URL or analysis report frontmatter:
- `https://www.drupal.org/project/drupal/issues/3345989` → project = `drupal`
- `https://www.drupal.org/project/webform/issues/3401234` → project = `webform`
- Drupal core issues use the `drupal` folder; contrib modules use the module's machine name.

### Vault Path

```
~/Vaults/Neurons/Drupal.org/<project>/<issue-number>-contribution-comment.md
```

Examples:
```
Drupal.org/drupal/3345989-contribution-comment.md
Drupal.org/webform/3401234-contribution-comment.md
```

### Archive Command

```bash
# Health check — non-blocking
obsidian help || { echo "Vault storage skipped (Obsidian not running)"; exit 0; }

# Resolve project name from issue URL
DRUPAL_PROJECT="<extracted-from-issue-url>"
ISSUE_NUMBER="<issue-number>"

obsidian create \
  --vault=Neurons \
  --path="Drupal.org/${DRUPAL_PROJECT}/${ISSUE_NUMBER}-contribution-comment.md" \
  --content="<contribution-comment-content>"
```

### YAML Frontmatter

Prepend the following frontmatter to the stored document (substitute actual values):

```yaml
---
drupal_project: drupal
issue_number: 3345989
date: 2026-03-07
tags: [drupal, contribution]
---
```

This preserves a record of what was submitted and when, enabling future reference and pattern analysis across contributions.
