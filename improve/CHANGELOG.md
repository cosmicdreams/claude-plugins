# Changelog

## 1.3.0
- Add `perf-measure` skill — Lighthouse + hyperfine + a11y delegation; JSON score tuple for experiment ratchet
- Add `accessibility-scan` (moved from `admin`) — measurement skills consolidated into improve
- Add `optimizer` agent — autonomous hypothesis-driven optimization loop for any measurable target

## 1.2.0
- Process-engineer: add Path 2 observation (proactive transcript sampling for silent degradation)
- New lint rule lint-007: self-reporting-silence (watch) — flags agents completing 3+ tasks with zero friction reports

## 1.1.0
- Process-engineer: add Skill tool, observation model (loop-based polling + direct agent help protocol), mode orientation, vault/lint-path knowledge
- 4 rounds of self-improvement applied to own definition
- New lint rules: missing-tools-declaration (auto-fix), unnecessary-confirmation (watch), stale-plugin-list (warn)

## [1.0.0] - 2026-03-20

### Added
- `process-engineer` agent — lean methodology-driven agent with trust model and lint rule lifecycle
- `improve:attach` skill — map process topology (agents, skills, hooks, crons, config)
- `improve:fix` skill — make directed changes with propagation awareness and verification
- `improve:lint` skill — process pattern checking with tiered rule system (auto-fix / warn / watch)
- `improve:experiment` skill — ratchet-based uncertain improvements (measure, change, compare, keep/revert)
- `improve:self` skill — evaluate and improve any agent definition against its purpose
- Seed lint rules: excessive-retries, stale-tool-reference, model-tier-mismatch
