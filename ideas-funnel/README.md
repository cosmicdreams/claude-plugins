# ideas-funnel

A passive knowledge capture pipeline. Feeds (RSS, APIs, manual drops) land in your Obsidian vault's `Raw/` directory. Monitor-driven agents compile them into a cross-linked wiki. Memory evolves — knowledge is confirmed, contradicted, decayed, or resurfaced. You only see the high-signal items that earn your attention.

Derived from Andrej Karpathy's LLM Wiki pattern, extended with multi-domain attention, event-driven orchestration via Claude Code's Monitor tool, and a graph-aware consolidation layer.

## What it does

- **Ingests** — background scripts poll feeds and drop items into `Raw/Inbox/<domain>/`. No cron polling from the agent side; Monitor wakes the orchestrator only when content arrives.
- **Compiles** — agents read raw items and produce durable Markdown pages in the vault: domain landing pages, Concept pages, Entity pages, Source pages.
- **Consolidates** — when a concept appears in ≥3 unrelated sources, a synthesis page is generated. Cross-domain concepts produce Bridge pages.
- **Remembers** — every claim carries provenance + bi-temporal timeline + confidence. Unused facts decay. Contradicted facts fork into Conflict pages.
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

# 5. Monitor is registered automatically on plugin install.
#    umbrella-ideas.sh runs in the background; agents wake on content arrival.
```

## Seven core concepts

1. **Domain** — a pluggable attention slice (AI workflows, Drupal dev, Drupal news, OSS AI tools, ad-hoc). Declared in one YAML file. Each domain has its own feeds, keywords, landing page, decay class, and Beads scorer weights.
2. **`Raw/`** — immutable drop zone. LLM reads, never writes. `Raw/Inbox/<domain>/` is the Monitor trigger target.
3. **Wiki layers** — compiled output: `Domains/<Label>/` (domain-owned), `Concepts/` / `Entities/` / `Sources/` / `Bridges/` (vault-shared, Refinery-owned), `Conflicts/` (auto-generated).
4. **Monitor signals** — `umbrella-ideas.sh` emits typed stdout lines; Monitor wakes the orchestrator per signal. No polling.
5. **Refinery** — the single agent allowed to write shared layers. Prevents concurrent-write conflicts when multiple domain ingest-agents discover the same concept.
6. **Lanes** — Beads board carries `lane-inbox` / `lane-consolidating` / `lane-scored` / `lane-ready` / `lane-review` / `lane-at-risk` / `lane-archived`. Automation ends at `lane-scored`; the rest is your call.
7. **Decay** — pages have `confidence` (0–1) + `decay_class` (fast/standard/slow/frozen). Unused facts lose confidence over time. Below 0.4 → `at_risk` → 30-day human review window → `archived`.

See **ONBOARDING.md** for the role catalog (every agent, skill, script, signal, lane).

## What lives where

| Thing | Location |
|---|---|
| Agent definitions, skills, scripts, Monitor registration, templates | This plugin |
| `wiki-schema.md`, `AGENTS.md`, `CRITICAL_FACTS.md` | Vault root (copied from templates at init; user-owned) |
| `_meta/taxonomy.md` | Vault (user-owned vocabulary) |
| `_meta/conflicts.md`, `_meta/stats.md` | Vault (runtime state, agent-owned) |
| `Raw/`, `Domains/`, `Concepts/`, `Entities/`, `Sources/`, `Bridges/`, `Conflicts/` | Vault (knowledge) |
| Domain configs (`<slug>.yaml`) | `~/.config/ideas-funnel/domains/` |
| Lock, backlog, events log | `~/.claude/ideas-funnel.{lock,backlog.jsonl,events.jsonl}` |

## Status

**v0.1.0 — Phase 1 scaffold.** No runtime yet. Plugin is docs + templates only.

Build plan: `analysis-reports/research/ideas-funnel-v2/06-build-plan.md` in the vault.

| Phase | What lands | Status |
|---|---|---|
| 1 | Scaffold + templates + docs | **In progress** |
| 2 | AI-Workflows vertical slice (first runtime) | Pending |
| 3 | Multi-domain fan-out + scorer + Beads re-integration | Pending |
| 4 | Memory evolution (4-state, confidence, tension, resurfacing) | Pending |
| 5 | Instrumentation + v1 retirement + bump to 1.0 | Pending |
| 6 | FSRS, auto-archival, health.py, ops dashboard | Deferred |

## Limitations (known, by design)

- Monitor-driven orchestrator-spawn pattern is new territory. Drover uses it; broader ecosystem precedent is thin. Expect to discover edge cases during Phase 2's 7-day observation window.
- Confidence arithmetic (+0.05/−0.20 deltas) is tunable, not axiomatic. Authors of similar systems admit the math is "a functional hack." Instrumented from day one; tune after 30 days of real data.
- Fully autonomous curation is explicitly not a goal. The Ready lane remains human-in-the-loop. LLM laziness is real; Ready lane friction is a feature.

## Credits

- Andrej Karpathy — LLM Wiki gist (canonical pattern)
- obsidian-second-brain, obsidian-wiki, Cortex, forrestchang-andrej-karpathy-skills — fork ecosystem
- Andy Matuschak — evergreen notes
- Maggie Appleton — digital gardens, epistemic disclosure
- Tiago Forte, Nick Milo — BASB, LYT
- Steph Ango (Kepano) — file-over-app, compilation spaces
- drover plugin (this same author) — Monitor pattern reference implementation
