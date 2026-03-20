# research-lab Changelog

## 0.3.0 (2026-03-16)

Round 3 improvements from the massport-cache-optimization engagement.

### Changed
- `preflight.sh`: removed `set -e` (was causing silent exits on curl failures). Added Block Cache Audit section that enumerates blocks with `max-age: 0`, broad tags, or high-cardinality contexts. Added Cache Tag Blast Radius test that primes pages, saves a node, and reports cache survival %. Added Page Cache and Cache-Control columns to header table.
- `run` Phase 1: worktree naming convention documented (worktree = engagement name only, DDEV = project-engagement). DB provisioning now has 3-option fallback sequence: local dump → Acquia pull → main export. Post-DB bootstrap is mandatory: `updatedb → config:import → cr`.
- `run` Phase 2: added diagnostic mode decision (2d) — after preflight, PI assesses whether to run full research pipeline or skip to methodology+experiment for observable problems.
- `run` Phase 6: added metric selection guidance table — prevents wrong metric choice by mapping user goals to appropriate metrics.
- `literary-review` Phase 1: added notebook reuse check — search for existing NotebookLM notebooks before creating new ones.
- `iteration-protocol.md`: added staging discipline section — only stage files from the current iteration, never investigation artifacts.

## 0.2.0 (2026-03-15)

### Changed
- `run` skill rewritten: delegates to `/create-worktree` and `/process-lifecycle` via Skill() instead of inlining instructions. Adds Hard Rules section (worktree discipline, local DDEV only, experiment controls termination, delegate don't improvise).
- `run` Phase 1: includes DB provisioning, DDEV naming convention, project-specific bootstrap question
- `run` Phase 2: auto-discovers content types and samples one page per type
- `run` Phase 6: methodology requires single metric with direction and sampling method
- `run` Phase 7: invokes experiment skill via Skill() instead of ad-hoc loop
- `experiment` skill: mandatory baseline survey (Step 1.5), single-metric validation, autoresearch design principle
- `literary-review` skill: all notebooklm calls rewritten to use scripts or correct `--key value` syntax
- `seminar` skill: notebooklm calls use `notebook-ask.sh` script
- `workshop` skill: added solo mode for PI direct queries, agent prompts use `notebook-ask.sh`
- `preflight.sh`: auto-discovers content types via drush, validates HTTP status, guards against running in main
- `generate-chart.py`: added `--direction up|down` flag for higher-is-better metrics
- `methodology-template.md`: requires single metric, direction, and sampling method section
- `iteration-protocol.md`: commit format changed from `experiment()` to `perf()` for conventional commits
- `researcher` agent: corrected CLI syntax guidance (`--key value` not `key=value`)
- `experimentalist` agent: commit format updated to `perf()`

### Added
- `scripts/notebook-ask.sh` — wrapper for `notebooklm ask` with correct CLI syntax
- `scripts/notebook-setup.sh` — create notebook, seed URLs, fire research in one step
- `scripts/log-iteration.sh` — append JSONL iteration record to results.jsonl

### Fixed
- `notebooklm-cli.md` reference: rewritten from actual `--help` output (was wrong about `key=value` syntax, `--query` flag, `--new` flag)
- All consumers of notebooklm-cli.md updated to match corrected syntax
- All consumers of iteration-protocol.md updated to use `perf()` commit type

## 0.1.0 (2026-03-15)

### Added
- Plugin scaffold with 5 skills: run, literary-review, workshop, seminar, experiment
- 3 agent definitions: principal-investigator (opus), researcher (sonnet), experimentalist (sonnet)
- Engagement directory protocol (`analysis-reports/research/<engagement>/`)
- NotebookLM CLI integration for literary review and workshop swarms
- Iterative experiment loop with JSONL logging, ratchet pattern, and futility stopping
- Seminar skill for cross-examination of curated knowledge
- Preflight script for Drupal cache audits
- Measurement harness template
- Research report template for lib:vault-store
- Chart generation script (ASCII from results.jsonl)
