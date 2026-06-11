# Changelog

## 4.0.0 — 2026-06-10

### Breaking Changes

- **`retro:interviews` rewritten from ceremony to schema.** The shutdown-imminent message flow is gone. Retro interview questions (C1-C3 common + role-specific D1-D3 / V1-V3) are now fields in the sprint Workflow output schema, collected inline by slice-workers and cross-reviewers. Results land in `results.json`, not in per-agent `.md` interview files.
- **`subagent-stop-interview.sh` SubagentStop hook deleted.** Automated interview capture via SubagentStop was unreliable (fires at idle, not shutdown). Interviews are now inline schema fields — no hook needed.
- **`hooks/hooks.json` emptied.** No active hooks remain.
- **`interview-templates.md` deleted.** Question content preserved verbatim as schema field descriptions in the new `retro:interviews` SKILL.md.
- **`retro:session` rewritten.** Reads `results.json` from sprint:run instead of per-agent interview files. Transcript compression via headroom (when present, reversible mode) before summarizing. Metrics computed from structured results, not JSONL grep. Seven-phase shape retained where each phase earns its keep.

### Kept (light trim or unchanged)

- **`retro:kanban`**: Verification gates, strategic rejection memory, dedup pass — all binding. Unchanged.
- **`retro:transcript`**: Diagnostic transcript reader. Light description trim; Python helpers unchanged.
- **`retro:session` references/**: report-structure.md, metrics-baseline.md, feedback-targets.md, action-card-template.md kept.
- **Obsidian storage**: vault path conventions and frontmatter schema unchanged.
- **KEEP/IMPROVE/LEARN taxonomy**: unchanged.
- **User interview via AskUserQuestion** (Phase 3.5): mandatory, unchanged.
- **Phase 7 user review of action cards**: mandatory, unchanged.

### Interview Question Content (preserved verbatim as schema fields)

Common (all roles): what_worked (C1), what_didnt (C2), one_change (C3)
Slice-worker (developer): key_decision (D1), cross_issue_pattern (D2), workflow_friction (D3)
Cross-reviewer: failure_root_cause (V1), handoff_quality (V2), infrastructure_friction (V3)

## 3.1.2
- Update interview templates, SKILL.md, and SubagentStop hook: process-improvement → process-engineer

## 3.1.1
- `retro:session` and `retro:interviews`: vault writes are now filesystem-direct — no Obsidian CLI dependency

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
