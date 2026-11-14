---
name: inspect-merge-request
description: >
  Inspect a Drupal GitLab merge request or diagnose its pipeline: gather the diff, review discussions, conflicts, revision identity and complete failed-job evidence. Use for “review this merge request,” “what blocks it,” or “why did this pipeline fail.” Not for running local Drupal quality gates (drupal-lab:validate-patch).
---

# Inspect a Drupal merge request

Read `drupal-lab/references/drupalorg-cli.md` and `issue-handoffs.md`. Require an explicit merge-request URL or project-path reference. If the input is an issue, discover all merge requests through `analyze-issue` and select the relevant proposal with a reason.

```sh
python3 <plugin>/scripts/drupalorg.py --output <fresh-evidence-dir> merge-request-context 'project/drupal!17820'
```

For pipeline-only diagnosis, use `pipeline-context` instead. Read its complete job inventory and recovered full traces; do not rely on the CLI's truncated log summary. Identify every blocking failed job, the causal excerpt, source URL, pipeline/revision and missing access. Unknown or merge-result revision relationships are not automatically stale or current.

Compare the request with the source issue's actual requirements, prior decisions and unresolved review notes. Check author, source/target branches and projects, closing issue links, draft/conflict/mergeability state and whether the evidence applies to the intended revision. A title mentioning an issue does not establish that it closes it.

For remote inspection, return the assessment and source-linked findings without checking out, changing labels or posting comments. For review of a local fix, hand this evidence to the existing `reviewer` in the correct dedicated worktree; local DDEV gates remain required. Write a canonical review handoff only when performing that full local review; a remote inspection alone must not create a false `pass` verdict.
