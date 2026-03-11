# Changelog

## 3.1.0
- Removed `retro:changelog` — use `admin:changelog retro` instead
- Vault writes in `retro:interviews` and `retro:session` now assume Obsidian is running; `obsidian help` is only run as a diagnostic if the write fails

## [3.0.0] — 2026-03-09

### Breaking Changes

- **Migrated kanban to Beads (bd CLI)**: The file-based `kanban/retrospective-actions/` directory is replaced by a Beads database at `.beads/retro.db`. All card operations now use `bd` commands.
- **Card IDs changed**: Old `retro-YYYYMMDD-NNN` filename IDs replaced by Beads auto-assigned hash IDs. Session is tracked via `session-YYYY-MM-DD` label.
- **Kanban UI removed**: The markdown-based board viewer no longer works. Use `bd list --json` for board inspection.
- **Frontmatter removed**: Card metadata (target, category, priority, effort, verification_required) is now stored as Beads labels and fields. Verification evidence is stored via `--append-notes`.

### Migration

1. Install beads: `brew install beads`
2. Start dolt server: `dolt sql-server &`
3. Init retro database: `bd init --prefix retro` (from project root)
4. Run migration: `zsh scripts/migrate-to-beads.sh`

## 2.1.0
- `retro:session` archives sprint retrospective reports to `Neurons/Retrospectives/<date>+<project>+<sprint>/SESSION-RETROSPECTIVE.md`
- `retro:interviews` archives per-agent interview files to the same vault path structure
- Both skills require a project slug (from `OFFICE_PROJECT_NAME` env, kanban frontmatter, or user prompt) — retros are never stored without project context
- YAML frontmatter (`project`, `sprint`, `date`, `tags`) enables cross-project Obsidian queries

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
