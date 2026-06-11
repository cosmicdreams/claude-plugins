---
name: create-worktree
description: Creates an isolated git worktree for developing a fix or feature in a separate working directory. Use when the user says "create a worktree", "set up a worktree", "new worktree for issue X", "start work on issue X", or needs an isolated branch workspace. Handles naming conventions, git config propagation, and baseline verification. NOT for creating git branches without worktrees, or for cloning repositories.
---

# Create Worktree

Create an isolated git worktree for a fix or feature.

## Context

All relative paths assume you are executing from the **project root** (the folder that contains `worktrees/` and `.claude/`). If you are inside a worktree, go up two levels before running commands.

## Prerequisites

Verify `worktrees/` is git-ignored before creating anything:

```bash
git check-ignore -q worktrees 2>/dev/null && echo "ignored" || echo "NOT ignored"
```

If not ignored, add `worktrees/` to `.gitignore`. Do not auto-commit this change.

## Workflow

1. **Validate inputs**: issue number is required
2. **Generate paths**:
   - Worktree path: `worktrees/{issue_number}/` or `worktrees/{issue_number}-{description}/`
   - Branch name: `issue-{issue_number}` or `issue-{issue_number}-{description}`
3. **Run from main worktree**: `cd worktrees/main` first — the bare repo root cannot resolve `main`
4. **Execute script**:

```bash
# Discover installed version: ls ~/.claude/plugins/cache/local/admin/
bash ~/.claude/plugins/cache/local/admin/<ver>/skills/create-worktree/scripts/git-create-worktree.sh \
  ../2901667 \
  issue-2901667 \
  main
```

**Parameters:** `<worktree-path>` `<branch-name>` `<base-branch>` (defaults to `main`)

The script handles: missing parameter validation, path existence checks, branch name conflict detection, base branch verification, git user config propagation, and phpcs.xml sync from main.

## After Creation

**Establish a baseline before writing any code.** Run the relevant test suite to confirm it is green.

- **Drupal projects**: `ddev phpunit <relevant-test-path>`
- **Non-Drupal**: use the project's own test command

If the baseline is not green, stop and investigate.

Then set up DDEV per `/drupal-lab:process-lifecycle` Phase 1: INIT.

## Naming Conventions

- **Worktree path**: `worktrees/{issue_number}` or `worktrees/{issue_number}-{short-desc}`
- **Branch name**: `issue-{issue_number}` or `issue-{issue_number}-{short-desc}`
- **Base branch**: `main` (use version branches like `11.x` only for backports)

## Report to User

- Worktree path
- Branch name
- Base commit
- Baseline verification status
