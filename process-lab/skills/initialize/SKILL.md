---
name: initialize
description: >
  Connect a repository to its project's process: write .velir/project.json, fetch the Confluence
  process page, and cache its gate table for the hooks. Rerun whenever the page changes. Not for
  checking what is outstanding (process-lab:lint) or editing the process (process-lab:codify).
---

# Initialize a project's process

Run once per repository, then again whenever the process page changes. The page is the source of truth; everything this skill writes is derived from it. Gate table format: `${CLAUDE_PLUGIN_ROOT}/references/gate-table.md`.

## 1. Manifest

If `.velir/project.json` exists at the repository root, read it and confirm it with the user. Otherwise build it with them:

- `client`, and `jira.project` — confirm the Jira project key against live work, not the Confluence space key; they differ on some projects.
- `confluence.space` and `confluence.pages.process` — the page id. Also record `call_log` and `runbook` page ids if the project has them.
- `mode` — always `observe` for a new project.
- `conventions.branch_pattern` and `conventions.test_commands` — read from recent branch names and the project's test setup, then confirm.
- `jira.estimate_field` — leave `null` unless the user knows it.

The manifest is committed with the repository so everyone on the project shares it.

## 2. Fetch the page

Fetch page `confluence.pages.process` in storage format, with its version number, using the Atlassian connector or the `twg` Confluence commands. Save the body to a temporary file.

If the page has no gate table, it is a placeholder. Offer to draft one from the project's Jira workflow and `${CLAUDE_PLUGIN_ROOT}/references/candidate-gates.md`, and show the draft. Writing to the page is visible to the whole space, so do it only after the user approves the exact content. Until then, stop here; the hooks stay silent without a cache.

## 3. Cache

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/process_lab.py" sync --page-file <file> --page-id <id> --page-version <n>
```

Show the user the parsed gates and any warnings (an unknown detection key, a malformed transition). Fix warnings on the page, not in the cache. Decide with the user whether `.velir/process-cache.json` is committed or ignored; committing it lets teammates work before running this skill.

## 4. Confirm

Run `process_lab.py status` and tell the user the project is in observe mode: work is recorded and gates are mentioned, nothing is blocked.
