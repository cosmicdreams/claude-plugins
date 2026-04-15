# Changelog

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
