---
name: ideas-funnel:query
description: >
  Answer a question against the vault. Scans index.md for candidate pages,
  reads the relevant bodies, synthesizes a response with [[wikilink]] citations,
  and optionally files the answer back as a domain synthesis draft or Refinery
  promotion request if the answer is novel enough to deserve one. Trigger phrases: "query the vault",
  "/ideas-funnel:query", "what does the vault say about X".
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

If the answer represents a synthesis that doesn't exist as its own page, offer
to create a draft:

```
This answer is a synthesis across [[A]], [[B]], [[C]]. File as a domain draft
and request Refinery promotion?
```

If user accepts:

1. Write to `Domains/<Label>/<Name>.md` when the synthesis is domain-scoped.
2. Write to `Raw/Synthesis/<YYYY-MM-DD>-<slug>.md` when the domain is unclear.
3. Append a `log.md` line with `query | refinery-request: <path>`.

Do not write directly to `Concepts/`, `Entities/`, `Bridges/`, or `Conflicts/`.
Those are Refinery-only shared layers.

## Step 5 — Log

Append to `log.md`:

```markdown
## [YYYY-MM-DD] query | "<question>" | pages_read: N | filed_new: <yes|no>
```

## Guidelines

- Answers grounded in sources, not inferred confidently.
- If the vault is silent on the question, say so — don't invent.
- Prefer `Concepts/` and `Bridges/` for synthesis; `Sources/` for primary evidence.
- Shared-layer promotion goes through Refinery.
