---
name: ideas-funnel:query
description: >
  Answer a question against the vault: scan index.md for candidates, read the relevant
  bodies, synthesize with [[wikilink]] citations, and optionally file the answer back as a
  new Concept page when it is novel enough to deserve one.
triggers:
  - query
  - /ideas-funnel:query
  - query the vault
  - ask the vault
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

**Used by:** human (on demand).

# ideas-funnel:query

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Answer a question against the vault. Scans index.md for candidate pages, reads the relevant bodies, synthesizes a response with [[wikilink]] citations, and optionally files the answer back as a new Concept page if the answer is novel enough to deserve one. Trigger phrases: "query the vault", "/ideas-funnel:query", "what does the vault say about X".

Answer a question using tiered retrieval over the vault.

## Input

A natural-language question. Example: `/ideas-funnel:query what do we know about Karpathy's LLM Wiki pattern?`

## Step 1 — Identify candidate pages

Read `~/Vaults/Neurons/index.md`. Match the question against page titles, summaries, tags. Build a ranked shortlist of candidate pages (up to 15).

If the shortlist is thin (< 3 candidates), do a full-text search:

```bash
cd ~/Vaults/Neurons
grep -rliF "<key-term>" Concepts Entities Sources Domains --include="*.md"
```

## Step 2 — Read page bodies

Open the shortlist. Pay attention to `summary:` frontmatter — that's the one-line gist. Skim bodies for the specific claims that answer the question.

## Step 3 — Synthesize

Write a response:
- Lead with the direct answer.
- Cite every claim with `[[Path/Page]]`.
- If sources disagree, surface the tension (note `tension_score` if present in frontmatter).
- Keep it proportional to the question.

## Step 4 — File back if novel

If the answer represents a synthesis that doesn't exist as its own Concept page, offer to create one:

```
This answer is a synthesis across [[A]], [[B]], [[C]]. File as a new Concept page?
```

If user accepts, write `Concepts/<Name>.md` with `provenance.origin: ai-generated` and `state: fresh`.

## Step 5 — Log

Append to `log.md`:

```markdown
## [YYYY-MM-DD] query | "<question>" | pages_read: N | filed_new: <yes|no>
```

## Guidelines

- Answers grounded in sources, not inferred confidently.
- If the vault is silent on the question, say so — don't invent.
- Prefer `Concepts/` and `Bridges/` for synthesis; `Sources/` for primary evidence.
