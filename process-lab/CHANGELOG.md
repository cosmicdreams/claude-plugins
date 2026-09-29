# Changelog

## 0.1.0 — 2026-09-29

First release, replacing the `improve`, `sprint`, and `retro` plugins. Design: `plans/task-linter-design.md`.

- Each project defines its process on its own Confluence page; `.velir/project.json` points at it by page id. No built-in process.
- Hooks notice branch creation, commits, test runs, pushes, and pull requests, record them in an append-only ledger, and name what the process requires. Observe mode by default; nothing is blocked until a project opts into enforce.
- Skills: `initialize`, `lint`, `advance`, `retro`, `codify`, `recommend-tickets`.
- Agent: `process-auditor`, a read-only check of one ticket's work against the process.
- Jira interaction strategy, including ticket recommendations moved from drover.
- From sprint: its checks survive as candidate gates a project may adopt. From improve: the observe-to-enforce promotion on evidence. From retro: facilitation, now for real project retrospectives.
- Removed with the old plugins: agent tuning (`optimizer`, `process-engineer`, `self`, `attach`, `fix`, `experiment`), the sprint board and worker pipeline, and worker interviews. Agent and skill definition lint rules moved to `admin:optimize-agents`; `accessibility-scan` and `perf-measure` moved to `test-lab`.
