# Changelog

## 2.1.0 — 2026-07-09

### Added

- `skills/supervise/SKILL.md` — Fable-owned loop supervisor for backlog health,
  unknown discovery, run caps, priorities, and worker routing.
- `skills/delegate/SKILL.md` — cost-aware routing policy: Fable for strategy,
  GPT-5.5-style workers for expensive extraction/clustering, cheap/local workers
  or shell for mechanical work.
- `skills/decay/SKILL.md` — valid memory state-machine updates.
- `skills/stats/SKILL.md` — `_meta/stats.md` writer for health/backlog/model
  routing telemetry.
- `skills/rescue/SKILL.md` — stale raw, orphan, and at-risk recovery loop.
- `skills/funnel-export/SKILL.md` — capped Beads-to-Raw export guidance.

### Changed

- Workflow now starts with Fable supervision, applies per-domain backpressure,
  delegates bounded worker ingest, and runs lint/decay/rescue/stats every run.
- Removed invalid scorer instructions that used `state: stale` and
  `state: hardened`; `hardened` is now handled only as a boolean flag.
- `query` no longer writes directly to shared `Concepts/`; it drafts domain
  synthesis or a Refinery promotion request.
- README and templates now describe the v2 singleton Workflow instead of the
  retired Monitor/orchestrator path.

## 2.0.0 — 2026-06-10

**Breaking change — singleton pipeline.** The per-instance scheduling model is replaced
by a single cron entry. Any old per-instance cron loops created by 0.x must be manually
removed: `CronDelete <id>` for each entry, then delete
`$VAULT/_meta/ideas-funnel-scheduler.json` if present, then run `ideas-funnel:schedule`
once to re-register under the new singleton discipline.

### Removed

- `orchestrator` agent — replaced by the pipeline Workflow script.
- Lock-file protocol (`Raw/.lock`) — replaced by vault marker at `_meta/ideas-funnel-scheduler.json`.
- Backlog queue and signal-parsing machinery.
- `monitors/` directory and `monitors.json` registration — no longer needed; the cron replaces the Monitor-driven loop.
- Per-instance scheduling code in the init skill.

### Added

- `skills/schedule/SKILL.md` — idempotent singleton cron registration with vault marker for cross-instance de-duplication.
- `skills/schedule/scripts/funnel-pipeline.js` — Workflow script: `parallel()` per-domain ingest → threshold check → conditional refinery → conditional monthly scorer.

### Changed

- `skills/init/SKILL.md` — Step 6 now calls `ideas-funnel:schedule` to register the singleton cron.
- `agents/ingest.md` — trimmed to a lean agentType target (≤40 lines); orchestration prose removed.
- `agents/refinery.md` — trimmed to a lean agentType target (≤60 lines); orchestration prose removed.
- `skills/ingest/SKILL.md` — removed orchestrator-specific procedure; added headroom compression note for large articles (optional, degrades silently when absent).
- Plugin version bumped to 2.0.0.

### Kept verbatim

- Ingest page-breaking logic and full v2 frontmatter schema.
- Domain-scoped write discipline (ingest → Domains/, Refinery → Concepts/).
- Concept density threshold logic (≥3 unrelated sources triggers refinery).
- Contradiction detection and tension scoring in refinery.
- Bridge page creation logic in refinery.
- `skills/lint/SKILL.md` — all nine steps, all schema checks, all severity definitions.
- `skills/query/SKILL.md` — tiered retrieval, file-back offer, log entry.
- Vault bootstrap in `skills/init/SKILL.md` (Steps 1–5 unchanged).
- All templates.

### Desktop Personal Plugins compatibility

Distributable as a zip: compress the plugin directory so `.claude-plugin/` is at the
archive root, then upload the `.zip` file.

## 0.2.2 — 2026-04-15

Fix: `rss-ingest.sh` used jq's `// empty` idiom inside mikefarah yq v4 expressions, which errored with `lexer: invalid input text "empty"` and aborted the first poll. The trailing `[]?` already produces no output when a key is absent, so `// empty` was redundant — removed.

## 0.2.1 — 2026-04-15

Fix: `monitors/monitors.json` was wrapped in a `{"monitors": [...]}` object; the harness expects a raw array (see drover). The umbrella monitor was silently skipped at load time. Reformatted to a bare array.

## 0.2.0 — 2026-04-14

Phase 2 — AI-Workflows vertical slice. First runtime; manual-invocation testable.

Agents:
- `orchestrator` (sonnet) — per-signal fan-out; ephemeral; lock + backlog
- `ingest` (haiku) — domain-scoped raw → domain-scoped wiki pages; emits concept-density signals
- `refinery` (sonnet) — single writer for shared `Concepts/`, `Entities/`, `Bridges/`, `Conflicts/`; tension-based contradiction handling

Skills:
- `init` — idempotent bootstrap (config dir, vault scaffold, schema extension append)
- `ingest` — ported from vault's existing ingest skill; extended with multi-domain dispatch, manifest delta-tracking, v2 frontmatter, concept-density signal emission
- `lint` — ported from vault's vault-lint; extended with v2 frontmatter validation, timeline sidecar migration, taxonomy enforcement
- `query` — synthesize + cite + file-back

Scripts:
- `scripts/monitors/umbrella-ideas.sh` — registered in `monitors.json`; multiplexes producers + heartbeats
- `scripts/monitors/rss-ingest.sh` — polls RSS + JSON APIs per active domain; dedupes via seen-URL cache; emits `batch_complete` signals
- `scripts/monitors/nightly-sweep.sh` — system-cron maintenance stub (phase 2: writes `.lint-requested` marker)

Other:
- `monitors/monitors.json` — plugin monitor registration
- `monitors/README.md` — full signal catalog

## 0.1.0 — 2026-04-14

Initial scaffold. Plugin manifest, README, ONBOARDING, templates.
