---
name: browse-drupal-issues
description: >
  Browse project or maintainer queues and search Drupal.org issues across classic feeds and migrated GitLab work items, preserving requested status, priority, component and ordering. Use to find contribution or review work. Not for deep investigation of one issue (drupal-lab:analyze-issue).
---

# Browse Drupal issues

Read `drupal-lab/references/drupalorg-cli.md` and resolve project context through `project-context.md`. Use the shared adapter, which selects the correct upstream backend and retains source identities. The old feed script remains the classic parser, not the standalone entry point for every project.

```sh
python3 <plugin>/scripts/drupalorg.py --output <fresh-run-dir> issues drupal --status=Open --component=settings_tray --priority=Major --limit=10
python3 <plugin>/scripts/drupalorg.py --output <fresh-run-dir> issues settings_tray --limit=10
python3 <plugin>/scripts/drupalorg.py --output <fresh-run-dir> search webform --query='ajax' --status=Open
python3 <plugin>/scripts/drupalorg.py --output <fresh-run-dir> issues drupal --maintainer=cweber
```

Resolve an omitted project from the configured upstream project or the existing feed script's `detect_project_name()` helper (module environment, info file, Composer package, then project documentation). Confirm the detected project; do not assume every contrib issue belongs to core.

Default browsing means open issues ordered by last update, with the requested limit applied after server filtering. The adapter preserves classic component/priority behavior and maps supported migrated statuses and priorities to labels. Migrated component filtering fails explicitly until a project-specific mapping exists; do not drop it silently. Maintainer queues use their upstream semantics, without pretending to support unrelated filters.

Return relevant titles, canonical source links, applied filters, ordering and backend. Distinguish empty valid results, unsupported filters, partial pagination and access errors. Use `analyze-issue` to investigate a selected issue or `work-on-issue` when the user wants implementation.
