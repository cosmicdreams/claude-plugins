---
name: release-cut
description: >
  Cut a release assembly branch from main and merge the feature branches
  approved in a JIRA release ticket. Release branches are disposable — this
  skill rebuilds them from scratch each time. Use when starting regression
  testing for a release, when a release branch needs to be re-cut from
  scratch after scope changes, or when the user says "cut release X", "start
  release branch", "build the release branch for ticket Y". Do NOT use for
  feature branches or sprint branches (use drupal-lab:sprint-start).
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# drupal-lab:release-cut — Assemble a release branch from a JIRA release ticket

Reads a JIRA release ticket, resolves its linked feature tickets to local
`features/*` branches, and merges them into a fresh `release/<slug>` branch
from `main`. Idempotent: rerun rebuilds the branch from current main with
the current scope.

## Prerequisites

- The current directory is a Drupal project (see step 1 for detection).
- `jira` CLI configured.
- Working tree clean (single-checkout layout). In worktree-discipline repos,
  cleanliness is automatic since the new release worktree starts fresh.
- Each linked feature ticket has a corresponding `features/<KEY>` or
  `features/<descriptive-slug>` branch in the repo. Mapping rules in
  `references/feature-branch-mapping.md`.

Registration in `~/.claude/drupal-lab.json` is **not required** — see
`drupal-lab/references/project-context.md` for why.

## Inputs

- **Release ticket key** (required) — e.g. `PROJ-2200`.

## Workflow

### 1. Detect Drupal repo and worktree discipline

Same detection as `drupal-lab:sprint-start`:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[[ -z "$REPO_ROOT" ]] && { echo "Not a git repository."; exit 1; }

grep -qE '"drupal/core(-recommended)?"' "$REPO_ROOT/composer.json" 2>/dev/null \
  || { echo "Not a Drupal project (composer.json missing drupal/core)."; exit 1; }
[[ -d "$REPO_ROOT/docroot" || -d "$REPO_ROOT/web" ]] \
  || { echo "Not a Drupal project (no docroot/ or web/)."; exit 1; }

WORKTREE_PARENT=""
if [[ "$(basename "$(dirname "$REPO_ROOT")")" == "worktrees" ]]; then
  WORKTREE_PARENT="$(dirname "$REPO_ROOT")"
fi
```

### 2. Fetch the release ticket

```bash
jira issue view <RELEASE_KEY> --plain --comments 0
```

Confirm the ticket exists and capture its summary. Extract its `Fix Version/s`
field if present — that's the release name we'll slugify (preferred over the
ticket summary, since the same fix version may span multiple release-prep
tickets in JIRA).

If no `Fix Version/s` is set, slugify the ticket summary instead and warn the user.

The branch is `release/<slug>`. For worktree-discipline repos, the worktree
directory uses a filesystem-safe variant: `<WORKTREE_PARENT>/release-<slug>`.

### 3. Discover linked feature tickets

```bash
jira issue list --jql "issue in linkedIssues(<RELEASE_KEY>)" \
  --plain --no-headers --no-truncate \
  --columns TYPE,KEY,SUMMARY,STATUS
```

Filter to deliverable types (`Story`, `Task`, `Bug`); drop `Epic`, `Sub-task`,
anything in status `Won't Do`.

Show the candidate list and ask:
"These N tickets are linked to <RELEASE_KEY>. Include all in the release?
(or supply a comma-separated list of keys to include)"

### 4. Resolve each ticket to a feature branch

For each included ticket key, look for branches matching (in order):

1. `features/<KEY>` exact match
2. `features/<key-lowercase>` exact match
3. `features/<KEY>-*` prefix match (single result)
4. `features/*` containing `<KEY>` as a token

If multiple candidates: ask the user.
If zero candidates: list the ticket with `(no branch found)`.

### 5. Confirm the plan

**Worktree layout:**

```
Release ticket: <RELEASE_KEY> — <summary>
Fix version:    <fix version>
Branch:         release/<slug>
Worktree:       <WORKTREE_PARENT>/release-<slug>
Branching from origin/main @ <short SHA>

Will merge (<n> features):
  features/<KEY-1>  ← <ticket summary>
  ...

Cannot merge (<m>):
  <KEY-X> — no matching feature branch

This will:
  - Fetch origin
  - Delete any existing worktree at <WORKTREE_PARENT>/release-<slug>
  - Delete release/<slug> locally and on origin (if it exists)
  - git worktree add <WORKTREE_PARENT>/release-<slug> -b release/<slug> origin/main
  - Merge each feature branch inside the new worktree (--no-ff)
  - Push to origin from inside the new worktree
  - Write <WORKTREE_PARENT>/release-<slug>/.drupal-lab/releases/<slug>.json
```

**Single-checkout layout:** same as before — branches from current `main`,
merges, pushes, returns to main.

Ask: proceed? If unresolved tickets exist, ask whether to proceed without them.

### 6. Cut the branch and merge

**Worktree layout:**

```bash
git -C "$REPO_ROOT" fetch origin --prune

RELEASE_BRANCH="release/<slug>"
RELEASE_WT="$WORKTREE_PARENT/release-<slug>"

# Tear down any stale worktree + branch.
if git -C "$REPO_ROOT" worktree list --porcelain | grep -q "^worktree $RELEASE_WT\$"; then
  git -C "$REPO_ROOT" worktree remove --force "$RELEASE_WT"
fi
git -C "$REPO_ROOT" branch -D "$RELEASE_BRANCH" 2>/dev/null || true

# Cut the worktree from origin/main.
git -C "$REPO_ROOT" worktree add "$RELEASE_WT" -b "$RELEASE_BRANCH" origin/main

# Merge inside the new worktree.
for feature in features/<KEY-1> features/<KEY-2> ... ; do
  if ! git -C "$RELEASE_WT" merge --no-ff --no-edit "$feature"; then
    echo "Merge conflict on $feature. Resolve inside the worktree:"
    echo "  cd $RELEASE_WT"
    echo "  # ... resolve files ..."
    echo "  DRUPAL_LAB_BYPASS=1 git commit"
    echo "Then rerun drupal-lab:release-cut --resume."
    exit 1
  fi
done

DRUPAL_LAB_BYPASS=1 git -C "$RELEASE_WT" push --force-with-lease -u origin "$RELEASE_BRANCH"
```

**Single-checkout layout:**

```bash
git checkout main
git pull --rebase
git fetch origin --prune

git branch -D "release/<slug>" 2>/dev/null || true
git checkout -B "release/<slug>"

for feature in features/<KEY-1> features/<KEY-2> ... ; do
  git merge --no-ff --no-edit "$feature" || {
    echo "Merge conflict on $feature. Resolve manually then commit with DRUPAL_LAB_BYPASS=1."
    exit 1
  }
done

DRUPAL_LAB_BYPASS=1 git push --force-with-lease -u origin "release/<slug>"
git checkout main
```

The bypass is used for the push to `release/<slug>` and any
conflict-resolution commit. Both are recorded in `.drupal-lab/bypass.log`.

### 7. Write the manifest

The manifest lives **inside the release worktree** (worktree layout) or in
the project root (single-checkout layout), in
`.drupal-lab/releases/<slug>.json`. Add `.drupal-lab/` to `.gitignore` if it
isn't already.

```json
{
  "release_key": "<RELEASE_KEY>",
  "release_summary": "<summary>",
  "fix_version": "<fix version or null>",
  "branch": "release/<slug>",
  "worktree_path": "<absolute path or null for single-checkout>",
  "project_alias": "<from drupal-lab.json if matched, else null>",
  "cut_from_sha": "<full SHA of origin/main>",
  "cut_at": "<ISO 8601 timestamp UTC>",
  "included": [
    { "key": "PROJ-123", "branch": "features/PROJ-123", "merge_sha": "<sha>" },
    ...
  ],
  "omitted": [
    { "key": "PROJ-999", "reason": "no matching feature branch" },
    ...
  ]
}
```

### 8. Report

Tell the user:
- Branch `release/<slug>` cut at `<short SHA>` from origin/main
- For worktree layout: the new worktree path
- N merged, M omitted (with reasons)
- Manifest path
- Suggested next steps: deploy the branch to the regression environment,
  then run `drupal-lab:branch-audit release/<slug>` after PMs claim work is
  ready to release.

## Failure modes

- Not a Drupal project (no `drupal/core` in composer.json or no `docroot/`/`web/`)
  → stop with a clear message.
- Working tree dirty (single-checkout layout) → stop, no auto-stash. Worktree
  layout is unaffected.
- `main` behind origin → stop, fail loudly. (Worktree layout cuts from
  `origin/main` directly, avoiding this.)
- Merge conflict → stop with explicit resume instructions, including the path
  to `cd` into for worktree layout.
- Force-push refused → someone committed directly to `release/<slug>` (shouldn't
  happen with the branch guard). Surface the diff.
- JIRA returns no linked issues → ask the user to confirm the ticket actually
  lists release scope (PMs sometimes use a separate field).
- Worktree-add fails with "already exists" → the stale-worktree removal in
  step 6 didn't catch it; surface git's error and stop.
