---
name: ideas-funnel:ingest
description: >
  Processes unprocessed items in Raw/ and Raw/Inbox/<domain>/ — breaks each into
  Source, Concept, and Entity pages; updates index.md, log.md, and .manifest.json;
  emits wiki/concept-density-threshold signal when a concept crosses the
  ≥3-unrelated-sources bar. Extends the existing vault ingest skill with
  multi-domain dispatch and the v2 frontmatter schema (timeline, confidence,
  decay_class, state, provenance). Trigger phrases: "ingest", "process raw items",
  "process inbox", "/ideas-funnel:ingest".
triggers:
  - ingest
  - /ideas-funnel:ingest
  - process raw items
  - process inbox
  - process daily notes
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - WebFetch
---

**Used by:** `ideas-funnel/agents/ingest.md` (spawned by the pipeline Workflow) + human for manual runs.

# ideas-funnel:ingest

Process unprocessed items in `Raw/` and `Raw/Inbox/<domain>/` into the wiki.

## Prerequisites

Read these before starting:

1. `~/Vaults/Neurons/wiki-schema.md` — page types, frontmatter conventions, cross-reference rules, v2 extension.
2. `~/Vaults/Neurons/CRITICAL_FACTS.md` — operator identity.
3. `~/Vaults/Neurons/index.md` — what Concepts and Entities already exist. Prefer updating existing pages over creating new ones.
4. `~/Vaults/Neurons/_meta/taxonomy.md` — controlled tag vocabulary.

## Step 1 — Determine scope

When invoked by the pipeline Workflow a specific `domain` is passed. Work only in that domain's inbox.

When invoked manually with no domain, scan all domains plus root `Raw/` daily notes.

```bash
VAULT=~/Vaults/Neurons
CONFIG=~/.config/ideas-funnel/domains

ACTIVE_DOMAINS=$(for f in "$CONFIG"/*.yaml; do
  grep -q '^active: false' "$f" 2>/dev/null || basename "$f" .yaml
done)
```

## Step 2 — Find unprocessed items

For each domain in scope, list `Raw/Inbox/<domain>/*.md`. Also list `Raw/*.md` (daily notes, domain-less).

An item is unprocessed if:
- It is not listed in `Raw/.manifest.json` as an ingested entry, OR
- Its frontmatter lacks `status: ingested`.

Skip empty files. Skip `README.md` placeholders.

## Step 3 — For each unprocessed item, analyze

Daily notes (named `YYYY-MM-DD.md` at root of `Raw/`) may contain multiple items — process each separately. `Raw/Inbox/<domain>/*.md` items are single-source per file.

For each distinct article, link, or idea:

1. **Core topics** — what concepts does this discuss?
2. **Entities** — tools, people, companies, products, projects mentioned?
3. **Actionability** — could Chris run a concrete experiment within a week?

### Enrich bare URLs

For items that are primarily a URL with little commentary:

- Fetch via WebFetch (or `obsidian:defuddle` for articles).
- GitHub repos: read README + repo description.
- Blog posts: extract thesis + key points.
- YouTube: fetch page title + description.

Fetch multiple URLs in parallel in one message.

Unreachable URL → note `[unreachable]` in the Source page and continue.

### headroom compression

If an article body exceeds 4000 words, compress it through headroom (reversible mode)
before page-breaking, when `command -v headroom` succeeds. Degrade silently if absent.

## Step 4 — Write wiki pages

### 4a. Source page

**Path:** `Sources/<date>-<slug>.md`

```markdown
---
type: source
title: "Title"
summary: "2-sentence what-and-why"
date: YYYY-MM-DD
origin: {URL or "daily-note" or "ideas-funnel"}
domain: [<slug>]
tags: [from _meta/taxonomy.md]
status: ingested
provenance:
  origin: extracted
  source_ids: [<raw-file-path>]
  created_at: YYYY-MM-DD
  created_by: ingest@<domain>
timeline:
  - event_at: YYYY-MM-DD
    learned_at: YYYY-MM-DD
    claim: "original capture"
    agent: ingest@<domain>
timeline_truncated: false
confidence: 1.0
confirmation_count: 0
decay_class: <from domain config>
last_confirmed: YYYY-MM-DD
last_touched: YYYY-MM-DD
state: fresh
hardened: false
backlink_density: 0
---

# Title

2–5 sentence summary of what this source says and why it matters.

## Key Points
- Bullet points of the essential information.

## Connections
- [[Concepts/ConceptName]] — one line on how this source relates.
- [[Entities/EntityName]] — one line on relevance.

## Original Source
{URL or "Clipped from daily note {date}"}
```

### 4b. Concept pages — write to `Domains/<Label>/` (NOT shared `Concepts/`)

The ingest agent never writes to vault-shared `Concepts/` or `Entities/`. Domain-specific concepts go to `Domains/<Label>/<Name>.md`. The Refinery promotes to `Concepts/` when a concept crosses ≥3 unrelated sources.

For each concept identified:

1. Check `Concepts/<Name>.md` — if it exists (Refinery-promoted), link to it from the Source page; do not modify it.
2. Otherwise check `Domains/<Label>/<Name>.md` — if it exists, update it.
3. Otherwise create it in `Domains/<Label>/<Name>.md`.

Frontmatter: use the full v2 schema. Set `type: concept`, `domain: [<slug>]`, `provenance.origin: extracted` or `ai-generated`.

### 4c. Entity pages — same pattern as concepts

Write to `Domains/<Label>/Entities/<Name>.md`. Vault-shared `Entities/` is Refinery-write-only.

### 4d. Next-Experiments (if actionable)

If the item describes something Chris could test, create `Next-Experiments/<date>-<slug>.md`.

## Step 5 — Detect concept-density threshold

After writing all pages for the batch, count for each concept:
- How many distinct Source pages (across all domains) link to it?
- Are those sources from ≥3 unrelated source URLs?

If ≥3 unrelated sources reference a concept, record it in the `density_signals` output.
Do not write to `Concepts/` yourself.

## Step 6 — Update index.md, log.md, manifest

### index.md

Append entries for every new page:
- New Concepts / Entities under their sections
- New Sources under `## Sources`
- Alphabetical within each section
- Wikilink format: `- [[Path/Page|Display]] — one-line summary`

### log.md

```markdown
## [YYYY-MM-DD] ingest | domain: <slug> | sources: N | concepts: X new, Y updated | entities: Z new, W updated
```

### Raw/.manifest.json

For each processed file:

```json
{
  "entries": {
    "Raw/Inbox/ai-workflows/2026-04-14-article.md": {
      "hash": "sha256:...",
      "ingested_at": "2026-04-14T17:00:00Z",
      "wiki_pages": ["Sources/2026-04-14-slug.md", "Domains/AI-Workflows/Concept-Name.md"],
      "domain": "ai-workflows"
    }
  }
}
```

Use `shasum -a 256 <file>` for the hash. Atomic update: write to `.manifest.json.tmp`, then `mv`.

## Step 7 — Archive raw items

```bash
mkdir -p "$VAULT/Archive/Raw/<domain>"
mv -f "$RAW_FILE" "$VAULT/Archive/Raw/<domain>/"
```

For daily notes with multiple items, archive only after ALL items are processed.

## Guidelines

- **Prefer updating.** If a domain-scoped or vault-shared page exists, enrich it.
- **Break things apart.** One article about "Anthropic releases MCP tools" touches `Domains/AI-Workflows/MCP.md` (concept), `Domains/AI-Workflows/Entities/Anthropic.md` (entity), and creates ONE Source page — not one monolith.
- **Keep summaries tight.** Source pages are 5–15 lines. Concept/Entity pages grow incrementally.
- **Wikilinks everywhere.** Every page links to related pages.
- **2–4 tags per page.** Use existing tags from `_meta/taxonomy.md` before inventing new ones.
- **Never write to `Concepts/`, `Entities/`, `Bridges/`, or `Conflicts/`.** Those are Refinery-only.
