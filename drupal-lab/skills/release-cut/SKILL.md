---
name: release-cut
description: >
  Cut a release assembly branch from main and merge the feature branches a JIRA release
  ticket approves. Release branches are disposable and rebuilt from scratch each run. Not
  for feature or sprint branches (drupal-lab:sprint-start).
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# drupal-lab:release-cut — Assemble a release branch from a JIRA release ticket

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Cut a release assembly branch from main and merge the feature branches approved in a JIRA release ticket. Release branches are disposable — this skill rebuilds them from scratch each time. Use when starting regression testing for a release, when a release branch needs to be re-cut from scratch after scope changes, or when the user says "cut release X", "start release branch", "build the release branch for ticket Y". Do NOT use for feature branches or sprint branches (use drupal-lab:sprint-start).

Reads a JIRA release ticket, resolves its linked feature tickets to local
`features/*` branches, and merges them into a fresh `release/<slug>` branch
from `main`. Idempotent: rerun rebuilds the branch from current main with
the current scope.

## Prerequisites

- `~/.claude/drupal-lab.json` exists and the current project is not opted out
  of team flow (`team_flow.enabled: false` disables it; default is on).
- `jira` CLI configured.
- Working tree clean on `main`.
- Each linked feature ticket has a corresponding `features/<KEY>` or
  `features/<descriptive-slug>` branch in the repo. The mapping rules are
  in `references/feature-branch-mapping.md`.

## Inputs

- **Release ticket key** (required) — e.g. `PROJ-2200`.

## Workflow

### 1. Resolve project context

Read `~/.claude/drupal-lab.json`. Match cwd against `cwd_patterns`. Fail if
no project matches or if the matched project has `team_flow.enabled: false`.

### 2. Fetch the release ticket

```bash
jira issue view <RELEASE_KEY> --plain --comments 0
```

Confirm the ticket exists and capture its summary. Extract its `Fix Version/s`
field if present — that's the release name we'll slugify (preferred over the
ticket summary, since the same fix version may span multiple release-prep
tickets in JIRA).

If no `Fix Version/s` is set, slugify the ticket summary instead and warn the user.

The branch is `release/<slug>`.

### 3. Discover linked feature tickets

```bash
jira issue list --jql "issue in linkedIssues(<RELEASE_KEY>)" \
  --plain --no-headers --no-truncate \
  --columns TYPE,KEY,SUMMARY,STATUS
```

This returns every issue linked to the release ticket regardless of link
direction. Filter to types the team treats as deliverable work — typically
`Story`, `Task`, `Bug`. Drop `Epic`, `Sub-task`, anything in status `Won't Do`.

The user may want to filter further. Show the candidate list and ask:
"These N tickets are linked to <RELEASE_KEY>. Include all in the release?
(or supply a comma-separated list of keys to include)"

### 4. Resolve each ticket to a feature branch

For each included ticket key, look for branches matching (in order):

1. `features/<KEY>` exact match
2. `features/<key-lowercase>` exact match
3. `features/<KEY>-*` or `features/<KEY>_*` prefix match (single result)
4. `features/*` containing `<KEY>` as a token

If multiple candidates: ask the user.
If zero candidates: list the ticket with `(no branch found)` — the user must
either create the branch first or drop the ticket from the release.

### 5. Confirm the plan

```
Release ticket: <RELEASE_KEY> — <summary>
Fix version:    <fix version>
Branch:         release/<slug>
Branching from main @ <short SHA>

Will merge (<n> features):
  features/<KEY-1>  ← <ticket summary>
  features/<KEY-2>  ← <ticket summary>
  ...

Cannot merge (<m>):
  <KEY-X> — no matching feature branch
  ...

This will:
  - Delete release/<slug> locally and on origin (if it exists)
  - Re-create release/<slug> from current main
  - Merge each feature branch (--no-ff)
  - Push to origin
  - Write .drupal-lab/releases/<slug>.json
```

Ask: proceed? If unresolved tickets exist, ask whether to proceed without
them (and record the omission in the manifest).

### 6. Cut the branch and merge

```bash
git checkout main
git pull --rebase
git fetch origin --prune

git branch -D "release/<slug>" 2>/dev/null || true
git checkout -B "release/<slug>"

# Merge each feature branch. Use --no-ff so the merge commit records the
# integration explicitly (the audit skill relies on these merge commits).
for feature in features/<KEY-1> features/<KEY-2> ... ; do
  git merge --no-ff --no-edit "$feature" || {
    echo "Merge conflict on $feature. Resolve manually:"
    echo "  cd $(pwd)"
    echo "  DRUPAL_LAB_BYPASS=1 git commit"
    echo "Then rerun drupal-lab:release-cut <RELEASE_KEY> to rebuild the branch from scratch."
    echo "Note: rerun deletes and re-cuts the branch — commit your resolved changes to the feature branch first."
    exit 1
  }
done

DRUPAL_LAB_BYPASS=1 git push --force-with-lease origin "release/<slug>"
git checkout main
```

The bypass is only used for the push to `release/<slug>` and the
conflict-resolution commit (if any). Both are recorded in `.drupal-lab/bypass.log`.

### 7. Write the manifest

```bash
mkdir -p .drupal-lab/releases
```

Write `.drupal-lab/releases/<slug>.json`:

```json
{
  "release_key": "<RELEASE_KEY>",
  "release_summary": "<summary>",
  "fix_version": "<fix version or null>",
  "branch": "release/<slug>",
  "cut_from_sha": "<full SHA of main>",
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
- Branch cut at `<short SHA>` from main
- N merged, M omitted (with reasons)
- Manifest path
- Suggested next steps: deploy the branch to the regression environment,
  then run `drupal-lab:branch-audit release/<slug>` after PMs claim work is
  ready to release.

## Failure modes

- Working tree dirty → stop, no auto-stash.
- `main` behind origin → stop, fail loudly.
- Merge conflict → stop with explicit resume instructions.
- Force-push refused → someone committed directly to `release/<slug>` (shouldn't
  happen with the branch guard). Surface the diff.
- JIRA returns no linked issues → ask the user to confirm the ticket actually
  lists release scope (PMs sometimes use a separate field).
