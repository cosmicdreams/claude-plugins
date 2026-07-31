---
name: sprint-start
description: >
  Create a sprint assembly branch named for the active JIRA sprint and seed its manifest
  of expected tickets. Rebuilt from main each run, never edited in place. Not for feature
  branches or release branches (drupal-lab:release-cut).
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# drupal-lab:sprint-start — Cut a sprint assembly branch

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Create a sprint assembly branch named after the active JIRA sprint and seed its manifest of expected feature tickets. Sprint branches are disposable — this skill rebuilds them from main, never edits in place. Use when starting a new sprint, when a sprint branch needs to be re-cut from scratch, or when the user says "start the sprint branch", "cut a sprint branch", "kick off sprint X". Do NOT use for creating feature branches (those branch off main manually) or for release branches (use drupal-lab:release-cut).

Creates `sprint/<sprint-slug>` from `main` and records the expected ticket set
from JIRA. The branch is the assembly point where approved feature branches
are merged for stakeholder review on a shared environment. It is disposable
by design — running this skill again rebuilds it.

## Prerequisites

- `~/.claude/drupal-lab.json` exists and the current project is *not* opted out
  of team flow (`team_flow.enabled: false` disables it; default is on).
- `jira` CLI is configured for this project's board (`/opt/homebrew/bin/jira`).
- Working tree is clean on `main` (no uncommitted changes).

## Inputs

- **Sprint name (optional)** — if omitted, query JIRA for the active sprint and confirm with the user.

## Workflow

### 1. Resolve project context

Read `~/.claude/drupal-lab.json`, match cwd against `cwd_patterns`. Fail with
a clear message if no project matches the cwd, or if the matched project has
opted out via `team_flow.enabled: false`. See
`drupal-lab/references/project-context.md`.

### 2. Pick the sprint

If the user did not supply a name:

```bash
jira sprint list --state active --plain --no-headers --columns ID,NAME
```

If there are multiple active sprints, ask the user which one. If there are
zero, stop and tell the user to start a sprint in JIRA first.

Slugify the sprint name (lowercase, replace non-alphanumerics with `-`,
collapse dashes). Example: `Sprint 47 - Checkout v2` → `sprint-47-checkout-v2`.
The branch is `sprint/<slug>`.

### 3. Fetch the expected ticket set

```bash
jira issue list --jql "sprint = <SPRINT_ID>" --plain --no-headers --no-truncate \
  --columns TYPE,KEY,SUMMARY,STATUS
```

Capture the rows. This is the manifest of what *should* end up merged into the
sprint branch. We don't enforce it; we just record it for `drupal-lab:branch-audit`.

### 4. Confirm with the user

Show the plan:

```
Sprint:        <Sprint Name> (#<SPRINT_ID>)
Branch:        sprint/<slug>
Branching from main @ <short SHA>
Tickets in sprint (<n>):
  <TYPE> <KEY> — <SUMMARY> [<STATUS>]
  ...

This will:
  - Delete sprint/<slug> locally and on origin (if it exists)
  - Re-create sprint/<slug> from current main
  - Push to origin
  - Write .drupal-lab/sprints/<slug>.json
```

Ask: proceed? If no, stop.

### 5. Cut the branch

The push to `sprint/<slug>` requires `DRUPAL_LAB_BYPASS=1` because the branch
guard soft-blocks writes to `sprint/*` and HEAD will be `sprint/<slug>` when
the push fires.

```bash
git checkout main
git pull --rebase
git fetch origin --prune

git branch -D "sprint/<slug>" 2>/dev/null || true

git checkout -B "sprint/<slug>"
DRUPAL_LAB_BYPASS=1 git push --force-with-lease origin "sprint/<slug>"
git checkout main
```

### 6. Write the manifest

```bash
mkdir -p .drupal-lab/sprints
```

Write `.drupal-lab/sprints/<slug>.json`:

```json
{
  "sprint_id": "<SPRINT_ID>",
  "sprint_name": "<Sprint Name>",
  "branch": "sprint/<slug>",
  "cut_from_sha": "<full SHA of main at branch time>",
  "cut_at": "<ISO 8601 timestamp UTC>",
  "expected_tickets": [
    { "key": "PROJ-123", "type": "Story",  "summary": "...", "status": "In Progress" },
    ...
  ]
}
```

Commit the manifest **on main** is forbidden (branch guard will refuse).
Commit it on a `features/<slug>-manifest` branch and merge via PR, OR keep
it untracked in `.drupal-lab/` (recommended — `.drupal-lab/` should be in
`.gitignore` for the project).

### 7. Report

Tell the user:
- The branch was cut at `<short SHA>` from main
- The manifest path
- A reminder: `drupal-lab:branch-audit sprint/<slug>` will diff JIRA against
  what actually lands in this branch

## Failure modes

- Working tree dirty → tell user to stash/commit first; do not auto-stash.
- `main` is behind origin → fail loudly. The whole point of branching from
  main is to branch from current ground truth.
- JIRA query returns nothing → ask user to confirm sprint started or supply
  the name explicitly.
- Force-push refused → another developer may have made commits directly to
  `sprint/<slug>` (which they shouldn't). Stop and surface the diff to the user.
