---
name: ideas-funnel:lint
description: >
  Wiki-aware vault linter. Scans for structural violations, schema compliance
  (v1 + v2 fields), index.md sync, Raw/ staleness, orphan pages, and timeline
  overflow. Reports grouped by severity. Writes `^stale` flags and
  `backlink_density` to page frontmatter. Trigger phrases: "lint the vault",
  "vault health", "/ideas-funnel:lint", "check the vault".
triggers:
  - lint
  - /ideas-funnel:lint
  - lint the vault
  - vault health
  - check the vault
allowed-tools:
  - Bash
  - Read
  - Edit
  - Grep
  - Glob
---

**Used by:** pipeline Workflow (nightly maintenance phase) + human for manual runs.

# ideas-funnel:lint

Scan the vault and report problems. Writes only frontmatter flags (`^stale`, `backlink_density`) — never modifies page bodies or deletes files.

## Prerequisites

Read `~/Vaults/Neurons/wiki-schema.md` and `~/Vaults/Neurons/index.md`.

## Step 1 — Raw/ staleness

```bash
cd ~/Vaults/Neurons/Raw
find . -name "*.md" -type f -not -name "README.md"
```

For each file:
- Not listed in `Raw/.manifest.json` AND older than 7 days → **stale** warning.
- Empty file (0 bytes) → info.

`Raw/Inbox/<domain>/*.md` items not in manifest after 7d indicate the ingest pipeline stalled for that domain.

## Step 2 — Schema compliance

### Sources

For each `Sources/*.md`:
- Must have frontmatter with `type: source` + `date` + `tags` + `origin`.
- Must contain at least one `[[Concepts/` or `[[Entities/` or `[[Domains/` wikilink.
- Naming: `YYYY-MM-DD-slug.md`.

**v2 additions (flag as warnings if missing on pages created after 2026-04-14):**
- `domain`, `provenance.origin`, `timeline`, `confidence`, `decay_class`, `state`.

Legacy pages (created before the v2 cutover) are tolerated without these fields.

### Concepts (shared `Concepts/*.md`)

- `type: concept`, `tags`, `status` required.
- Must contain `## Sources` section.
- Must NOT be date-prefixed.
- v2: `domain` may be multi-value array (or absent for pre-v2 pages).

### Entities (shared `Entities/*.md`)

- `type: entity`, `tags`, `entity_type` required.
- Must contain `## Sources` section.
- Must NOT be date-prefixed.

### Bridges (shared `Bridges/*.md`)

- `type: bridge`, `domains` (multi-value), `bridge_score` required.

### Conflicts (shared `Conflicts/*.md`)

- `type: conflict`, `tension_score`, `pages_in_conflict` required.

### Landing pages (`Domains/<Label>/_landing.md`)

- `type: landing`, `domain` (single-value array), `hardened: true` expected.

**Severity:** `error` for missing `type`; `warn` for other missing required fields.

Report format:
```
[error] Sources/2026-04-01-foo.md — missing type in frontmatter
[warn]  Concepts/MCP.md — no ## Sources section
[warn]  Domains/AI-Workflows/new-concept.md — missing v2 field: decay_class
```

## Step 3 — Index sync

Compare `index.md` against files on disk.

```bash
find ~/Vaults/Neurons/{Sources,Concepts,Entities,Bridges,Conflicts} \
  ~/Vaults/Neurons/Domains/*/ \
  -name "*.md" -not -name "_landing.md" -not -name "README.md" 2>/dev/null
```

**Missing from index:** files on disk with no entry in `index.md`.
**Phantom entries:** lines in `index.md` pointing to files that don't exist.

**Severity:** warning.

## Step 4 — Orphan detection

For each page in `Concepts/`, `Entities/`, `Domains/*/`:

```bash
name=$(basename "$file" .md)
grep -rlF "[[$name" ~/Vaults/Neurons --include="*.md" | grep -v "$file" | wc -l
```

If inbound link count == 0 → orphan.

**Severity:** info (may be newly created).

Write `backlink_density: <count>` to each page's frontmatter.

## Step 5 — Stale flags

For each wiki page with `decay_class: fast` and `last_confirmed` older than 6 months:
- Add `^stale` inline after the title (if not already present):

```markdown
# Page Title ^stale
```

Do NOT modify `confidence` — that's the decay agent's job.

## Step 6 — Timeline sidecar migration

For pages where `timeline:` array length > 10:
- Move entries 1..(N-3) to `Sources/<slug>.timeline.md` (append-only).
- Keep entries (N-2)..N inline in frontmatter as preview.
- Set `timeline_truncated: true`.
- Append a `log.md` line: `## [YYYY-MM-DD] lint | timeline migrated: <page>`

## Step 7 — Structural placement

- Files in vault root that aren't `index.md`, `wiki-schema.md`, `AGENTS.md`, `CRITICAL_FACTS.md`, or `log.md` → warning.
- `shared/` path remnants → warning.
- Markdown files directly in `Projects/` → warning.
- Empty directories (excluding `Bridges/`, `Conflicts/`, `Raw/Assets/`, `Raw/Inbox/<domain>/`) → info.

## Step 8 — Taxonomy violations

For each page's `tags:`, verify every tag exists in `_meta/taxonomy.md`.

```bash
grep -E "^- \`" ~/Vaults/Neurons/_meta/taxonomy.md | sed 's/.*`\([^`]*\)`.*/\1/' > /tmp/tax.txt
```

Unknown tag → warning per page.

## Step 9 — Report

```
# Vault Health Report — YYYY-MM-DD

## Errors (N)
...

## Warnings (N)
...

## Info (N)
...

## Summary
- Raw/ staleness: N stale items
- Schema compliance: N errors, M warnings
- Index sync: N missing, M phantoms
- Orphans: N pages (now tagged backlink_density: 0)
- Timeline migrations: N
- Taxonomy violations: N
- Structure: N misplaced files
- Stale flags written: N
- Overall: HEALTHY | NEEDS ATTENTION | UNHEALTHY
```

**HEALTHY:** 0 errors + ≤3 warnings.
**NEEDS ATTENTION:** 0 errors + >3 warnings OR any stale Raw/ items.
**UNHEALTHY:** any errors.

Write this summary into `_meta/stats.md` when `ideas-funnel:stats` is not being
run in the same Workflow. When `stats` is running, return the counts so that
skill can write the consolidated snapshot.

## What NOT to do

- Do not modify page bodies (only frontmatter flags).
- Do not delete anything.
- Do not scan `Scratches/`, `Archive/`, `.obsidian/`, `analysis-reports/`.
- Do not flag `Next-Experiments/` or `Research/` for schema compliance — those follow their own formats.
