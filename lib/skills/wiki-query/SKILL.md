---
name: wiki-query
description: >
  Ask a question against the Obsidian wiki and get a researched answer filed
  as a new wiki page. Reads index.md to find relevant Concepts, Entities, and
  Sources, synthesizes an answer from existing pages, optionally searches the
  web to fill gaps, then writes the result as a new Concept or Source page and
  updates the index. Closes the research loop — answers compound in the wiki
  instead of disappearing into chat history.
  Trigger phrases: "wiki-query", "ask the wiki", "research this in my vault",
  "what does my wiki say about", "query the vault", "look this up in my notes",
  "wiki answer", "what do I know about".
  Do NOT trigger for: simple vault search (use lib:vault-search), ingesting
  raw content (use ingest), or structural lint (use vault-lint).
triggers:
  - "wiki-query"
  - "ask the wiki"
  - "research this in my vault"
  - "what does my wiki say about"
  - "query the vault"
  - "what do I know about"
  - "wiki answer"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - WebFetch
  - WebSearch
---

# lib:wiki-query

Research a question against the vault wiki. Synthesize an answer from existing
pages, fill gaps with web research, and file the result as a new wiki page.

## Step 1 — Understand the question

Parse the user's question into:
- **Topic**: the subject being asked about
- **Question type**: factual ("what is X"), comparative ("how does X compare to Y"),
  gap analysis ("what don't we know about X"), or synthesis ("how do X and Y relate")

## Step 2 — Search the wiki

Read `~/Vaults/Neurons/wiki-schema.md` for page type conventions.

Read `~/Vaults/Neurons/index.md` to find relevant pages.

```bash
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
```

Search for the topic across wiki pages:

```bash
# Find pages mentioning the topic
grep -rl "{topic}" "$VAULT_ROOT/Concepts" "$VAULT_ROOT/Entities" "$VAULT_ROOT/Sources" --include="*.md"
```

Read each matching page. Build a picture of what the wiki already knows.

Also check `Next-Experiments/` and `Research/` for related content outside the
wiki layer.

## Step 3 — Identify gaps

Compare what the wiki knows against the question:
- **Sufficient**: the wiki has enough to answer fully → skip to Step 5
- **Partial**: some information exists but key aspects are missing → go to Step 4
- **Empty**: the wiki has nothing on this topic → go to Step 4

Report the gap to the user:
```
Wiki coverage: {sufficient | partial | empty}
Found: {N} relevant pages
Missing: {what aspects the wiki doesn't cover}
```

## Step 4 — Fill gaps with web research (if needed)

Use WebSearch to find 2-3 high-quality articles on the missing aspects.
Use WebFetch to read each article and extract key points.

For each article, create a Source page:

**Path:** `Sources/{date}-{slug}.md`

```markdown
---
type: source
date: YYYY-MM-DD
tags: [relevant, tags]
origin: {url}
status: active
---

# {Title}

{2-4 sentence summary}

## Key Points
- {bullets}

## Connections
- [[Concepts/{ConceptName}]] — {relevance}

## Original Source
{url}
```

## Step 5 — Synthesize the answer

Combine wiki knowledge + any new sources into a comprehensive answer.

**If the answer is about an existing Concept or Entity:**
Update the existing page — add new information to the relevant sections,
append new sources to `## Sources`.

**If the answer introduces a new concept:**
Create a new Concept page:

**Path:** `Concepts/{Name}.md`

```markdown
---
type: concept
tags: [relevant, tags]
status: active
---

# {Concept Name}

{Definition synthesized from all sources}

## What We Know
{Organized by subtopic, citing sources}

## Related
- [[Concepts/{Related}]] — {relationship}
- [[Entities/{Related}]] — {relationship}

## Sources
- [[Sources/{slug}]] — {what this source contributes}
```

**If the answer is a comparison or analysis:**
Create a Source page (type: source) since it's a derived artifact, not a
canonical concept.

## Step 6 — Update index.md

Add entries for every new page created. Maintain alphabetical order within
each section.

## Step 7 — Present the answer

Output the synthesized answer to the user in the conversation. Then report
what was filed:

```
Answer filed:
  Created: {list of new pages}
  Updated: {list of updated pages}
  New sources: {count from web research}
  Wiki coverage: {topic} is now {sufficient}
```

## Guidelines

- **Prefer updating existing pages over creating new ones.** Check index.md first.
- **Always cite sources.** Every claim in a Concept page should trace to a Source.
- **Don't over-research.** 2-3 web sources is enough to fill a gap. The wiki will
  naturally deepen as more content arrives through ingest.
- **File the answer, not the conversation.** The wiki page should stand alone —
  someone reading it shouldn't need the chat history to understand it.
- **Cross-reference aggressively.** Link to related Concepts and Entities.
  This is what makes the graph view useful.
