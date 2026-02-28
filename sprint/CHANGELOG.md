# Changelog

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
