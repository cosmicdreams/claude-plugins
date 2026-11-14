---
name: finish-issue
description: >
  Finish a Drupal contribution worktree: prepare or submit its merge request or patch under current authority, preserve verified upstream and local results, or park/discard work as requested. Not for preparing a new issue workspace (drupal-lab:work-on-issue).
---

# Finish a Drupal issue

Read `drupal-lab/references/project-context.md`, `drupalorg-cli.md` and `issue-handoffs.md`. Resolve the actual dedicated worktree, canonical issue, task base and current branch. Read the canonical analysis/review artifacts, refreshing fork and merge-request context before submission. Do not guess origin, target project or branch from a core URL template.

Use the user's existing disposition: submit a merge request, provide a patch, park, or discard. If it is unspecified, present the concrete state and the relevant choices. Do not ask again for authority already granted. Commit/push/publication authority follows the active task and host; a tool credential does not provide it.

## Merge request

Run local validation and the required reviewer; draft the contribution through `issue-summary`. Resolve the actual fork remote, source branch and target project/base from upstream context and Git. Inspect draft/conflict/mergeability state, unresolved discussions, revision relationship and all blocking pipeline failures through `merge-request-context`. Unknown evidence cannot certify readiness.

Commit and push only when authorized. Create/update the request through the available authorized GitLab/host workflow, or supply the exact resolved destination and commands if submission capability/authority is absent. Do not claim submission based on a generated URL. Never push to another contributor's proposal without the required knowledge, disclosure and authority. Remote fork/access creation and requested state updates use the shared adapter's authenticated dispatcher and existing posting policy. Re-read asynchronous results before retrying.

## Patch or interdiff

Select the actual task base and intended changes, verify their scope, and generate the patch explicitly with Git from the dedicated worktree. Include binary changes when needed. Record whether uncommitted changes are included, the base revision, artifact path and source issue. Generate an interdiff only against the specific previous patch/proposal being compared. Do not let a shortcut infer the wrong base or make commits.

Prepare the same validated contribution draft. Upload/post only under current authority and maintainer policy; otherwise hand over the concrete artifact and facts.

## Park or discard

For parked work, record the branch/base, source context, changes completed, last validation and remaining issue-specific work in Beads. Preserve the worktree. For discard, identify the actual worktree and branch and apply the confirmation below; never remove unrelated changes or environments.

### D1 — Confirm twice
State explicitly what will be deleted:
```
About to discard worktrees/<issue-number>/.
This removes all uncommitted changes and the isolated branch.
Committed changes on issue-<issue-number> are preserved in git history.
Type 'discard' to confirm.
```

Wait for the user to confirm before proceeding.

After confirmation, use the existing lifecycle for shutdown and removal. Ask separately before deleting the branch; preserve it otherwise.

Use `process-lifecycle` for environment shutdown and slot metadata. Keep the worktree unless deletion is authorized. Finish with the actual submission/artifact state, canonical handoff paths, validation, remote evidence and environment disposition.
