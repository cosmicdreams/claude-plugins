# Changelog


## 3.2.1
- Removed `mcp__sequential-thinking__sequentialthinking` from team-lead and process-improvement agent tool lists
## 3.2.0
- `sprint:run`: added Prerequisites section — launch sessions with `claude --dangerously-skip-permissions --agent team-lead` to give the main thread a defined identity and full tools list
- `sprint/agents/team-lead`: added missing tools (TeamCreate, CronCreate, CronDelete, CronList, Agent, Skill); fixed description (removed Settings Tray reference)
- `sprint/protocols/SPAWNING`: added Required Tools Per Agent Role section — documents minimum tools per role, compaction recovery silent failure risk, and shell alias limitation in bash scripts
- `sprint:run`: added build-sprint naming convention — name implementer agents by role (impl-agent-1) not by artifact (impl-team-lead)

## 3.1.1
- `sprint:project-notes`: vault write is now filesystem-direct — no Obsidian CLI dependency

## 3.1.0
- Removed `sprint:changelog` — use `admin:changelog sprint` instead
- `sprint:project-notes` now archives a per-sprint snapshot to the Neurons vault at `Projects/<project>/release-notes/<date>-sprint-notes.md` after writing the local RELEASE-NOTES.md
- Vault writes across all skills now assume Obsidian is running; `obsidian help` is only run as a diagnostic if the write fails

## [3.0.3] — 2026-03-09
- `sprint:run`: sharpen trigger to lead with "executes" intent; add explicit sprint:plan vs. sprint:run boundary with concrete examples; move anti-patterns inline into skill body; remove orphaned empty `## Kanban Board` section; fix section hierarchy (`##` → `###`)
- `sprint:plan`: fix `bd init` error on already-initialized boards; fix `--acceptance` → `--description` flag in all `bd create` examples; add duplicate-card guard before creation; add "order the backlog by dependencies" trigger phrase; add explicit negative guardrail against execution requests

## [3.0.2] — 2026-03-09
- `sprint:run`: fix stale "file-based Kanban" in description — now correctly says "Beads database pipeline (.beads/sprint.db)"
- `sprint:plan`: add missing `allowed-tools: Bash, Read, Write`; Step 1 now checks Beads board for existing cards before falling back to file-based analysis reports

## [3.0.1] — 2026-03-09

- Added Card Body Standard to `sprint:plan` skill: BDD Given/When/Then acceptance criteria format (AC-1/AC-2/AC-3), card body schema with "What to change / What NOT to change / Acceptance Criteria" sections, and guidance for generating testable ACs from card descriptions
- Added SUMMARY write step to `SPAWNING.md` implementer prompt: before closing a card, agents write a structured `SUMMARY: <what was built> / <ACs passed> / <deferred>` comment via `bd update --append-notes`

## [3.0.0] — 2026-03-09

### Breaking Changes

- **Migrated kanban to Beads (bd CLI)**: The file-based `kanban/sprint-run/` directory is replaced by a Beads database at `.beads/sprint.db`. All card operations (create, claim, move, close) now use `bd` commands instead of file moves. Existing markdown cards must be migrated via `scripts/migrate-to-beads.sh`.
- **`BD_ACTOR` required**: All agents must set `export BD_ACTOR=<agent-name>` before calling any `bd` command. Add to every agent spawn prompt.
- **Shell scripts removed**: `view_board.sh`, `pipeline_status.sh`, `show_blocked.sh`, `search_by_tag.sh`, `search_content.sh`, `list_all_cards.sh` are no longer used. Replace with `bd list`/`bd ready`/`bd blocked` commands.
- **Kanban UI removed**: The `kanban-ui/server.js` markdown-based board viewer no longer works. Board inspection is via `bd list --json` terminal output.

### Migration

1. Install beads: `brew install beads`
2. Start dolt server: `dolt sql-server &` (required for bd operations)
3. Init sprint database: `bd init --prefix sprint` (from project root)
4. Run migration: `zsh scripts/migrate-to-beads.sh`

## 2.0.0
- Rename `release-notes` skill to `changelog` — invoke as `/sprint:changelog`; `/sprint:release-notes` no longer works
- Remove `pre-tool-use-observe.sh` and `post-tool-use-observe.sh` hooks — observation JSONL was never consumed; process-improvement agent uses `retro:transcript` instead
- Remove `PreToolUse` and `PostToolUse` hook registrations from `hooks.json`
- Remove `observe-workspace/` eval artifacts from plugin source tree
- Add trigger evals and improved description for `sprint:observe`

## 1.5.1
- Remove git-guard PreToolUse hook — no longer needed now that co-authorship attribution is disabled natively

## 1.5.0
- Extract all retrospective skills and SubagentStop hook to standalone `retro` plugin — sprint is now execution-only
- Remove sprint:retro-session, sprint:retro-kanban, sprint:retro-transcript, sprint:retro-interviews skills
- Remove SubagentStop hook (subagent-stop-interview.sh) — now owned by retro plugin
- Remove retro-related keywords and description references from plugin manifest

## 1.4.0
- Add kanban board UI server (kanban-ui) for visual sprint board rendering

## 1.3.0
- Add sprint:project-notes skill — synthesizes 7_done/ cards and git log into structured RELEASE-NOTES.md entries; confirm-before-write, distinct from sprint:release-notes (plugin CHANGELOG)
- Rewrite all 7 board scripts (view_board.sh, pipeline_status.sh, show_blocked.sh, search_by_tag.sh, search_content.sh, list_all_cards.sh, list_tags.sh) to derive status from directory name; recurse all 7 kanban subdirectories instead of reading status: frontmatter
- Add ALLOWED FILES hard constraint block to agent spawn prompt template in SPAWNING.md and run/SKILL.md Step 3 example
- SubagentStop interview hook: inject role-specific questions (D1-D3 implementer, V1-V3 reviewer, P1-P3 process-improvement) alongside C1-C3 common questions; add existence check to skip re-blocking when interview already written

## 1.2.2
- Fix process-improvement self-model anchoring — add Primary Enforcement Targets table (gate, agent, what to look for) near top of definition; reorder checklist so discipline gates come first, board hygiene last

## 1.2.1
- Add fast-path to retro-kanban — trivial wording/description cards (≤5 lines, no behavior change) can be applied immediately with "Apply Now" option instead of queuing
- Add pressure testing gate — action cards with `verification_required: true` cannot move to done without `verification_evidence`; process-improvement reads approved discipline cards on spawn and adds their gates to active probe agenda

## 1.2.0
- Add sprint:asset-audit skill — structured usage audit with sprint-cycle (default) and --scope full modes; includes trigger-failure detection for skills loaded via Read instead of Skill tool
- Revamp process-improvement agent with three operating modes (Observation, Probe, Audit), interrupt authority to block agents mid-work on gate skips, context-independence framing, and self-refinement authority
- Rewrite all sprint skill descriptions as triggering conditions (CSO audit) — removes capability summaries, adds concrete trigger phrases and negative boundaries
- Distill CROSS-AGENT.md content (severity scale, file reference format, collaboration chains, tool capability table) into AGENT-COORDINATION.md; remove standalone file
- Remove IDLE-TIMEOUT.md — idle management handled by CLAUDE.md and team-lead behavior
- Remove subagent-stop-test.sh hook — hook testing infrastructure no longer needed

## 1.1.0
- Add git guard hook (PreToolUse) — blocks agents from running `git add`, `git commit`, or `git push`
- Add PreCompact advisory hook — prompts agents to `/compact` between kanban cards
- Add PreToolUse and PostToolUse observation logging hooks — write structured JSONL to `~/.claude/sprint-observations/`
- Add Error Recovery sections to all 7 sprint agents with transient/permanent error classification and escalation paths
- Add Quality Gates sections to all 7 sprint agents with role-specific pass criteria
- Update SKILL.md: metadata-only card scanning for team-lead, QA lane routing rule, ping path resolution at send-time, multi-file card placement hints
- Add ITERATIVE-RETRIEVAL.md protocol — opt-in 4-phase context retrieval pattern for agents (Dispatch → Evaluate → Refine → Loop, max 3 iterations)
- Fix `${CLAUDE_PLUGIN_ROOT}` unexpanded bug in subagent-stop-interview.sh (heredoc was single-quoted)

## 1.0.0
- Initial release — split from agent-squad plugin
- Skills: run (was sprint-run), plan (was sprint-planning), board (was sprint-kanban), kanban, retro-session, retro-kanban, retro-transcript, retro-interviews, release-notes
- Agents: team-lead, deep-debugger, reality-checker, code-quality-pragmatist, ui-comprehensive-tester, process-improvement, claude-md-compliance-checker
- Hooks: SessionStart (session-start.sh), SubagentStop (subagent-stop-interview.sh, subagent-stop-test.sh)
- Protocols: SPAWNING.md, AGENT-COORDINATION.md, CROSS-AGENT.md, IDLE-TIMEOUT.md, team-comms-protocol.md
- Templates: project-claude-team-sprint.md
