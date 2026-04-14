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
  - Agent
---

**Used by:** `ideas-funnel:ingest` agent (spawned by orchestrator on `batch_complete` or `manual-ingest` signals) + human for manual runs.

# ideas-funnel:ingest

Process unprocessed items in `Raw/` and `Raw/Inbox/<domain>/` into the wiki.

## Prerequisites

Read these before starting:

1. `~/Vaults/Neurons/wiki-schema.md` — page types, frontmatter conventions, cross-reference rules, v2 extension.
2. `~/Vaults/Neurons/CRITICAL_FACTS.md` — operator identity.
3. `~/Vaults/Neurons/index.md` — what Concepts and Entities already exist. **Always prefer updating existing pages over creating new ones.**
4. `~/Vaults/Neurons/_meta/taxonomy.md` — controlled tag vocabulary.

## Step 1 — Determine scope

If invoked via the orchestrator, a specific `--domain <slug>` is passed. Work only in that domain's inbox.

If invoked manually with no domain, scan all domains plus root `Raw/` daily notes.

```bash
VAULT=~/Vaults/Neurons
CONFIG=~/.config/ideas-funnel/domains

# Active domains (YAML files with active: true — or active field missing, default true)
ACTIVE_DOMAINS=$(for f in "$CONFIG"/*.yaml; do
  grep -q '^active: false' "$f" 2>/dev/null || basename "$f" .yaml
done)
```

## Step 2 — Find unprocessed items

For each domain in scope, list `Raw/Inbox/<domain>/*.md`. Also list `Raw/*.md` (daily notes, domain-less).

An item is **unprocessed** if:
- It is not listed in `Raw/.manifest.json` as an ingested entry, OR
- Its frontmatter lacks `status: ingested`.

Skip empty files. Skip `README.md` placeholders.

## Step 3 — For each unprocessed item, analyze

Daily notes (named `YYYY-MM-DD.md` at the root of `Raw/`) may contain multiple items — process each separately. `Raw/Inbox/<domain>/*.md` items are single-source per file.

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

Parallelism: when an item contains multiple URLs, fetch them in parallel in one message.

Unreachable URL → note `[unreachable]` in the Source page and continue.

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
domain: [<slug>]                  # domain this source belongs to; inferred from Raw/Inbox/<domain>/
tags: [from _meta/taxonomy.md]
status: ingested                  # legacy field, preserved for compatibility
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

**v2 rule:** the ingest agent NEVER writes to vault-shared `Concepts/` or `Entities/`. If a concept is domain-specific, write to `Domains/<Label>/<Name>.md`. The Refinery promotes it to `Concepts/` when it crosses the ≥3-unrelated-sources threshold.

For each concept identified:

1. Check `Concepts/<Name>.md` — if it exists (from the pre-v2 corpus or Refinery-promoted), link to it from the Source page; do not modify it.
2. Otherwise check `Domains/<Label>/<Name>.md` — if it exists, update it.
3. Otherwise create it in `Domains/<Label>/<Name>.md`.

Frontmatter: use the full v2 schema. Set `type: concept`, `domain: [<slug>]`, `provenance.origin: extracted` (if lifted directly) or `ai-generated` (if synthesized across sources).

### 4c. Entity pages — same pattern as concepts

Write to `Domains/<Label>/Entities/<Name>.md` for domain-specific entities. Vault-shared `Entities/` is Refinery-write-only.

### 4d. Next-Experiments (if actionable)

If the item describes something Chris could test, create `Next-Experiments/<date>-<slug>.md` following the existing format. This file type exists in the vault already.

## Step 5 — Detect concept-density threshold

After writing all pages for the batch, count for each concept:

- How many distinct Source pages (across all domains) link to it?
- Are those sources from ≥3 unrelated source URLs?

If ≥3 unrelated sources reference a concept, **emit the signal** (to the orchestrator) via a single stdout line:

```
wiki/concept-density-threshold <concept-name> <sources_count>
```

The orchestrator will spawn the Refinery. Do not write to `Concepts/` yourself.

## Step 6 — Update index.md, log.md, manifest

### index.md

Append entries for every new page:
- New Concepts / Entities under their sections
- New Sources under `## Sources`
- Alphabetical within each section
- Wikilink format: `- [[Path/Page|Display]] — one-line summary`

### log.md

Append one line per batch:

```markdown
## [YYYY-MM-DD] ingest | domain: <slug> | sources: N | concepts: X new, Y updated | entities: Z new, W updated
```

### Raw/.manifest.json

For each processed file, add an entry:

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

Use `shasum -a 256 <file>` for the hash. Atomic update: write to a `.manifest.json.tmp`, then `mv`.

## Step 7 — Archive raw items

```bash
mkdir -p "$VAULT/Archive/Raw/<domain>"
mv -f "$RAW_FILE" "$VAULT/Archive/Raw/<domain>/"
```

For daily notes with multiple items, archive only after ALL items are processed.

## Step 8 — Report

```
ingest: domain=<slug> processed N items
  Created: X sources, Y concepts (domain-scoped), Z entities (domain-scoped)
  Updated: A concepts, B entities
  Signals emitted: K concept-density-threshold
```

## Guidelines

- **Prefer updating.** If a domain-scoped or vault-shared page exists, enrich it.
- **Break things apart.** One article about "Anthropic releases MCP tools" touches `Domains/AI-Workflows/MCP.md` (concept), `Domains/AI-Workflows/Entities/Anthropic.md` (entity), and creates ONE Source page — not one monolith.
- **Keep summaries tight.** Source pages are 5–15 lines. Concept/Entity pages grow incrementally but each addition is concise.
- **Wikilinks everywhere.** Every page links to related pages.
- **Don't over-tag.** 2–4 tags per page. Use existing tags from `_meta/taxonomy.md` before inventing new ones.
- **Never write to `Concepts/` or `Entities/` or `Bridges/` or `Conflicts/`.** Those are Refinery-only.
