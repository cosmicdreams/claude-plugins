# Changelog

## 1.0.0
- Initial release — extracted from sprint plugin as a standalone retrospective domain
- Skills: session, kanban, transcript, interviews
- Hooks: SubagentStop (subagent-stop-interview.sh) — fires on every team agent shutdown to capture structured interview data
- session skill decoupled from sprint: kanban/sprint-run/ is optional enrichment; runs on interview files + JSONL alone
- Integration contract: SubagentStop hook writes interview files to analysis-reports/retro-session/<date>+<sprint>/interviews/; retro:session reads from that path without requiring sprint to be installed
