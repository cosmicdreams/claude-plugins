# ideas-funnel — Onboarding

Operational reference. If you're deciding whether to use the plugin, start with [README.md](./README.md) instead. This file catalogs every moving part so you can operate it.

This document stays authoritative through all build phases. If the code and this doc disagree, the doc is wrong — open an issue.

---

## Agents

Agents are in `agents/*.md`. Each is ephemeral: spawned per firing, exits on completion. No resident agents between firings.

### orchestrator (sonnet) — Phase 2+
**Purpose:** per-signal fan-out. Reads the Monitor signal line, creates an ephemeral team, spawns the right domain-ingest / refinery / scorer agents, collects their results, deletes the team, exits.
**Triggers:** every line emitted by `umbrella-ideas.sh` that matches a known signal prefix.
**Reads:** `~/.config/ideas-funnel/domains/*.yaml`, `Raw/Inbox/<domain>/`, `Raw/.manifest.json`, signal payload.
**Writes:** nothing directly — only delegates. Writes `~/.claude/ideas-funnel.events.jsonl` for instrumentation.
**Never does:** ingest content itself, write wiki pages, score Beads cards.

### ingest (haiku) — Phase 2+
**Purpose:** process a single domain's raw inbox slice into domain-scoped wiki pages.
**Triggers:** spawned by orchestrator per `batch_complete` or `manual-ingest` signal.
**Reads:** `Raw/Inbox/<domain>/`, `Domains/<Label>/_landing.md`, `Concepts/`, `Entities/` (read-only — never writes here).
**Writes:** `Domains/<Label>/*.md`, `Sources/<slug>.md`, `Raw/.manifest.json`, `log.md`, `index.md`. Emits `wiki/concept-density-threshold` signal when a concept crosses the ≥3-unrelated-sources bar.
**Never does:** write to shared `Concepts/`/`Entities/`/`Bridges/`/`Conflicts/`. Never scores. Never decays. Never spawns other agents.

### refinery (sonnet) — Phase 2+
**Purpose:** the single writer for all shared wiki layers. Handles concept consolidation, bridge-page generation, and conflict-page creation. Name comes from Gas Town's merge-queue pattern — serializes writes so parallel ingest-agents don't decohere.
**Triggers:** spawned by orchestrator on `concept-density-threshold` (Phase 2) or `bridge-threshold-crossed` (Phase 3) signals.
**Reads:** candidate concept + all backlinking Sources + existing Concepts/Entities/Bridges pages, `_meta/conflicts.md`, `_meta/taxonomy.md`.
**Writes:** `Concepts/*.md`, `Entities/*.md`, `Bridges/*.md`, `Conflicts/*.md`, `_meta/conflicts.md`, `log.md`, `index.md`.
**Never does:** ingest raw sources, score Beads cards, modify `Domains/<Label>/` content, spawn other agents.

### scorer (haiku) — Phase 3+
**Purpose:** three-lens rubric (pragmatist / trends / builder) over stable pages; promote to `lane-ready` when the score formula qualifies; trigger `funnel-export` at ready-cap.
**Triggers:** spawned by orchestrator when `lane-scored` is stale (>24h since last score pass) after a batch.
**Reads:** Beads cards in `lane-consolidating` / `lane-scored` / `lane-ready`, wiki page frontmatter (confidence, backlink_density, bridge_score).
**Writes:** Beads card metadata (`score`, `scored_at`, lane labels). No wiki page writes.
**Never does:** run while `ideas-funnel.lock` is held. Never fetches external URLs. Never modifies card descriptions (only metadata + notes).

### decay (haiku) — Phase 4+
**Purpose:** nightly confidence math + state transitions + orphan rules.
**Triggers:** nightly-sweep.sh cron (system cron — the accepted maintenance residue).
**Reads:** all wiki page frontmatter, backlink density, last_touched.
**Writes:** page frontmatter (`confidence`, `state`, `last_touched`), `_meta/stats.md`, `log.md`. Emits `wiki/trust-decay` signal when a page drops below confidence threshold.
**Never does:** delete pages. Never skip hardened pages (`hardened: true` pauses decay until contradiction).

### lint (haiku) — Phase 4+
**Purpose:** orphan rescue + broken links + taxonomy enforcement + stale flags + timeline sidecar migration (when a page's `timeline:` exceeds 10 entries).
**Triggers:** nightly-sweep.sh cron + manual `/ideas-funnel:lint` invocation.
**Reads:** all wiki pages, `_meta/taxonomy.md`.
**Writes:** page frontmatter (`backlink_density`, `^stale` flag), `_meta/conflicts.md` (taxonomy violations), `Sources/<slug>.timeline.md` (when truncating), `log.md`.
**Never does:** create new content pages. Never delete pages (at_risk aging happens in `decay`).

### emerge (sonnet) — Phase 4+
**Purpose:** surface unnamed patterns across a 30-day delta. Drafts synthesis pages for terms that appear repeatedly without a Concept page.
**Triggers:** nightly-sweep.sh cron + manual `/ideas-funnel:emerge`.
**Reads:** last 30 days of `Raw/` + recent `Sources/`, `index.md`.
**Writes:** draft Concept stubs in `Concepts/` with `state: fresh` and `provenance: ai-generated`. Lands in `lane-consolidating`, not `lane-ready`.
**Never does:** mark generated pages as `stable`. Never auto-promote to human review.

### health (haiku) — Phase 6 (deferred)
**Purpose:** weekly `vault_health.py` wrapper; betweenness analysis; bridge-score cache refresh.
**Triggers:** weekly cron.
**Writes:** page frontmatter (`bridge_score`, `component`), `_meta/stats.md`.

---

## Skills

Skills are in `skills/<name>/SKILL.md`. Each opens with a one-line "used by" header indicating which agent or human invokes it.

| Skill | Used by | What it does |
|---|---|---|
| `init` | human (one-time) | Bootstrap: create `~/.config/ideas-funnel/domains/`, copy templates to vault, print next-steps checklist. |
| `ingest` | ingest agent | The ingest operation loop (Karpathy pattern): read raw, extract entities/concepts/claims, merge into existing pages or create new, update index/log/manifest. |
| `query` | human | Scan `index.md` → open relevant pages → synthesize answer with `[[wikilink]]` citations → file back as new page if novel. |
| `lint` | lint agent + human | Orphans, broken wikilinks, missing frontmatter, stale flags, timeline sidecar migration. |
| `emerge` | emerge agent + human | 30-day pattern surfacing. |
| `challenge` | human | Red-team a specific page: counterarguments, missing evidence, tension update. |
| `connect` | human | Draft a bridge page between two specified domains. |
| `rescue` | human + nightly | Orphan rescue + unlinked-mention auto-linker. |
| `decay-audit` | human (weekly) | Confidence report, at_risk enumeration, recently decayed sources. |
| `funnel-export` | scorer (auto at ready-cap) + human | Export oldest Ready cards to vault Ready/ folder for downstream processing. |

---

## Scripts

Scripts are in `scripts/monitors/`. They run as background processes managed by the Claude Code plugin monitor registry.

| Script | Emits signals | Purpose |
|---|---|---|
| `umbrella-ideas.sh` | all (multiplexer) | Runs the other producers in a loop, relays their stdout, emits `heartbeat` every 10 minutes for liveness. Registered in `monitors.json`. |
| `rss-ingest.sh` | `Raw/Inbox/<domain>/batch_complete`, `Raw/Inbox/<domain>/error` | Iterates active domains from `~/.config/ideas-funnel/domains/*.yaml`, fetches RSS + API feeds, dedupes via `Raw/.manifest.json`, writes items to `Raw/Inbox/<domain>/`, emits batch-complete signal per domain. |
| `webhook-listener.sh` (Phase 3+) | `user/manual-ingest` | Optional HTTP listener for manual drops. |
| `nightly-sweep.sh` | none (runs agents directly) | System-cron-scheduled. Phase 2: runs `lint` only. Phase 4: runs decay → lint → emerge → rescue. |

---

## Monitor signals

Every signal is a single stdout line from `umbrella-ideas.sh`. Space-delimited, first token is the signal prefix.

| Signal | Payload | Emitter | Example | Consumer |
|---|---|---|---|---|
| `Raw/Inbox/<domain>/batch_complete` | `<domain> <count> <batch_id>` | rss-ingest.sh | `Raw/Inbox/ai-workflows/batch_complete ai-workflows 12 2026-04-14T06:00:00Z` | orchestrator → ingest agent |
| `wiki/concept-density-threshold` | `<concept> <sources_count>` | ingest agent post-write | `wiki/concept-density-threshold mcp-tool-calling 4` | orchestrator → refinery |
| `wiki/bridge-threshold-crossed` (Phase 3+) | `<concept> <domain_count>` | refinery post-write | `wiki/bridge-threshold-crossed wasm-runtime 2` | orchestrator → refinery (bridge generation) |
| `wiki/trust-decay` (Phase 4+) | `<page> <new_confidence>` | decay agent | `wiki/trust-decay Concepts/mcp-intro.md 0.32` | orchestrator → alerts only |
| `user/manual-ingest` (Phase 3+) | `<path> <domain>` | webhook / CLI helper | `user/manual-ingest Raw/Inbox/drupal-dev/drop.pdf drupal-dev` | orchestrator → ingest agent |
| `Raw/Inbox/<domain>/error` | `<domain> <error_msg>` | rss-ingest.sh | `Raw/Inbox/ai-workflows/error ai-workflows timeout` | orchestrator logs; no further action |
| `heartbeat` | `<ISO8601 timestamp>` | umbrella-ideas.sh | `heartbeat 2026-04-14T06:00:00Z` | morning-brief skill (alerts if >30m gap) |

### Backpressure

- `~/.claude/ideas-funnel.lock` — 5-minute TTL. Orchestrator won't start while another is running; queues to backlog.
- `~/.claude/ideas-funnel.backlog.jsonl` — FIFO queue. Exiting orchestrator drains before fully releasing the lock.
- `~/.claude/ideas-funnel.events.jsonl` — every signal logged with timestamp, payload, orchestrator duration, subagents spawned, outcome.

---

## Lanes (Beads)

The Beads board at the vault root carries these lanes. Agents move cards between them; humans live primarily in `lane-ready` and `lane-review`.

| Lane | Frontmatter state | Who writes | Purpose |
|---|---|---|---|
| `lane-inbox` | `fresh` | ingest | Newly ingested source cards; needs triage |
| `lane-consolidating` | `fresh` | ingest, refinery, emerge | In-flight processing; synthesis drafts |
| `lane-scored` | `stable` | scorer | Scored but below ready threshold |
| `lane-ready` | `stable` + surfaced | scorer | **Human review queue** — new high-signal content |
| `lane-review` (Phase 4+) | `stable` + FSRS/at-risk resurface | decay, lint | **Resurfaced** items — separate from Ready so reviews don't crowd new content |
| `lane-at-risk` (Phase 4+) | `at_risk` | decay | 30-day human rescue window before archive |
| `lane-archived` (Phase 4+) | `archived` / superseded | decay | Retired; `superseded_by` link preserved |

### State transitions

```
fresh ──(conf ≥0.7)──► stable
fresh ──(conf <0.4)──► at_risk
stable ──(decay drops conf <0.7)──► fresh
stable ──(conf <0.4)──► at_risk
at_risk ──(human review + reset)──► fresh
at_risk ──(30d no action)──► archived
any ──(newer page replaces)──► archived + superseded_by: <link>
```

`hardened: true` is a flag (not a state) — confidence ≥0.85 AND confirmation_count ≥10. Pauses decay until a contradiction lands.

---

## File headers

Every agent and skill file opens with a minimal operating header so a cold reader can orient in seconds.

**Agent files (`agents/<role>.md`):**
```
---
name: <role>
description: <one sentence>
model: haiku | sonnet
---

**Purpose:** one line.
**Triggers:** one line — exactly what spawns this agent.
**Never does:** one line — behaviors this agent is prohibited from.

# <role>
...
```

**Skill files (`skills/<name>/SKILL.md`):**
```
---
name: ideas-funnel:<name>
description: <one sentence>
---

**Used by:** <agent name or "human"> — <when>.

# <skill name>
...
```

---

## What lives where (reminder)

The plugin owns: all agents, all skills, all scripts, `monitors.json`, templates.
The vault owns: `wiki-schema.md`, `AGENTS.md`, `CRITICAL_FACTS.md`, `_meta/*`, all knowledge (`Raw/`, `Domains/`, `Concepts/`, etc.), `index.md`, `log.md`.
User config owns: `~/.config/ideas-funnel/domains/*.yaml`.
Runtime state lives in: `~/.claude/ideas-funnel.{lock,backlog.jsonl,events.jsonl}`.
