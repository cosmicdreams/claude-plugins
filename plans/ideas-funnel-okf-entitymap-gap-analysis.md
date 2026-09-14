# Ideas Funnel OKF and EntityMap Gap Analysis

Date: 2026-06-26
Branch: `feature/entitymaps-okf-idea-funnel`
Issue: `gap-0g7`

## Decision Context

The current ideas-funnel design is an Obsidian-first knowledge pipeline: raw inputs land in
`Raw/Inbox/<domain>/`, ingest agents create Sources, domain-scoped Concepts and Entities, and the
Refinery promotes high-density concepts into shared `Concepts/`, `Entities/`, `Bridges/`, and
`Conflicts/`.

The proposed extension is not a replacement. It adds AI-facing portability:

- OKF-compatible Markdown bundles for distilled knowledge.
- EntityMap JSON/HTML artifacts that expose canonical entities, relationships, and source evidence.
- Links from EntityMap entries back to the OKF Markdown files that contain the durable knowledge.

Sources reviewed:

- OKF v0.1 draft: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
- EntityMap v1.0 spec: https://entitymap.org/spec/v1.0
- Current implementation files under `ideas-funnel/`.

## Current Solution Strengths

The existing funnel already has most of the conceptual material needed for OKF and EntityMap.

| Capability | Current support |
|---|---|
| Markdown knowledge files | Strong. The vault is already Markdown-first. |
| YAML frontmatter | Strong. `templates/frontmatter.yaml` defines a broad schema. |
| Concept/entity/source separation | Strong. The funnel explicitly creates Source, Concept, Entity, Bridge, and Conflict pages. |
| Provenance | Strong. Pages carry `provenance.source_ids`, `created_at`, and `created_by`. |
| Evidence accumulation | Strong. Refinery promotes concepts after three unrelated sources. |
| Human-readable graph | Strong inside Obsidian via wikilinks. |
| Confidence/state model | Strong. Confidence, decay, confirmation count, and conflict protocol are already designed. |
| Human-in-the-loop workflow | Strong. Ready/review lanes and explicit human control are preserved. |

This means the OKF/EntityMap work should mostly be an export/profile layer plus schema additions,
not a new knowledge architecture.

## Target Shape

Recommended target architecture:

```text
Obsidian vault
  Raw/                         # capture input, not exported
  Domains/                     # domain-scoped working knowledge
  Concepts/                    # refinery-promoted durable concepts
  Entities/                    # refinery-promoted durable entities
  Sources/                     # evidence/source summaries
  Bridges/                     # cross-domain concepts
  Conflicts/                   # contradiction records
  _exports/
    okf/
      index.md
      log.md
      concepts/*.md
      entities/*.md
      sources/*.md
      bridges/*.md
    entitymap.json
    entitymap.html
```

The Obsidian vault remains the authoring system. `_exports/okf/` is the portable OKF bundle.
`entitymap.json` and `entitymap.html` are generated graph indexes that point into the OKF bundle.

## Gap Analysis

### 1. OKF Conformance

Current state:

- Most generated wiki pages already have YAML frontmatter.
- `type` exists and maps well to OKF concept types.
- `title`, `summary`, `tags`, and provenance fields already exist.
- Links are Obsidian wikilinks, not standard Markdown links.
- `index.md` and `log.md` are already part of the design, but OKF reserves those filenames and
  expects specific structural behavior.

Gaps:

| Gap | Severity | Why it matters | Recommended fix |
|---|---:|---|---|
| No explicit OKF export/profile | High | The vault may be close to OKF, but consumers need a clear conformant bundle. | Add `/ideas-funnel:export-okf` or a pipeline phase that writes `_exports/okf/`. |
| Obsidian wikilinks are not OKF links | High | OKF cross-links are standard Markdown links. Wikilinks reduce portability. | Convert wikilinks to bundle-relative Markdown links during export. |
| `summary` vs OKF `description` mismatch | Medium | OKF recommends `description`; current schema uses `summary`. | Export `description: <summary>` while preserving `summary`. |
| No `timestamp` mapping | Medium | OKF recommends ISO 8601 last-modified timestamps. | Export `timestamp` from `last_touched` or latest timeline entry. |
| `index.md` frontmatter ambiguity | Medium | OKF generally treats `index.md` as a listing, with special version exception. | Generate OKF indexes rather than reusing Obsidian indexes directly. |
| Reserved names not guarded | Low | `index.md` and `log.md` should not be concept documents in OKF. | Extend lint to flag reserved filename misuse in export scope. |

### 2. EntityMap Support

Current state:

- Concepts and Entities already exist as separate page classes.
- Source pages and provenance can become EntityMap chunks.
- Refinery already derives relationships such as concept promotion, bridges, and conflicts.
- Entity pages have `entity_type`, but the canonical EntityMap fields do not exist yet.

Gaps:

| Gap | Severity | Why it matters | Recommended fix |
|---|---:|---|---|
| No stable `entityId` field | High | EntityMap requires stable unique IDs that are never reused. Paths alone may change. | Add `entity_id` to promoted Concepts/Entities and preserve it across renames. |
| No EntityMap type mapping | High | EntityMap requires `@type`; current `type: concept/entity` is too coarse. | Add `entitymap_type` or derive from `type` + `entity_type`. |
| No chunk model | High | EntityMap requires 1-5 evidence chunks per entity. | Generate chunks from Source summaries, `## Sources`, citations, and key claims. |
| No publisher identity mapping | High | EntityMap requires root publisher and exact chunk publisher attribution. | Use `CRITICAL_FACTS.md` or config to declare publisher name/url. |
| Relationships are mostly implicit | Medium | EntityMap benefits from explicit predicates. Current links are untyped. | Add optional `relations:` frontmatter and derive conservative predicates from Bridges, Sources, and page classes. |
| No HTML companion | Medium | EntityMap expects `entitymap.html` alongside JSON. | Generate a simple human/crawler-readable table/tree view. |
| No discovery publication | Low | Web publication wants robots/head/footer discovery. | Defer unless publishing vault exports to a website. |

### 3. Obsidian Compatibility

Current state:

- The vault optimizes for Obsidian authoring: wikilinks, domain pages, landing pages, and
  human-readable memory evolution.
- OKF and EntityMap are downstream consumer formats.

Gaps:

| Gap | Severity | Why it matters | Recommended fix |
|---|---:|---|---|
| Risk of forcing export constraints into authoring | Medium | Obsidian should remain useful for thinking and capture. | Keep OKF/EntityMap generated artifacts under `_exports/`. |
| Link semantics differ | Medium | Obsidian wikilinks are good for authoring; OKF wants Markdown links. | Convert links only at export time. |
| Frontmatter could become noisy | Low | EntityMap-only fields could clutter authoring notes. | Store only durable identity fields in notes; compute export-only fields. |

### 4. Pipeline Integration

Current state:

- The daily Workflow has phases: ingest, threshold-check, optional refinery, optional scorer.
- No export phase exists.

Gaps:

| Gap | Severity | Why it matters | Recommended fix |
|---|---:|---|---|
| No export phase after Refinery/scorer | High | EntityMap and OKF need regeneration after knowledge changes. | Add an optional `export` phase after refinery and monthly scorer. |
| No manual export command | Medium | Human should be able to regenerate artifacts on demand. | Add `/ideas-funnel:export` with `--okf`, `--entitymap`, or both. |
| No validation gate | Medium | Invalid YAML, bad links, or missing chunks can silently produce unusable artifacts. | Extend lint or add `/ideas-funnel:validate-export`. |
| No sharding strategy | Low initially | EntityMap suggests sharding above 200 entities. | Defer; implement when entity count crosses threshold. |

### 5. Schema Additions

Minimal additions to current frontmatter:

```yaml
okf:
  export: true
  type: "Concept"
  resource: null

entity:
  id: "stable-slug-or-ulid"
  type: "Concept"
  canonical_label: "Open Knowledge Format"
  same_as: []
  alternate_names: []

relations:
  - predicate: "RELATES_TO"
    target: "other-entity-id"
    confidence: 0.8
```

Keep these fields optional. Existing pages remain valid. Exporters can derive defaults when fields
are absent, but promoted Concepts/Entities should eventually get stable IDs.

## Implementation Options

### Option 1: Export-Only Layer (Recommended)

Add commands/scripts that read the current vault and generate OKF/EntityMap artifacts under
`_exports/`.

Pros:

- Lowest disruption to Obsidian.
- Compatible with the current schema.
- Easy to delete/regenerate.
- Lets us validate before changing ingestion/refinery behavior.

Cons:

- Some relationships remain inferred until frontmatter fields are added.
- Requires link conversion and export validation.

### Option 2: Native OKF Authoring

Make all durable Obsidian pages directly OKF-conformant.

Pros:

- No separate export layer for OKF.
- The vault itself becomes more portable.

Cons:

- Forces standard Markdown links or dual-link conventions into authoring.
- Makes `index.md`/`log.md` rules more sensitive.
- Higher risk of degrading the existing Obsidian workflow.

### Option 3: EntityMap-First Refactor

Make stable entities and relations the primary internal model, then generate Obsidian and OKF views.

Pros:

- Clean graph model.
- Strongest long-term AI-facing architecture.

Cons:

- Too large for the current phase.
- Reworks core assumptions before the runtime is proven.
- More migration and testing burden.

## Recommendation

Proceed with Option 1: export-only layer first.

The current funnel already has the right primitives. The gap is interoperability, not knowledge
capture. The safest implementation is:

1. Add an OKF export command that writes `_exports/okf/`.
2. Add an EntityMap export command that reads promoted Concepts/Entities and points chunks back to
   OKF files.
3. Add lint/validation checks for export conformance.
4. Only then add optional schema fields to improve precision: stable entity IDs, explicit
   EntityMap types, canonical labels, sameAs links, and typed relations.

## First Implementation Slice

Smallest useful slice:

1. Create `ideas-funnel/skills/export/SKILL.md`.
2. Add a script or agent workflow that:
   - scans `Concepts/`, `Entities/`, `Sources/`, and `Bridges/`;
   - copies/export-transforms pages into `_exports/okf/`;
   - converts wikilinks to Markdown links;
   - maps `summary` to `description`;
   - generates OKF `index.md` and `log.md`;
   - generates `entitymap.json` with root publisher, entities, chunks, and conservative relations;
   - generates `entitymap.html`.
3. Extend `ideas-funnel:lint` to validate:
   - OKF export has parseable frontmatter and non-empty `type`;
   - EntityMap entries have required fields and at least one chunk;
   - chunk publisher matches root publisher;
   - generated links resolve inside `_exports/okf/` where possible.

## Non-Goals for First Slice

- Publishing to a public website.
- robots.txt or HTML head discovery.
- EntityMap sharding.
- Full predicate inference.
- Rewriting existing Obsidian notes to standard Markdown links.
- Migrating all historical notes.

## Open Questions

1. What is the publisher identity for EntityMap: Chris Weber, Cosmic Dreams, or a project-specific
   brand?
2. Should `_exports/` live inside the Obsidian vault or outside it in a build/output directory?
3. Are raw `Sources/` included in OKF as first-class concepts, or only used as citations/chunks?
4. Should EntityMap include only promoted shared Concepts/Entities, or domain-scoped pages too?
5. What is the stable ID policy: slug, slug plus namespace, or generated immutable ID?
