# Fable-Era Plugin Rewrite Specification

Date: 2026-06-09. Branch: `feature/fable-rewrite`. Scope: sprint, retro, research-lab, ideate, improve, drupal-lab, ideas-funnel, admin, workshop. **Out of scope: drover (untouched), lib (untouched — per-CLI-tool skill boundary is deliberate).**

## Why

Roughly half of the skill prose in this repo is orchestration machinery built to compensate for what the Claude Code harness could not do in 2024–2025. The harness now does it natively, and the Fable 5 model follows contracts without behavioral railings. Domain methodology stays; plumbing goes.

## Shared Principles (every rewritten skill follows these)

1. **Skill = contract + domain knowledge.** State what the skill does, its inputs, its outputs, and the domain knowledge the model cannot infer. Delete behavioral railings: anti-pattern lists, repeated warnings, "do NOT ask are you ready" coaching, rigid multi-question wizards. One statement of a rule, where the rule is genuinely non-obvious, is enough.
2. **Orchestration goes through the Workflow tool.** Any fan-out (parallel workers, reviewer panels, multi-domain ingest) is expressed as a workflow script the skill instructs the main agent to run. A skill instructing a Workflow call counts as user opt-in. Keep scripts in the skill's `scripts/` directory as `.js` files invoked via `scriptPath`, or inline in SKILL.md as a fenced block if short.
3. **No polling, no heartbeats, no shutdown ceremonies.** The harness notifies when background tasks and agents complete. Hooks exist for TeammateIdle, TaskCompleted, SubagentStop, SessionStart, PreCompact. Delete every "check every turn" loop, heartbeat sidecar, and multi-turn shutdown ritual.
4. **No file-based session state for resumability.** Delete `.research.json` / `.brainstorm.json` / `.reality-check.json`-style sidecars and custom state machines. Conversation context plus Workflow resume covers in-flight state. Durable state goes in beads (`bd`) or the Obsidian vault — nothing else.
5. **Structured handoffs are JSON schemas, not markdown conventions.** When one stage feeds another, define a schema and pass it to `agent(prompt, {schema})`. Never instruct the model to parse prose output of another agent.
6. **One owner per unit of work (vertical slice).** No analyzer → planner → implementer → reviewer relay chains. One agent owns a problem end-to-end with 1M context; fresh-context reviewers verify, they do not co-author.
7. **Teams only for genuine cross-talk.** Litmus: if workers need to message *each other* mid-flight, use TeamCreate. If work decomposes into independent slices reporting upward, use Workflow. Default is Workflow.
8. **Model selection: omit to inherit.** Do not assign model tiers per agent by default. Only override when a tier is clearly right for the task. The haiku/sonnet/opus decision trees are replaced by this rule plus a short exceptions note.
9. **Worktree convention over tool isolation.** Never use `isolation: "worktree"` on Agent/Workflow calls. Pre-create sibling worktrees per the project convention when file mutation in parallel is needed.
10. **No acronyms** in any prose. Inclusion list (only exceptions): JSON, URL, CPU, IP, HTTP, SEO, CDN, API, JSONL, CLI, DB, and product names (DDEV, JIRA, NotebookLM, GitHub).
11. **Preserve domain methodology verbatim where it is good.** The keep-list per plugin below is binding. When trimming a file, keep tables, decision rules, and environment knowledge; cut process narration.
12. **Skill frontmatter discipline.** Descriptions keep their trigger phrases and do/do-not boundaries — that part of the old style still earns its tokens, because it drives skill selection.

## Current Tool Surface (authoritative — do not invent beyond this)

- **Workflow tool**: runs a JavaScript script with `export const meta = {name, description, phases}` (pure literal) at top. Hooks available inside: `agent(prompt, {label, phase, schema, model, agentType})` → returns text or schema-validated object; `pipeline(items, ...stages)` (no barrier between stages — default); `parallel(thunks)` (barrier; thunks that throw resolve to null); `phase(title)`; `log(msg)`; `args`; `budget`; `workflow(nameOrRef, args)` for one level of nesting. No `Date.now()`/`Math.random()`/argless `new Date()` in scripts. Plain JavaScript, no TypeScript. Concurrency cap ~10–16; resume supported via `resumeFromRunId`. Patterns available: adversarial verify, perspective-diverse verify panels, judge panels, loop-until-dry, multi-modal sweep, completeness critic.
- **Agent tool**: `subagent_type`, `name`, `prompt`, `model` (omit to inherit; values sonnet/opus/haiku/fable), `run_in_background`, `team_name`. Completion notifies automatically — never poll for it.
- **SendMessage**: schema is `{to, summary, message}`. Used to continue a previously spawned agent or message a teammate.
- **TeamCreate / TeamDelete**: shared communication channel for spawned teammates. Only for cross-talk topologies.
- **TaskCreate / TaskUpdate / TaskList / TaskGet**: harness task tracking (note: in THIS project, beads is the tracker of record; harness tasks are for live agent coordination only).
- **Hooks (13 events)**: PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, UserPromptSubmit, SessionStart, SessionEnd, SubagentStart, SubagentStop, TeammateIdle, TaskCompleted, PreCompact. Auto-register from `hooks/hooks.json`.
- **Scheduling**: CronCreate / CronDelete / CronList for recurring local loops; ScheduleWakeup for dynamic self-pacing inside /loop; Monitor for until-condition waits. Singleton discipline: check CronList before CronCreate.
- **Background Bash**: `run_in_background: true`, harness re-invokes on exit.
- **1M-token context** on the session model. Summarization/compression steps are optional tools, never structural requirements.

## Token Optimization Integration (rtk + headroom)

Two tools the operator is adopting. Both are **optional accelerators, never hard dependencies**: every integration point preflights with `command -v rtk` / `command -v headroom` and degrades silently to the plain path when absent.

- **rtk (Rust Token Killer)** — CLI proxy that filters verbose development-command output (60–90% savings). A user-level hook already rewrites top-level Bash calls (`git status` → `rtk git status`), so skills must not fight or duplicate that. The hook does NOT reach commands nested inside scripts or workflow-spawned agents — there, call `rtk` explicitly for known-verbose operations (test runners, linters, git log/diff, composer, npm, DDEV output). `rtk gain --history` is a measurement source. `rtk discover` mines history for missed proxy opportunities.
- **headroom** (github.com/chopratejas/headroom) — context compression for everything an agent reads: tool outputs, logs, files, JSON. CLI: `headroom wrap <agent>`, `headroom proxy`, library `from headroom import compress`; `headroom perf` shows savings. Use it where a skill feeds a LARGE artifact (session transcript, log corpus, fetched article wall) into model context: compress first when the binary is present, and prefer its reversible mode (originals stored locally, retrievable on demand) over lossy truncation.

Where each plugin applies this (binding, but keep each integration to a short paragraph — no new subsystems):
- **sprint**: slice-worker and cross-reviewer agent definitions note that verbose build/test/lint output inside their own Bash calls should go through rtk when present.
- **retro**: transcript reads JSONL session files that routinely exceed 100k tokens — when headroom is present, compress the transcript before summarizing (reversible mode so evidence can be retrieved verbatim); otherwise use the existing scoped extraction.
- **research-lab / ideate**: understand and gather may compress pasted walls of text or fetched sources through headroom before digestion; one sentence each, optional path only.
- **improve**: deepest integration. (1) perf-measure gains a token-cost measurement mode sourcing `rtk gain --history` and `headroom perf` as JSON score tuples, so the experiment ratchet can target token spend as a metric. (2) lint gains one new rule sourced from `rtk discover` output (missed-proxy-opportunity, watch tier). (3) the propagation table notes both tools.
- **drupal-lab**: ddev and validate-patch note explicit rtk proxying for phpunit/phpcs/phpstan output inside scripts and worker agents.
- **ideas-funnel**: ingest compresses large raw articles through headroom (when present) before page-breaking.
- **admin**: install learns dependency mappings for both tools (rtk via its documented install path; headroom via `pip install "headroom-ai[all]"` or `npm install headroom-ai`).

## Per-Plugin Contracts

### sprint → 4.0.0
- **run**: rewrite around one Workflow invocation. Ready beads → `pipeline()` of slice-worker agents (one per bead, schema output), optional cross-review stage as adversarial verify on the same pipeline (no barrier). Slice-worker schema includes: bead id, outcome, files touched, test results, AND the retro interview fields (see retro contract). The skill writes the workflow's returned JSON to `analysis-reports/retro-session/<date>+<sprint>/results.json`. DDEV slot cap expressed as a constraint the workflow script enforces (max 3 concurrent DDEV-flagged items — use a slot counter in script logic, beads metadata as record). No team-lead loop, no SendMessage choreography, no graceful-shutdown sequence. Teams remain a documented escalation for genuine cross-talk only.
- **plan**: keep; trim process narration. Dependency sequencing logic, cross-review heuristics table, and approval flow stay.
- **board, kanban**: keep; light trim. Lane model and claim-before-work discipline are binding.
- **project-notes**: keep; light trim.
- **asset-audit**: retire (delete) — improve plugin owns process auditing. Note removal in CHANGELOG.
- **agents/**: keep `slice-worker` (rewritten lean: owns issue end-to-end, emits structured final output per the run schema), keep `deep-debugger` (escalation target). Fold `reality-checker` into `cross-reviewer` (one fresh-eyes verifier agent). Delete `team-lead`.
- **protocols/**: delete the directory entirely (SPAWNING.md, AGENT-COORDINATION.md, heartbeat.md, team-comms-protocol.md, ITERATIVE-RETRIEVAL.md). Anything load-bearing moves into the relevant skill or agent file in compressed form.
- **hooks/**: rewrite the SessionStart sprint-capability injection to describe the new model (plan → run via Workflow; no team-lead loop).

### retro → 4.0.0
- **interviews**: rewrite from ceremony to schema. The interview questions (3 common + 3 role-specific — preserve the question content) become fields in the slice-worker/cross-reviewer structured output schema. The skill documents the schema and where results land. No shutdown-imminent message flow, no SubagentStop fallback hook.
- **session**: rewrite to read `results.json` (structured interviews) plus transcripts. Keep the seven-phase shape only where each phase earns it; keep KEEP/IMPROVE/LEARN taxonomy, metrics definitions (first-pass rate etc. — computed from structured results now, not JSONL grep), user interview via AskUserQuestion, report template, action-card generation into the retro board.
- **kanban**: keep — verification gates, strategic rejection memory, dedup pass are all binding. Light trim.
- **transcript**: keep as a diagnostic tool; trim. Python helpers stay if they exist and work.

### research-lab → 3.0.0
- Keep all seven verb skills and their methodology: frame's falsification discipline, gather's NotebookLM integration, understand's design-tree walk, synthesize's commit-to-claim, interrogate's perspective-diverse panel, experiment's ratchet + futility stopping + JSON Lines logging, teach's Feynman gate.
- **interrogate**: the reviewer panel becomes a Workflow script (context isolation is native — each `agent()` call is fresh). Four lenses as parallel agents with a verdict schema; desk-reject logic stays in the skill. Delete hand-rolled spawning prose.
- **gather**: fan-out web research through Workflow where parallelism is needed; keep NotebookLM CLI reference intact; summarization/dedup passes become optional steps, not required phases.
- **teach**: Feynman quiz taker is a fresh `agent()` call with a quiz schema.
- Delete `.research.json` engagement-state files and the context-flow resumability convention (keep at most a one-paragraph note on directory naming for artifacts).
- **agents/**: principal-investigator stays as an optional composing research lead (already reframed) — trim to match new mechanics; experimentalist stays; researcher can stay lean (used for parallel facet coverage via Workflow `agentType`).
- Scripts (log-iteration, measure.sh, notebook helpers) were correctness-fixed in June 2026 — keep them; do not regress them.

### ideate → 4.0.0
- **brainstorm**: keep the diverge-then-rate split and the browser annotation canvas (human interface, not model railing). Remove `.brainstorm.json` session-state ceremony beyond what the canvas round-trip strictly needs; trim defensive prose.
- **reality-check**: keep the five-gate KILL funnel and rebuttal rubric verbatim. Delete `update-gate.py` state machine — the model tracks gate progression in conversation and emits a structured verdict (schema in the skill). Keep session archive as a simple final write, not incremental state.
- **compare**: keep asymmetric scoring (UNKNOWN ≠ NO) and the three strategies; trim.
- **diagram**: keep isomorphism test and the Excalidraw JSON reference; trim.
- **adr**: keep; light trim.
- **research** (redirect shim): delete the skill; note in CHANGELOG that research-lab:gather owns the trigger phrases.

### improve → 2.0.0
- Keep: trust model (confidence → action), lint rule lifecycle (watch → warn → auto-fix), propagation table, all lint rules, measurement skills (perf-measure, accessibility-scan and its Node script).
- **Process-engineer agent**: rewrite observation model from transcript-polling to event-driven — subscribe via hooks (PostToolUseFailure, TaskCompleted, SubagentStop) and on-demand transcript reads; delete the polling-loop version-1 prose.
- **attach / fix / experiment / lint / self**: keep jobs as-is, trim mechanics, experiment delegates measurement unchanged.

### drupal-lab → 3.0.0
- **agents/**: collapse seven (architect, fixer, implementer, issue-analyzer, issue-planner, reviewer, test-coverage-analyst) into two: `issue-worker` (owns a drupal.org issue end-to-end: analyze, plan, implement, test, validate — absorbing the analyzer/planner/implementer/fixer/architect knowledge worth keeping) and `reviewer` (fresh-context verification, absorbing test-coverage-analyst's gap analysis). Preserve each retired agent's genuinely Drupal-specific knowledge by folding it into the two survivors or into skill references.
- **Skills**: keep all fourteen jobs. validate-patch keeps Phase 0 static test-design review verbatim. ddev and process-lifecycle keep all environment knowledge (SIMPLETEST_DB, MINK_DRIVER_ARGS, Chrome webdriver, config.local.yaml per-worktree naming) but lose phase narration; slot management becomes beads metadata (`ddev=true`) as the single record, with a stale-slot reclaim note instead of bash polling. analyze-issue keeps drupal.org fetching + language-server-protocol-with-grep-fallback. optimize trims to a thin composition over research-lab verbs.
- Structured handoffs: analysis and plans emit JSON artifacts consumed by the next stage, replacing markdown-narrative state. analysis-reports/ remain as human-readable renders, not as the state machine.

### ideas-funnel → 2.0.0 (singleton fix — user-reported bug)
- **Today's defect**: the plugin launches a scheduled loop per Claude instance. Required: exactly one scheduled pipeline globally.
- Replace the orchestrator agent + lock file + backlog queue + signal parsing with **one scheduled Workflow**: a single cron entry runs a workflow script — `parallel()` ingest per affected domain → threshold check in plain script logic → conditional refinery stage → scorer stage if due. Stages use schemas.
- **New skill `schedule`** (or fold into `init`): idempotently ensures the singleton — CronList first; create only if absent; a marker in the vault `_meta/` records owner + cron id so a second Claude instance declines to create another. Document the de-registration path.
- Keep: ingest's page-breaking logic and frontmatter schema, lint, query, init vault bootstrap, domain-scoped pages with refinery promotion at ≥3 unrelated sources.
- Delete: orchestrator agent, lock-file protocol, backlog queue, timeline-sidecar workaround if frontmatter limits no longer bind. Ingest/refinery agent definitions become `agentType` targets for the workflow or fold into the script prompts.

### admin → 3.0.0
- **Baseline note**: `agent-team` was reworked on unmerged branch `feature/agent-team-refresh` (admin 2.6.0). Use THAT version of `admin/skills/agent-team/SKILL.md` (read it from `/Users/Chris.Weber/Tools/CLAUDE-PLUGINS/worktrees/agent-team-refresh/`) as the baseline, and pull in that branch's new-agent fixes and CHANGELOG entries, so the rewrite supersedes the pending branch.
- **new-agent**: collapse the four-phase eight-question wizard into judgment + a short checklist; keep color-collision check and omit-to-inherit model guidance.
- **new-skill**: keep progressive-disclosure structure guidance; trim wizard.
- **optimize-agents**: rewrite around omit-to-inherit; the audit now checks for stale tool syntax, stale model rosters, defensive-prose bloat — not tier assignment.
- **scaffold**: remove markdown-kanban directory creation; align with beads. **scaffold-silence**: merge into scaffold as a flag/path.
- **bump-version, changelog, update-plugins, install, create-worktree**: keep jobs, trim.
- **agent-team**: light touch only (recently reworked).

### workshop → 2.0.0
- **prioritize, scout, knowledge-check**: keep logic; trim. scout and prioritize loop registration must follow the same singleton cron discipline as ideas-funnel (CronList before CronCreate).
- **obsidian-lint, organize, config**: inline the load-bearing logic from `references/steps/*.md` into each SKILL.md; delete the indirection where a step file is just narration.
- **deploy-post, personal-calendar, personal-email**: keep; these are thin by design (CLI integrations).

## Mechanics for Implementation Agents

- Work only inside `/Users/Chris.Weber/Tools/CLAUDE-PLUGINS/worktrees/fable-rewrite/<your plugins>/`. Do not run any git commands. Do not touch drover/ or lib/ or other agents' plugins.
- Read every file you rewrite or delete before acting. Preserve the keep-list verbatim.
- Update each plugin's `.claude-plugin/plugin.json` version per the contract above and prepend a CHANGELOG.md entry (today's date, list what was removed/rewritten/kept and why, note breaking changes).
- Skill frontmatter: keep `name`, `description` (with trigger phrases and do/do-not boundaries), and any `allowed-tools` that remain accurate. If a skill instructs Workflow use, ensure Workflow is permitted in allowed-tools when that field is present.
- Hooks: if you change hook scripts, keep them executable and zsh-compatible (no `bash` prefix; `export VAR && cmd` not inline env vars).
- Cross-plugin references: if you reference another rewritten plugin, reference its new shape (for example sprint:run's Workflow model, retro's results.json) per this spec — the other agent is implementing the same spec.
- Target prose budgets (soft): a typical skill ≤120 lines; an agent definition ≤80 lines; only environment/domain reference files may exceed this.
