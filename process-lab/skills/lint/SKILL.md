---
name: lint
description: >
  Say what the project's process still requires: outstanding obligations for the current ticket,
  failed branch or commit checks, and a stale process cache. Read-only. Not for carrying out an
  obligation (process-lab:advance) or reviewing a stretch of work (process-lab:retro).
---

# What is outstanding

Read-only. Answers "what does the process still want from this ticket?" at any moment.

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/process_lab.py" status --json
```

Pass `--ticket <KEY>` for a ticket other than the current branch's. With no `.velir/project.json`, say the repository has no process connected and suggest `process-lab:initialize`.

Report, briefly:

- Outstanding obligations grouped by gate, oldest first (`opened_at`).
- Failed branch or commit checks (`failed_checks`).
- Whether the cache is stale (`cache.stale`, `cache.synced_at`); if so, suggest rerunning `process-lab:initialize`.

When the user asks whether the work actually meets the obligations, not just whether they were recorded, dispatch `process-lab:process-auditor` with the ticket, the branch, and the status output, and report its findings.

Suggest `process-lab:advance` for anything that can be done now. Do not discharge or waive anything here.
