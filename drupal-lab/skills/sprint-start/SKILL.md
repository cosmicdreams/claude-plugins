---
name: sprint-start
description: >
  Create a sprint assembly branch named after the active JIRA sprint and seed
  its manifest of expected feature tickets. Sprint branches are disposable —
  this skill rebuilds them from main, never edits in place. Use when starting
  a new sprint, when a sprint branch needs to be re-cut from scratch, or when
  the user says "start the sprint branch", "cut a sprint branch", "kick off
  sprint X". Do NOT use for creating feature branches (those branch off main
  manually) or for release branches (use drupal-lab:release-cut).
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# drupal-lab:sprint-start — Cut a sprint assembly branch

Creates `sprint/<sprint-slug>` from `main` and records the expected ticket set
from JIRA. The branch is the assembly point where approved feature branches
are merged for stakeholder review on a shared environment. It is disposable
by design — running this skill again rebuilds it.

## Prerequisites

- The current directory is a Drupal project (see step 1 for detection).
- `jira` CLI is configured (`/opt/homebrew/bin/jira`).
- Working tree is clean on `main` (no uncommitted changes).

Registration in `~/.claude/drupal-lab.json` is **not required** — it is consulted
only as an optional enrichment for skills that need project-specific data
(DDEV prefix, drupal.org credentials). `sprint-start` doesn't need any of that.

## Inputs

- **Sprint name (optional)** — if omitted, query JIRA for the active sprint and confirm with the user.

## Workflow

### 1. Detect Drupal repo

The cwd qualifies as a Drupal project if **both** of these are true:

```bash
# Find the repo root.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[[ -z "$REPO_ROOT" ]] && { echo "Not a git repository."; exit 1; }

# (a) composer.json declares drupal/core or drupal/core-recommended.
grep -qE '"drupal/core(-recommended)?"' "$REPO_ROOT/composer.json" 2>/dev/null \
  || { echo "Not a Drupal project (composer.json missing drupal/core)."; exit 1; }

# (b) docroot/ or web/ exists (Drupal site layout).
[[ -d "$REPO_ROOT/docroot" || -d "$REPO_ROOT/web" ]] \
  || { echo "Not a Drupal project (no docroot/ or web/)."; exit 1; }
```

If both checks pass, proceed. If either fails, stop with a clear message.

Optional: if `~/.claude/drupal-lab.json` exists and a project matches the cwd,
note the alias in the manifest (step 6) — but do not gate execution on it.

### 2. Detect worktree discipline

Inspect the repo layout. If the cwd lives under a `worktrees/` directory and a
sibling `worktrees/main` exists, this repo uses worktree discipline — the
sprint branch must be created as a sibling worktree, never as a checkout in
the current working directory.

```bash
WORKTREE_PARENT=""
if [[ "$(basename "$(dirname "$REPO_ROOT")")" == "worktrees" ]]; then
  WORKTREE_PARENT="$(dirname "$REPO_ROOT")"
fi
```

If `WORKTREE_PARENT` is set, use the worktree workflow in step 5. Otherwise
fall back to the single-checkout workflow.

### 3. Pick the sprint

If the user did not supply a name:

```bash
jira sprint list --state active --plain --no-headers --columns ID,NAME
```

If there are multiple active sprints, ask the user which one. If there are
zero, stop and tell the user to start a sprint in JIRA first.

Slugify the sprint name (lowercase, replace non-alphanumerics with `-`,
collapse dashes, strip leading/trailing dashes). Example:
`Sprint 47 - Checkout v2` → `sprint-47-checkout-v2`. Branch is `sprint/<slug>`.

For worktree-discipline repos, the worktree directory name uses the slug
without the `sprint/` prefix (since filesystem siblings are flat):
`<WORKTREE_PARENT>/sprint-<slug>`.

### 4. Fetch the expected ticket set

```bash
jira issue list --jql "sprint = <SPRINT_ID>" --plain --no-headers --no-truncate \
  --columns TYPE,KEY,SUMMARY,STATUS
```

Capture the rows. This is the manifest of what *should* end up merged into the
sprint branch. We don't enforce it; we just record it for `drupal-lab:branch-audit`.

### 5. Confirm with the user

Show the plan. Wording differs by layout.

**Worktree layout:**

```
Sprint:        <Sprint Name> (#<SPRINT_ID>)
Branch:        sprint/<slug>
Worktree:      <WORKTREE_PARENT>/sprint-<slug>
Branching from origin/main @ <short SHA>
Tickets in sprint (<n>):
  <TYPE> <KEY> — <SUMMARY> [<STATUS>]
  ...

This will:
  - Fetch origin
  - Delete any existing worktree at <WORKTREE_PARENT>/sprint-<slug>
  - Delete sprint/<slug> locally and on origin (if it exists)
  - git worktree add <WORKTREE_PARENT>/sprint-<slug> -b sprint/<slug> origin/main
  - Push sprint/<slug> to origin from inside the new worktree
  - Write <WORKTREE_PARENT>/sprint-<slug>/.drupal-lab/sprints/<slug>.json
```

**Single-checkout layout:**

```
Sprint:        <Sprint Name> (#<SPRINT_ID>)
Branch:        sprint/<slug>
Branching from main @ <short SHA>
Tickets in sprint (<n>): ...

This will:
  - Pull main, fetch origin
  - Delete sprint/<slug> locally and on origin (if it exists)
  - Re-create sprint/<slug> from current main
  - Push to origin
  - Return to main
  - Write .drupal-lab/sprints/<slug>.json
```

Ask: proceed? If no, stop.

### 6. Cut the branch

**Worktree layout:**

```bash
# From any worktree of the repo; operations target the canonical worktree paths.
git -C "$REPO_ROOT" fetch origin --prune

SPRINT_BRANCH="sprint/<slug>"
SPRINT_WT="$WORKTREE_PARENT/sprint-<slug>"

# Remove any stale worktree + branch.
if git -C "$REPO_ROOT" worktree list --porcelain | grep -q "^worktree $SPRINT_WT\$"; then
  git -C "$REPO_ROOT" worktree remove --force "$SPRINT_WT"
fi
git -C "$REPO_ROOT" branch -D "$SPRINT_BRANCH" 2>/dev/null || true

# Create the worktree on a fresh branch from origin/main.
git -C "$REPO_ROOT" worktree add "$SPRINT_WT" -b "$SPRINT_BRANCH" origin/main

# Push from inside the new worktree.
# Branch guard requires DRUPAL_LAB_BYPASS=1 for pushes on sprint/* branches.
DRUPAL_LAB_BYPASS=1 git -C "$SPRINT_WT" push --force-with-lease -u origin "$SPRINT_BRANCH"
```

**Single-checkout layout:**

```bash
git checkout main
git pull --rebase
git fetch origin --prune

git branch -D "sprint/<slug>" 2>/dev/null || true
git checkout -B "sprint/<slug>"
DRUPAL_LAB_BYPASS=1 git push --force-with-lease -u origin "sprint/<slug>"
git checkout main
```

### 7. Write the manifest

The manifest lives **inside the new sprint worktree** (worktree layout) or in
the project root (single-checkout layout), in `.drupal-lab/sprints/<slug>.json`.
Add `.drupal-lab/` to `.gitignore` if it isn't already — the manifest is local
metadata, not source.

```json
{
  "sprint_id": "<SPRINT_ID>",
  "sprint_name": "<Sprint Name>",
  "branch": "sprint/<slug>",
  "worktree_path": "<absolute path or null for single-checkout>",
  "project_alias": "<from drupal-lab.json if matched, else null>",
  "cut_from_sha": "<full SHA of origin/main at branch time>",
  "cut_at": "<ISO 8601 timestamp UTC>",
  "expected_tickets": [
    { "key": "PROJ-123", "type": "Story", "summary": "...", "status": "In Progress" },
    ...
  ]
}
```

### 8. Report

Tell the user:
- Branch `sprint/<slug>` cut at `<short SHA>` from origin/main
- For worktree layout: the new worktree path, so the user can `cd` there
- The manifest path
- A reminder: `drupal-lab:branch-audit sprint/<slug>` will diff JIRA against
  what actually lands in this branch

## Failure modes

- Not a Drupal project (no `drupal/core` in composer.json or no `docroot/`/`web/`)
  → stop with a clear message naming which check failed.
- Working tree dirty (single-checkout layout) → tell user to stash/commit first;
  do not auto-stash. Worktree layout is unaffected — the new worktree starts
  clean regardless.
- `main` behind origin → fail loudly. The whole point of branching from main
  is to branch from current ground truth. (Worktree layout cuts from
  `origin/main` directly and avoids this entirely.)
- JIRA query returns nothing → ask user to confirm sprint started or supply
  the name explicitly.
- Force-push refused → another developer may have made commits directly to
  `sprint/<slug>` (which they shouldn't). Stop and surface the diff to the user.
- Worktree-add fails with "already exists" → the stale-worktree removal in
  step 6 didn't catch it; surface git's error and stop.
