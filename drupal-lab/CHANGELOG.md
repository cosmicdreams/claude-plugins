# Changelog

## 3.0.1
- Shrink all 14 skill descriptions to a routing-sufficient summary; the full trigger-phrase detail moves into each SKILL.md body under `## When to use`, where it loads on invocation instead of sitting in context every session.
- Saves roughly 3,440 characters (~860 est. tokens) of always-resident context.
- Descriptions keep the distinctive tool vocabulary and the "not for X, use Y" disambiguation, so routing between sibling skills is unchanged.

## 3.0.0 — 2026-06-10

**Breaking: agent collapse from 7 to 2.**

### Removed agents (6 retired)

- `architect` — architectural analysis patterns folded into `issue-worker`
- `fixer` — root-cause investigation and fix patterns folded into `issue-worker`
- `implementer` — TDD workflow, worktree discipline, and pre-review checklist folded into `issue-worker`
- `issue-analyzer` — drupal.org fetching, LSP-with-grep-fallback, and Obsidian archive folded into `issue-worker`
- `issue-planner` — spec authoring (problem statement, root cause, solution contract, acceptance criteria) and TDD task structure folded into `issue-worker`
- `test-coverage-analyst` — gap analysis approach folded into `reviewer`

### New agents (2)

- `issue-worker` — owns a drupal.org issue end-to-end (analyze, plan, implement, test, validate); emits `analysis.json` and `plan.json`; ≤80 lines
- `reviewer` (rewritten) — fresh-context spec compliance + code quality + coverage gap analysis; emits `results.json`; ≤80 lines

### Skills rewritten

- `validate-patch` — Phase 0 static test-design review preserved verbatim; trimmed process narration; added optional rtk proxying note for phpcs/phpstan output
- `ddev` — all environment knowledge preserved (SIMPLETEST_DB, MINK_DRIVER_ARGS, Chrome webdriver, config.local.yaml per-worktree naming); slot management now uses beads metadata `ddev=true`; stale-slot reclaim note added; optional rtk proxying note added; phase narration removed
- `process-lifecycle` — all environment knowledge preserved; slot management via beads metadata; bash polling loop replaced with beads metadata as single record; phase narration trimmed
- `analyze-issue` — drupal.org fetching and LSP-with-grep-fallback preserved; structured handoff (analysis.json) is now the primary output; markdown render is secondary
- `optimize` — reframed as thin composition over research-lab verbs (gather, synthesize, interrogate, experiment); Drupal-specific preflight, methodology, and cleanup steps preserved; verbose phase narration removed

### Structured handoffs

`analysis-reports/drupal-issue/<issue>/analysis.json` and `plan.json` are the machine-readable
state passed between stages. `analysis-reports/` markdown renders are human-readable only.
Schemas in `drupal-lab/references/issue-handoffs.md`.

### Distribution

Distributable via Claude Desktop Personal Plugins: zip the plugin directory so
`.claude-plugin/` is at the archive root, then upload as `.zip`.

## 2.7.1
- `generate-chart.py` moved to research-lab (it is a generic `results.jsonl` visualizer owned by
  `research-lab:experiment`). `optimize` now runs it from `$RESEARCH_LAB_ROOT/scripts/generate-chart.py`,
  consistent with how it already reads research-lab's PI role, context-flow, methodology-spec, and
  report template. No behavior change for optimize users; research-lab must be installed (already a
  declared dependency).

## 2.7.0
- Add `optimize` skill — the Drupal cache/performance engagement, moved from `research-lab:run`
  (research-lab 2.0 extracted it as Drupal-specific). Pipeline: preflight → gather → synthesize →
  methodology → experiment → report, against local DDEV only.
- Move `preflight.sh` (cache-header audit) and `generate-chart.py` into `drupal-lab/scripts/`.
- `optimize` declares **research-lab as a hard dependency** (calls `gather`/`experiment` via
  `Skill()`, reads PI/researcher agents + protocols from the research-lab install via `$RL_ROOT`),
  and fails fast with an install hint if research-lab is absent.
- Back-compat: the old `research-lab:run` trigger phrase routes to `drupal-lab:optimize`.

## 2.6.0
- Add Drupal team branch-workflow skills: `sprint-start`, `release-cut`, `branch-audit`
- Add `branch-guard.sh` PreToolUse hook: hard-blocks destructive git ops on `main`, soft-blocks on `sprint/*` and `release/*` with audited `DRUPAL_LAB_BYPASS=1` override
- Hook applies by default to every project in `~/.claude/drupal-lab.json`; opt out per-project with `team_flow.enabled: false`
- Add `references/feature-branch-mapping.md` documenting ticket↔branch resolution rules used by release-cut and branch-audit

## 2.5.1
- Deduplicate general DDEV knowledge from `ddev` and `process-lifecycle` skills; cross-reference `lib:ddev`

## 2.5.0
- Add `perf-measure` skill — xhprof, New Relic setup, slow query log; callgraph_top_10 for autoresearch hypothesis generation
- Rename `ddev-drupal-dev` → `ddev`; cross-references to both perf-measure skills

## 2.4.0
- Retire `advisor` agent — overlapped architect, fixer, and issue-planner with no unique workflow
- Dedup 5 agents (reviewer, implementer, issue-analyzer, fixer, architect): replace inline Team Coordination, DDEV, Shutdown Protocol with pointers to canonical sources (-280 lines)
- `implementer`: fix stale git-ops:create-worktree → admin:create-worktree, update description
- `issue-analyzer`: update description (remove Settings Tray scoping)
- `issue-planner`: remove 87 lines of capability filler, fix tools (add SendMessage, remove Edit)
- `fixer`: add missing SendMessage/Write/Glob tools, remove Tools Available and Quality Standards filler, remove stale drupal-patterns reference
- `architect`: add Bash/SendMessage tools, remove Tools Available/Integration/Success Criteria filler, fix description
- `test-coverage-analyst`: add SendMessage, remove filler sections and stale drupal-test-patterns reference

## 2.3.2
- Removed `mcp__sequential-thinking__sequentialthinking` from all agent tool lists (implementer, advisor, issue-analyzer, issue-planner, reviewer)
## 2.3.1
- `module-dev-starter`: pass `--project-name` to `ddev config` to prevent DDEV name collisions across projects using the `worktrees/main/` convention
- `module-dev-starter`: verify phpunit is available after `ddev poser`, re-run if missing
- `module-dev-starter`: DDEV naming convention `<module>-main` / `<module>-<issue>` documented in SKILL.md and CLAUDE.md template
- `module-dev-starter`: added environment verification step and worktree discipline reminder with issue worktree bootstrap commands

## 2.3.0
- Added LSP tool (PHP code-aware navigation) to implementer, fixer, and architect agents
- Agents coached on when to use LSP vs grep: LSP for class hierarchies, method callers, interface implementations; grep for string patterns and non-PHP files
- `analyze-issue` skill: LSP guidance for tracing classes, finding references, and checking method signatures during code analysis
- `validate-patch` skill: LSP guidance for test inheritance chain traversal (Phase 0.2) and coverage gap detection (Phase 0.5)

## 2.2.1
- `drupal-lab:analyze-issue` and `drupal-lab:issue-summary`: Drupal vault path moved to `OpenSource/Drupal.org/<project>/` — aligns with new vault taxonomy
- Both skills: vault writes are now filesystem-direct — no Obsidian CLI dependency

## 2.2.0
- Removed `drupal-lab:changelog` — use `admin:changelog drupal-lab` instead
- Vault writes in `drupal-lab:analyze-issue` and `drupal-lab:issue-summary` now assume Obsidian is running; `obsidian help` is only run as a diagnostic if the write fails

## 2.1.0
- `drupal-lab:analyze-issue` archives issue analysis reports to `Neurons/Drupal.org/<project>/<issue-number>-<slug>.md`
- `drupal-lab:issue-summary` archives contribution comments to the same vault namespace
- Drupal core issues route to `Drupal.org/drupal/`; contrib modules route to `Drupal.org/<module-machine-name>/`
- YAML frontmatter (`drupal_project`, `issue_number`, `date`, `tags`) enables cross-issue pattern queries

## 2.0.0
- Rename `release-notes` skill to `changelog` — invoke as `/drupal-lab:changelog`; `/drupal-lab:release-notes` no longer works
- Remove `protocols/IDLE-TIMEOUT.md`, `protocols/AGENT-COORDINATION.md`, `protocols/DDEV-CLEANUP.md` — unreferenced orphan docs

## 1.5.4
- Remove git-guard PreToolUse hook — no longer needed now that co-authorship attribution is disabled natively

## 1.5.3
- Add pattern analysis phase to fixer pre-patch investigation — find working case, read completely, list every difference, form one hypothesis before stating root cause (closes final Superpowers systematic-debugging gap)

## 1.5.2
- Add receiving-code-review section to implementer — name each finding before fixing, explicit disagreement over silent compliance, resubmit message must reference findings by name

## 1.5.1
- Add verification-before-completion to fixer (step 5.5 "Close the Loop" — re-run the original failing test before reporting done) and implementer (checklist step + `bug-test` field in handoff message format)

## 1.5.0
- Add drupal-lab:finish-issue skill — 4-path worktree lifecycle closer (submit as MR, submit as patch, keep as WIP, discard); integrates with issue-summary for contribution comments and process-lifecycle for DDEV cleanup

## 1.4.0
- Add drupal-lab:reviewer agent with two-phase review: Phase 1 spec compliance (reads analysis report, fetches drupal.org issue and MRs, states explicit verdict before any tooling) and Phase 2 code quality (PHPCS, PHPStan, PHPUnit)
- Remove qa-validator agent — replaced by reviewer with broader mandate
- Rename kanban lanes: 4_needs-qa → 4_needs-review, 5_validating → 5_reviewing, 6_qa-failed → 6_review-failed
- Add root cause gate to fixer agent — explicit "The bug is X because Y" required before any patch attempt
- Add TDD requirement to implementer agent — red-green-refactor cycle with ddev phpunit commands
- Add worktree baseline prerequisite to implementer — ddev phpunit must pass before writing code
- Add spec output section to issue-planner — problem statement, root cause, solution contract, acceptance criteria
- Add 3-fix escalation rule to fixer and deep-debugger agents
- Rewrite drupal-lab skill descriptions as triggering conditions (CSO audit)

## 1.3.0
- Add git guard hook (PreToolUse) — blocks agents from running `git add`, `git commit`, or `git push`; bootstraps hooks infrastructure for drupal-lab
- Add Error Recovery sections to all 8 drupal-lab agents with role-specific transient/permanent error classification and escalation paths
- Add opt-in Context Retrieval section to implementer and qa-validator referencing ITERATIVE-RETRIEVAL.md protocol

## 1.2.4
- Add release-notes skill — displays CHANGELOG with `--latest` and `--since X.Y.Z` filtering for humans and agents

## 1.2.3
- Pre-sprint cleanup pass
- Add config keys post_update hook requirement to implementer pre-QA checklist

## 1.2.2
- Introduce needs-qa/qa-failed status vocabulary in agent definitions

## 1.2.1
- Git policy guard-rails
- phpcs.xml sync improvements

## 1.2.0
- New skills: retro-interviews integration, issue-summary, validate-patch
- Align with agent-squad process-improvement independence
