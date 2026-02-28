#!/bin/bash
# git-create-worktree - Create a new Git worktree with specified parameters
# Usage: git-create-worktree <worktree-path> <branch-name> [base-branch]

set -e  # Exit on any error

# Parameters
WORKTREE_PATH="$1"
BRANCH_NAME="$2"
BASE_BRANCH="${3:-HEAD}"

# Validation
if [ -z "$WORKTREE_PATH" ] || [ -z "$BRANCH_NAME" ]; then
    echo "Error: Missing required parameters"
    echo "Usage: git-create-worktree <worktree-path> <branch-name> [base-branch]"
    exit 1
fi

# Check if path already exists
if [ -e "$WORKTREE_PATH" ]; then
    echo "Error: Path already exists: $WORKTREE_PATH"
    exit 3
fi

# Check if branch already exists
if git rev-parse --verify "$BRANCH_NAME" >/dev/null 2>&1; then
    echo "Error: Branch already exists: $BRANCH_NAME"
    exit 2
fi

# Check if base branch exists
if ! git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
    echo "Error: Base branch not found: $BASE_BRANCH"
    exit 4
fi

# Create the worktree
echo "Creating worktree at $WORKTREE_PATH with branch $BRANCH_NAME from $BASE_BRANCH..."
git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" "$BASE_BRANCH"

# Validate creation
if [ ! -d "$WORKTREE_PATH" ]; then
    echo "Error: Worktree creation failed"
    exit 1
fi

# Set up basic Git configuration in the worktree
cd "$WORKTREE_PATH"
git config user.name "$(git config --global user.name)" 2>/dev/null || true
git config user.email "$(git config --global user.email)" 2>/dev/null || true

# Verify phpcs.xml has JS/CSS exclude-patterns (prevent phpcbf-on-JS regressions)
WORKTREE_ABS="$(pwd)"
MAIN_PHPCS="$(dirname "$WORKTREE_ABS")/main/phpcs.xml"
WORKTREE_PHPCS="$WORKTREE_ABS/phpcs.xml"
if [ -f "$MAIN_PHPCS" ] && [ -f "$WORKTREE_PHPCS" ]; then
  if ! grep -q 'exclude-pattern.*\.js' "$WORKTREE_PHPCS" 2>/dev/null; then
    cp "$MAIN_PHPCS" "$WORKTREE_PHPCS"
    echo "  ✓ phpcs.xml synced from main (JS/CSS exclude-patterns applied)"
  fi
fi

echo "✅ Worktree created successfully:"
echo "   Path: $WORKTREE_PATH"
echo "   Branch: $BRANCH_NAME"
echo "   Base: $BASE_BRANCH"
echo "   Commit: $(git rev-parse --short HEAD)"

exit 0