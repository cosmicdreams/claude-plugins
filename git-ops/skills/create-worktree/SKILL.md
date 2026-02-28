---
name: create-worktree
description: Create isolated git worktrees for Drupal issue development. Use when starting work on a new Drupal issue that requires code changes. Provides input validation, naming conventions, and git config propagation.
---

# Create Worktree for Drupal Issue

Create an isolated git worktree for developing a Drupal issue fix.

## Usage

Provide an issue number (required) and optional description.

## Workflow

## Context Awareness
**Important**: All relative paths (e.g. `./worktrees/...`) assume you are executing from the **Project Root** (e.g. `~/OpenSource/SAME_PAGE_PREVIEW`).
- The Project Root is the folder that *contains* the `worktrees/` and `kanban/` directories.
- If you are inside a worktree (e.g. `.../worktrees/1234`), you must `cd ../..` to return to the Project Root before running commands.

## Prerequisites Before Creating a Worktree

### Gitignore Verification (REQUIRED)

Before creating any project-local worktree, verify the `worktrees/` directory is git-ignored:

```bash
git check-ignore -q worktrees 2>/dev/null && echo "ignored" || echo "NOT ignored"
```

If `worktrees/` is **not** ignored:
- The `.gitignore` at the project root should include a `worktrees/` entry.
- Add it manually: open `.gitignore` and add the line `worktrees/`.
- Do NOT auto-commit this change — the user reviews and commits all git changes (git guard is active).
- Note the addition in your response so the user can review and commit it.

1. **Validate inputs**: Issue number is required
2. **Generate paths**:
   - Worktree path: `worktrees/{issue_number}/` or `worktrees/{issue_number}-{description}/`
   - Branch name: `issue-{issue_number}` or `issue-{issue_number}-{description}`
3. **Run from main worktree**: Script must execute from `worktrees/main/` (bare repo root cannot resolve `main` branch)
4. **Execute script**: `bash .claude/skills/create-worktree/scripts/git-create-worktree.sh`
5. **Confirm success**: Verify worktree created and report details

## Script

The script lives at `.claude/skills/create-worktree/scripts/git-create-worktree.sh`.

```bash
cd ./worktrees/main

# Discover installed version first: ls ~/.claude/plugins/cache/local/git-ops/
bash ~/.claude/plugins/cache/local/git-ops/<ver>/skills/create-worktree/scripts/git-create-worktree.sh \
  ../2901667 \
  issue-2901667 \
  main
```

**Parameters:**
- `worktree-path`: Relative or absolute path to create worktree (e.g., `../2901667`)
- `branch-name`: Git branch name (e.g., `issue-2901667`)
- `base-branch`: Optional base branch (defaults to `main`)

**The script handles:**
- Missing parameter validation
- Path existence checks (won't overwrite)
- Branch name conflict detection
- Base branch verification
- Git user config propagation into the new worktree
- phpcs.xml verified/synced from main to prevent phpcbf regressions on JS/CSS files
- Success confirmation with path, branch, base, and commit SHA

## Naming Conventions

- **Worktree path**: `worktrees/{issue_number}` or `worktrees/{issue_number}-{short-desc}`
- **Branch name**: `issue-{issue_number}` or `issue-{issue_number}-{short-desc}`
- **Base branch**: `main` (use version branches like `11.x` only for backports)

## Critical: Run from Main Worktree

The bare repo root cannot resolve the `main` branch directly. Always `cd` to `worktrees/main/` before running the script.

## Example

For issue 2897308:
```bash
cd ./worktrees/main

# Discover installed version first: ls ~/.claude/plugins/cache/local/git-ops/
bash ~/.claude/plugins/cache/local/git-ops/<ver>/skills/create-worktree/scripts/git-create-worktree.sh \
  ../2897308 \
  issue-2897308 \
  main
```

## After Creation: Establish a Baseline

**Before writing any code, confirm tests are green in the worktree.**

Run the relevant test suite to establish a clean baseline. A passing baseline proves the problem is in your changes — not pre-existing — and gives you a safe reference point to return to.

- **Drupal projects**: `ddev phpunit <relevant-test-path>`
  - Example: `ddev phpunit core/modules/settings_tray/tests/`
  - If DDEV is not yet configured for this worktree, defer the baseline run to the first step of your implementation plan and note it explicitly.
- **Non-Drupal projects**: use the project's own test command (e.g., `npm test`, `pytest`, `go test ./...`).

If the baseline is not green before you start, stop and investigate. Do not begin implementation on a broken baseline — you will not be able to tell which failures are yours.

## After Creation: Set Up DDEV

See `/process-lifecycle` skill (Phase 1: INIT) for the full DDEV setup, startup, and ready check procedures. That skill is the single source of truth for DDEV instance management.

See `/ddev-drupal-dev` skill for the full DDEV command reference.

When done with the worktree, follow `/process-lifecycle` Phase 4: SHUTDOWN to release resources.

## Report to User

- Worktree path
- Branch name
- Base commit
- DDEV config status
- Ready for development
