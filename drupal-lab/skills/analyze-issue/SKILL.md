---
name: analyze-issue
description: >
  Investigate one Drupal.org issue or migrated GitLab work item: retrieve full history, source comments, patches and merge requests; inspect affected code and write a structured analysis. Also use for questions about which project release contains a fix or commit. Not for starting implementation and preparing its worktree (drupal-lab:work-on-issue).
---

# Analyze a Drupal issue

Read `drupal-lab/references/project-context.md`, `drupalorg-cli.md` and `issue-handoffs.md`. Accept a number, issue URL or project-qualified work-item reference. Resolve migration and project identity before deriving paths or invoking fork/merge-request operations.

For a standalone release/commit question, run `releases`, `release-notes` or `contains` as documented in the shared reference and answer from their evidence; no issue number or local code change is required. For issue investigation:

```sh
python3 <plugin>/scripts/drupalorg.py --output <fresh-run-dir> issue-context <issue-reference>
```

Read the returned issue, complete source discussion and supplemental change/attachment evidence. Prioritize maintainer decisions, previous attempts, unresolved objections and substantive recent comments without losing older constraints. Use stable source comment links, never formatter-generated sequential numbers. Inspect relevant system/bot changes, attached patches and interdiffs. Partial retrieval requires resolving any missing evidence that affects the conclusions; do not invent a clean history.

Review all-state merge-request and fork results. Select the relevant proposal explicitly, keeping alternatives visible. Use `merge-request-context` for its review discussions, files, diff and complete pipeline evidence. Check `releases`, `release-notes` or `contains` when determining whether the fix already shipped or which versions are affected.

Inspect affected local code and tests. Prefer language-server definition/reference/implementation navigation for PHP; use text search for configuration, hooks and literals or when that facility is unavailable. Identify the actual cause, affected callers, compatibility implications and relevant test requirements. Do not assume every issue involves jQuery or modernization.

Write the canonical schema-version-2 `analysis.json` and a human-readable render under `analysis-reports/drupal-issue/<project>/<id>/`. Preserve current analysis fields, add canonical `identity` and evidence references, and use `root_cause: null` when not established by code. Record prior patches/merge requests, unresolved decisions and missing access. Complexity is simple (1–3 straightforward files), medium (4–10/multiple concerns) or complex (architectural/cross-module work), adjusted by the actual change rather than file count alone.

Archive the completed analysis to `~/Vaults/Neurons/OpenSource/Drupal.org/<project>/<id>-<title-slug>.md` using the existing vault conventions, including project, issue, title, date and tags. The repository artifact remains the machine-readable handoff; do not parse the Markdown render. A request to implement continues through `work-on-issue` rather than stopping after the report.
