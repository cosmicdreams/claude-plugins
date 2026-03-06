# Changelog

## 2.0.0
- Add `retro:changelog` skill — displays retro CHANGELOG with `--latest` and `--since X.Y.Z` filtering

## 1.1.0
- Rename skill invocations: `retro:retro-session` → `retro:session`, `retro:retro-kanban` → `retro:kanban`, `retro:retro-interviews` → `retro:interviews`, `retro:retro-transcript` → `retro:transcript`

## 1.0.0
- Initial release — extracted from sprint plugin as a standalone retrospective domain
- Skills: session, kanban, transcript, interviews
- Hooks: SubagentStop (subagent-stop-interview.sh) — fires on every team agent shutdown to capture structured interview data
- session skill decoupled from sprint: kanban/sprint-run/ is optional enrichment; runs on interview files + JSONL alone
- Integration contract: SubagentStop hook writes interview files to analysis-reports/retro-session/<date>+<sprint>/interviews/; retro:session reads from that path without requiring sprint to be installed
