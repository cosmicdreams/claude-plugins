# ideas-funnel

A passive knowledge capture pipeline. Feeds (RSS, APIs, manual drops) land in your Obsidian vault's `Raw/` directory. A singleton daily Workflow uses Fable as the supervisor and cheaper workers for bounded extraction, then compiles selected material into a cross-linked wiki. Memory evolves — knowledge is confirmed, contradicted, decayed, rescued, or resurfaced. You only see the high-signal items that earn your attention.

Derived from Andrej Karpathy's LLM Wiki pattern, extended with multi-domain attention, cost-aware model routing, Fable supervision, and a graph-aware consolidation layer.

## What it does

- **Supervises** — Fable reads backlog, stats, conflicts, and recent notes; it chooses bounded work and unknowns to pursue.
- **Delegates** — GPT-5.5-style workers do expensive extraction/clustering; cheap/local workers or shell do filtering and bookkeeping.
- **Ingests** — workers process only selected high-value items from `Raw/Inbox/<domain>/` and daily notes.
- **Compiles** — agents read raw items and produce durable Markdown pages in the vault: domain landing pages, Concept pages, Entity pages, Source pages.
- **Consolidates** — when a concept appears in ≥3 unrelated sources, a synthesis page is generated. Cross-domain concepts produce Bridge pages.
- **Remembers** — every claim carries provenance + bi-temporal timeline + confidence. Unused facts decay. Contradicted facts fork into Conflict pages.
- **Measures** — `_meta/stats.md` records backlog, model routing, state counts, and health for the next Fable run.
- **Surfaces** — high-signal items land in Beads lanes (Ready for new content, Review for resurfaced). You decide what graduates.

## Quickstart

```bash
# 1. Install the plugin
# (use your standard plugin install flow)

# 2. Initialize — copies templates to your vault, creates config dir
# From Claude Code in the vault:
/ideas-funnel:init

# 3. Edit:
#   ~/Vaults/<vault>/CRITICAL_FACTS.md           — operator identity
#   ~/Vaults/<vault>/_meta/taxonomy.md           — starting tag vocabulary
#   ~/.config/ideas-funnel/domains/ai-workflows.yaml  — feeds, keywords

# 4. Drop a few bootstrap articles into Raw/Inbox/<domain>/
#    (manual pre-seed — see domain.yaml bootstrap_seeds)

# 5. The singleton Workflow is registered by /ideas-funnel:schedule.
#    It runs Fable supervision, bounded ingest, Refinery, lint, decay, rescue, stats.
```

## Seven core concepts

1. **Domain** — a pluggable attention slice (AI workflows, Drupal dev, Drupal news, OSS AI tools, ad-hoc). Declared in one YAML file. Each domain has its own feeds, keywords, landing page, decay class, and Beads scorer weights.
2. **`Raw/`** — immutable drop zone. LLM reads, never writes. `Raw/Inbox/<domain>/` is the scheduled worker intake.
3. **Wiki layers** — compiled output: `Domains/<Label>/` (domain-owned), `Concepts/` / `Entities/` / `Sources/` / `Bridges/` (vault-shared, Refinery-owned), `Conflicts/` (auto-generated).
4. **Fable supervisor** — one strategic pass chooses priorities, caps, unknowns, and worker routing.
5. **Refinery** — the single agent allowed to write shared layers. Prevents concurrent-write conflicts when multiple domain ingest-agents discover the same concept.
6. **Backpressure** — scheduled runs process top-N valuable items instead of trying to clear all raw/card backlog.
7. **Decay** — pages have `confidence` (0–1) + `decay_class` (fast/standard/slow/frozen). Unused facts lose confidence over time. Below 0.4 → `at_risk` → 30-day human review window → `archived`.

See **ONBOARDING.md** for the role catalog (every agent, skill, script, signal, lane).

## What lives where

| Thing | Location |
|---|---|
| Agent definitions, skills, Workflow script, templates | This plugin |
| `wiki-schema.md`, `AGENTS.md`, `CRITICAL_FACTS.md` | Vault root (copied from templates at init; user-owned) |
| `_meta/taxonomy.md` | Vault (user-owned vocabulary) |
| `_meta/conflicts.md`, `_meta/stats.md` | Vault (runtime state, agent-owned) |
| `Raw/`, `Domains/`, `Concepts/`, `Entities/`, `Sources/`, `Bridges/`, `Conflicts/` | Vault (knowledge) |
| Domain configs (`<slug>.yaml`) | `~/.config/ideas-funnel/domains/` |
| Scheduler marker | `_meta/ideas-funnel-scheduler.json` |
| Stats / conflicts | `_meta/stats.md`, `_meta/conflicts.md` |

## Status

**v2.1.0 — Fable-supervised singleton Workflow.**

| Phase | What lands | Status |
|---|---|---|
| 1 | Scaffold + templates + docs | Shipped |
| 2 | Singleton Workflow runtime | Shipped |
| 3 | Fable supervision + worker delegation + backpressure | **Current** |
| 4 | Beads scoring/export polish | Next |
| 5 | FSRS, auto-archival, health.py, ops dashboard | Deferred |

## Limitations (known, by design)

- Confidence arithmetic (+0.05/−0.20 deltas) is tunable, not axiomatic. Authors of similar systems admit the math is "a functional hack." Instrumented from day one; tune after 30 days of real data.
- Fully autonomous curation is explicitly not a goal. The Ready lane remains human-in-the-loop. LLM laziness is real; Ready lane friction is a feature.
- GPT-5.5 worker routing is a policy contract. Actual provider/model availability depends on the host Claude Code environment and installed adapters.

## Credits

- Andrej Karpathy — LLM Wiki gist (canonical pattern)
- obsidian-second-brain, obsidian-wiki, Cortex, forrestchang-andrej-karpathy-skills — fork ecosystem
- Andy Matuschak — evergreen notes
- Maggie Appleton — digital gardens, epistemic disclosure
- Tiago Forte, Nick Milo — BASB, LYT
- Steph Ango (Kepano) — file-over-app, compilation spaces
- drover plugin (this same author) — Workflow pattern reference implementation
