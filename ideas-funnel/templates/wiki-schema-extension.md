# ideas-funnel v2 extension

This block is appended to the vault's existing `wiki-schema.md` on `init`. Review and reconcile with existing rules. Remove anything that conflicts with your established conventions — the extension is additive, not authoritative.

## Active Domains

Domains are declared in `~/.config/ideas-funnel/domains/*.yaml`. Each has its own folder under `Domains/<Label>/` and its own raw inbox under `Raw/Inbox/<slug>/`.

Current active domains (auto-synced by the orchestrator on each run):

- **AI-Workflows** → `Domains/AI-Workflows/_landing.md` — raw: `Raw/Inbox/ai-workflows/`

## Directory Rule Update — Shared Layer Write Protocol

Going forward:

- `Concepts/`, `Entities/`, `Sources/`, `Bridges/`, `Conflicts/` are **Refinery-write-only**. Domain ingest-agents may READ these but must NOT WRITE. This prevents concurrent-write conflicts when multiple domain agents discover the same concept.
- Existing pages in `Concepts/` / `Entities/` / `Sources/` are preserved as-is. Their frontmatter migrates to the extended schema incrementally via `lint` — no big-bang migration.
- `Raw/Inbox/<domain>/` is the new feed-driven intake. Daily notes continue to land at `Raw/YYYY-MM-DD.md` (root of `Raw/`).

## Operation Loops (plugin-hosted)

The `ideas-funnel` plugin provides these skills. Invoke via `/ideas-funnel:<name>`.

| Skill | Invoked by | Purpose |
|---|---|---|
| `init` | human (one-time) | Bootstrap: create config dir, copy templates, print next-steps |
| `ingest` | `ideas-funnel:ingest` agent | Process `Raw/Inbox/<domain>/` + `Raw/<date>.md` into Sources/Concepts/Entities |
| `lint` | `ideas-funnel:lint` agent + human | Orphans, schema compliance, stale flags, timeline sidecar migration |
| `query` | human | Scan index → synthesize with citations → file back if novel |
| `funnel-export` | `ideas-funnel:scorer` + human | Export ready cards to `Raw/` for ingest |
| `rescue` | nightly + human | Orphan rescue + unlinked-mention auto-link |
| `emerge` | nightly + human | Surface unnamed patterns in last 30 days |
| `challenge` | human | Red-team a specific page |
| `connect` | human | Draft bridge between two domains |
| `decay-audit` | human (weekly) | Confidence report, at_risk enumeration |

## Frontmatter Extension

The canonical frontmatter for every wiki page is now:

```yaml
---
# Existing (preserved)
type: concept | entity | source | synthesis | bridge | conflict | landing
tags: []
status: active | watching | archived     # legacy — may be dropped once `state` adopted

# v2 additions
domain: [ai-workflows]                    # multi-value; at least one domain slug
title: "…"                                 # page title for index.md
summary: "1–2 sentence overview"           # for tiered retrieval

provenance:
  origin: extracted | ai-generated | inferred | ambiguous | conflicting | human-written
  source_ids: []
  created_at: YYYY-MM-DD
  created_by: agent-id | human

timeline:                                  # bi-temporal, append-only
  - event_at: YYYY-MM-DD
    learned_at: YYYY-MM-DD
    claim: "one-line fact"
    agent: ingest@<domain>
timeline_truncated: false                  # true when moved to Sources/<slug>.timeline.md

confidence: 1.0                            # float 0.0–1.0
confirmation_count: 0
decay_class: fast | standard | slow | frozen
last_confirmed: YYYY-MM-DD
last_touched: YYYY-MM-DD

state: fresh | stable | at_risk | archived
superseded_by: null
hardened: false                            # confidence ≥0.85 AND confirmation_count ≥10 → pauses decay

backlink_density: 0                        # lint-maintained
bridge_score: null                         # refinery/health-maintained
tension_score: 0.0                         # ≥0.8 auto-creates conflict page
---
```

Legacy frontmatter (existing pages) is tolerated. Lint adds missing fields on first touch.

## Tag Vocabulary

See `_meta/taxonomy.md`. Never invent tags without adding to taxonomy — lint flags them.

## Conflict Protocol

1. Contradiction detected during ingest → refinery computes tension score.
2. `tension < 0.3` — both facts coexist; weaker gets inline `^conflict` marker.
3. `0.3–0.8` — weaker fact's confidence drops by 0.20; tension recorded in frontmatter.
4. `tension ≥ 0.8` — auto-create `Conflicts/<date>-<slug>.md` + `_meta/conflicts.md` entry; human resolves.
5. Human resolution: remove from `_meta/conflicts.md`, update both pages' frontmatter, optionally write `superseded_by` link.

## Log Prefixes

One of these per `log.md` line:

`ingest | query | lint | emerge | decay | conflict | bridge | export | health | rescue`

## State Machine (Memory Evolution)

```
fresh ──(conf ≥0.7)──► stable
fresh ──(conf <0.4)──► at_risk
stable ──(decay drops conf <0.7)──► fresh
stable ──(conf <0.4)──► at_risk
at_risk ──(human review + reset)──► fresh
at_risk ──(30d no action)──► archived
any ──(newer page replaces)──► archived + superseded_by: <link>
```

`hardened: true` pauses decay until contradiction.

## Decay Classes

| Class | Half-life | Domain defaults |
|---|---|---|
| `fast` | 7d | ai-workflows, drupal-news |
| `standard` | 30d | oss-ai-tools |
| `slow` | 180d | drupal-dev |
| `frozen` | ∞ (until contradiction) | `hardened: true` pages |

Cross-domain pages inherit the **slowest** class of constituent domains.
