# Changelog

## 2.0.1
- Shrink all 7 skill descriptions to a routing-sufficient summary; the full trigger-phrase detail moves into each SKILL.md body under `## When to use`, where it loads on invocation instead of sitting in context every session.
- Saves roughly 1,158 characters (~289 est. tokens) of always-resident context.
- Descriptions keep the distinctive tool vocabulary and the "not for X, use Y" disambiguation, so routing between sibling skills is unchanged.

## 2.0.0 — 2026-06-10 — Fable-era rewrite (breaking)

**REWRITTEN** `agents/process-engineer` — observation model rewritten from loop-based polling to event-driven. The agent now subscribes to harness hooks (PostToolUseFailure, TaskCompleted, SubagentStop) as the primary signal source. On-demand transcript reads are a fallback, not the primary path. Polling-loop version-1 prose removed. All judgment capability (trust model, lint lifecycle, error recovery) preserved.

**ADDED** `skills/lint/references/rules/missed-proxy-opportunity.md` (lint-009, watch tier) — fires when `rtk discover` identifies Bash commands in plugin code that could be proxied for token savings. Detection requires `rtk` to be present; degrades silently when absent.

**UPDATED** `skills/lint/SKILL.md` — added propagation table with `rtk` and `headroom` columns noting where each tool applies across the plugin ecosystem.

**UPDATED** `skills/perf-measure/SKILL.md` — added `--tokens` measurement mode sourcing `rtk gain --history` and `headroom perf` as JSON score tuples. When either binary is present, token-spend metrics (`rtk_tokens_saved`, `rtk_savings_pct`, `headroom_tokens_compressed`, `headroom_compression_ratio`) are included in the output. Both integrations preflight with `command -v` and degrade silently. The experiment ratchet can now target token spend as a metric.

**TRIMMED** `skills/attach`, `skills/fix`, `skills/experiment`, `skills/self` — jobs and domain knowledge unchanged; process narration removed.

**Note:** This plugin is distributable via Claude Desktop Personal Plugins. Zip the plugin directory contents so `.claude-plugin/` is at the root; upload as `.zip`.

## 1.4.0
- Add lint rule `lint-008 missing-preflight-contract` (tier: warn, applies-to: research-lab) —
  enforces the research-lab 2.0 preflight-first convention: every verb SKILL.md must carry the
  uniform Input contract + Preflight block with a fail-fast branch that suggests (never
  auto-invokes) the upstream verb.

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
