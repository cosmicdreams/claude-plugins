---
name: work-on-issue
description: >
  Start or resume implementation of a Drupal.org issue or GitLab work item: retrieve history and existing work, resolve the issue fork, prepare the correct worktree, and coordinate DDEV readiness and validation. Use for “work on this issue” or “fix this Drupal issue.” Not for investigation without implementation (drupal-lab:analyze-issue).
---

# Work on a Drupal issue

Read `drupal-lab/references/project-context.md`, `drupalorg-cli.md` and `issue-handoffs.md`. Resolve the actual project, canonical issue reference, task base and existing worktree. Existing task authority persists; do not treat this workflow as new permission to post, commit or push.

1. Run `drupal-lab:analyze-issue` to capture source discussion, patches/interdiffs, all merge requests and fork information. Read earlier approaches, maintainer decisions and unresolved objections before editing. Resolve missing evidence that affects implementation. Check release containment when the proposed fix might already have shipped.
2. Use the discovered fork/branches and the established project base to create or reuse the correctly placed dedicated worktree through `admin:create-worktree`. Fetch its actual remote with explicit Git commands. Never create a worktree under T3 defaults that conflict with project instructions, and never invoke the tool's branch/checkout/apply commands.
3. If the requested work needs a fork or access grant that does not exist, use the authenticated remote operation only under existing authority. Refresh fork state before retrying asynchronous operations. Without the necessary authority, continue local investigation/implementation and prepare the concrete remote action for the user.
4. Delegate environment preparation to `drupal-lab:process-lifecycle`. DDEV owns runtime, dependencies and tests; Drush owns installation, configuration, cache and database operations. Respect existing container slots; do not stop unrelated projects.
5. Implement the smallest fix against the actual issue contract. Inspect and check a selected patch before applying it in this worktree. Do not automatically adopt another contributor's proposal or push to their branch.
6. Run `validate-patch`, obtain the existing fresh-context reviewer when required, then use `issue-summary` and `finish-issue` under the task's delivery authority. Preserve source links, original-bug proof and separate local/remote results.

Return the canonical issue, worktree/branch/base, chosen proposal, existing-work disposition, analysis artifact, validation results and any specific missing upstream access. Keep incomplete evidence explicit; a ready container is not a completed contribution.
