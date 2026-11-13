# Changelog

## 0.3.0 — 2026-11-13

- `adr` writes to the repository's `docs/adr/NNNN-<slug>.md` by default, so teammates and agents working in the repository find the decision. Outside a repository, or when asked, it writes to the vault as before.
- `adr` first tests the decision: it writes only when the decision is hard to reverse, surprising without context, and a real trade-off. Otherwise it names the failed condition and stops, unless asked to record it anyway. The three-condition test and the shorter template (a title and one to three sentences, with options and consequences optional) come from Matt Pocock's `domain-modeling` skill (github.com/mattpocock/skills, Matt Pocock, MIT).

## 0.2.0 — 2026-11-13

- New `adr` skill, moved unchanged from `ideate:adr`, apart from its name and a description that now ends with a "Not for" clause naming `process-lab:lint`.

## 0.1.2 — 2026-11-10

- `retro` step 5 no longer invents a check for a judgment call. A lesson becomes an enforced action item only when a check could decide it from what the team already records, such as a branch name or a file in the change. When only a person can decide it, it stays a prose lesson or a team agreement with an owner, and the step says not to propose a new field or marker to make it checkable. On a saved retro fixture the 0.1.1 text gave the judgment lesson an invented enforcer in 2 of 3 runs; this text did in 0 of 3, and both enforceable lessons still became checks handed to `workshop:harden` in 3 of 3.

## 0.1.1 — 2026-11-06

- `retro` step 5 asks of every action item and lesson whether a hook, lint, script, schema or test could enforce it; if so it becomes a tracked card naming the check, handed to `workshop:harden` for the user's own tooling. Prose lessons are kept for judgment calls.

## 0.1.0 — 2026-09-29

First release, replacing the `improve`, `sprint`, and `retro` plugins. Design: `plans/task-linter-design.md`.

- Each project defines its process on its own Confluence page; `.velir/project.json` points at it by page id. No built-in process.
- Hooks notice branch creation, commits, test runs, pushes, and pull requests, record them in an append-only ledger, and name what the process requires. Observe mode by default; nothing is blocked until a project opts into enforce.
- Skills: `initialize`, `lint`, `advance`, `retro`, `codify`, `recommend-tickets`.
- Agent: `process-auditor`, a read-only check of one ticket's work against the process.
- Jira interaction strategy, including ticket recommendations moved from drover.
- From sprint: its checks survive as candidate gates a project may adopt. From improve: the observe-to-enforce promotion on evidence. From retro: facilitation, now for real project retrospectives.
- Removed with the old plugins: agent tuning (`optimizer`, `process-engineer`, `self`, `attach`, `fix`, `experiment`), the sprint board and worker pipeline, and worker interviews. Agent and skill definition lint rules moved to `admin:optimize-agents`; `accessibility-scan` and `perf-measure` moved to `test-lab`.
