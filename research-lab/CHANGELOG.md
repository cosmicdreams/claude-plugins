# research-lab Changelog

## 2.1.0 — Standalone hardening + script correctness

Made research-lab fully self-contained (it no longer depends on any other plugin to run its verbs)
and fixed the correctness bugs surfaced by a holistic review.

### Standalone — references only itself
- `principal-investigator` agent reframed from a fixed-phase orchestrator into an **optional**
  research-lead role that composes the verbs and *suggests* next steps. Dropped all `drupal-lab:optimize`
  coupling (phase-gates, `preflight.sh`, the optimize methodology template); methodology authoring now
  follows research-lab's own `experiment/references/methodology-spec.md`. (Vault archival defers to
  `lib:vault-store` — see below.)
- `generate-chart.py` moved **into** research-lab (`scripts/`) — it is a generic `results.jsonl`
  visualizer used by `experiment`; the report template and `drupal-lab:optimize` now read it here.
- `context-flow.md` reframed from a phase pipeline to an **optional composition convention**: numeric
  prefixes are sort hints (not an ordering contract), filename stems identify artifacts, and the
  `frame`/`understand` artifacts and a no-plugin vault path are documented. Removed `preflight.sh` /
  `lib:vault-store` from the producer map.
- `understand`/`synthesize` notebook `note save` is now best-effort (the vault copy is the source of
  truth); the `workflow`-plugin `obsidian-rules.md` read is explicitly optional.
- `gather` declares `Workflow` in `allowed-tools` (its facet fan-out requires it).
- `teach` wires the generated quiz into the Feynman gate's `args.quiz` and adds a no-notebook fallback
  so the gate runs across the verb's full input contract.

### NotebookLM correctness (verified against the installed v0.6.0 CLI)
- Rebuilt `gather/references/notebooklm-cli.md` from the real `--help` surface. It now documents the
  full set the verbs actually use — `configure` (`--mode`/`--persona`/`--response-length`), the `note`
  group, the entire `generate` family (report/slide-deck/revise-slide/audio/infographic/flashcards/
  quiz/data-table/mind-map), `research status`/`wait`, `share`, and `source clean` — not just the ~9
  commands it covered before.
- Fixed three wrong command forms in the verbs:
  - `understand`/`synthesize` persisted records with `notebooklm note save --content-file` — but
    `note save` *updates* an existing note by id and there is no `--content-file`. Now `note create`
    with content piped via `--content -`.
  - `teach` called top-level `notebooklm revise-slide` → `notebooklm generate revise-slide`.
  - `teach` published with `notebooklm share --public` → `notebooklm share public --enable`.
- Noted that `source clean` natively removes exact-duplicate/error/blocked sources; `notebook-dedup.sh`
  still adds the URL-variant collapse `source clean` doesn't do.

### Vault archival
- Vault writes now defer to `lib:vault-store` (it owns Obsidian placement and triggers in context)
  instead of hand-rolling `cp` + re-parsing the `workflow` plugin's `obsidian-rules.md`. Artifacts
  also remain in the engagement directory. NotebookLM `note create` co-locates a record with its
  sources when a notebook is in play.

### Script correctness
- `log-iteration.sh`: values passed via `argv` (no shell→Python source interpolation — quotes/`$`/
  backticks can't break or inject); `metric_before` now null-guarded so the baseline iteration logs.
- `notebook-setup.sh`: deep-research output to stderr (stdout = notebook id only); empty seed-URL loop
  guarded against `set -u` on macOS bash 3.2.
- `notebook-ask.sh`: degraded retry drops `--save-as-note`/`--note-title` so a junk answer isn't
  saved twice; usage doc corrected.
- `notebook-dedup.sh`: no longer iterates the dict itself on an unexpected envelope (was `AttributeError`).
- `measure.sh`: `curl` bounded with `--max-time`/`--connect-timeout`; failed pages skipped, not averaged.

## 2.0.0 — Knowledge-work verb reorganization

Rebuilt research-lab around the **verbs of a knowledge engagement** — one skill per distinct
cognitive move — instead of formats/mechanisms. See `plans/research-lab-knowledge-verbs.md`.

### Skills
- **NEW** `frame` — sharpen a vague topic into a falsifiable question (facilitator, Haiku).
- **NEW** `interrogate` — adversarial peer-review of a formed claim via a context-isolated,
  perspective-diverse Workflow panel; desk-reject preflight, loop-until-dry + budget ceiling.
  Returns a verdict, never revises.
- **NEW** `teach` — the Feynman gate: produce the deliverable artifact, then certify it with a
  fresh no-context agent taking a generated quiz.
- **RENAMED** `literary-review` → `gather` (librarian stance; back-compat trigger retained).
- **RESHAPED** `seminar` → `synthesize` (the hinge verb; absorbs artifact generation).
- **MOVED IN** `ideate:understand` → `understand` (input broadened — no longer requires a notebook).
- **DISSOLVED** `workshop` — its parallel mechanism is now a Workflow fan-out detail inside
  gather/interrogate, not a skill.
- **MOVED OUT** `run` → `drupal-lab:optimize` (it was a Drupal performance engagement).

### Structure
- Every verb opens with a uniform **preflight-first** block (Input contract → resolution order →
  fail-fast that suggests, never auto-chains). Enforced by improve lint rule `missing-preflight-contract`.
- Strictly compositional: **no orchestrator**. Verbs are invoked intentionally in conversation.
- Modern from birth: NotebookLM persona/artifact integration (configure, quiz, data-table, report,
  mind-map) and Workflow fan-out with per-verb model/shape.
- Kept agents (PI, researcher, experimentalist), `protocols/context-flow.md`, and the report
  template updated to the new verb set.

### Migration
- `research-lab:literary-review` → `research-lab:gather` (old trigger still works).
- `research-lab:seminar` → `research-lab:synthesize` (old trigger still works).
- `research-lab:workshop` → removed; use `gather` (broad coverage) / `interrogate` (parallel panel).
- `research-lab:run` → `drupal-lab:optimize` (old trigger still routes).
- `ideate:understand` → `research-lab:understand`; `ideate:research` → `research-lab:gather`.

## 0.3.2
- Cross-reference `lib:ddev` for DDEV naming convention in research-lab:run

## 0.3.1
- Add explicit tools declarations to all 3 agents (experimentalist, researcher, principal-investigator)
- `experimentalist`: fix bare reference paths to use `${CLAUDE_PLUGIN_ROOT}`
- `researcher`: add mode self-orientation fallback

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
