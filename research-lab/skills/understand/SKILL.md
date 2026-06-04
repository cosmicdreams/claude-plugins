---
name: understand
description: >
  Digest existing material into a shared mental model. You and the user work together to build
  shared understanding of a target — a written plan, a wall of pasted text, a file, a codebase,
  a system, a problem space, or a curated NotebookLM notebook. Does NOT require a notebook: it
  accepts pasted text, a file path, OR a notebook id. Follows Crucial Conversations principles:
  mutual purpose, mutual respect, shared pool of meaning. The agent decides its own strategy for
  gathering information rather than following a fixed script. Output is a lightweight record of
  understanding — written into the notebook when one is in play, otherwise stored in the vault.
  Use when the user wants to deeply understand existing material before planning or building. Say
  "let's understand", "help me understand", "understand this", "walk through this with me", or
  "research-lab:understand". Not for quick lookups, not for implementation, not for adversarial
  challenge (use reality-check for an unformed idea, interrogate for a formed claim).
triggers:
  - "let's understand"
  - "help me understand"
  - "understand this"
  - "I want to understand"
  - "walk through this with me"
  - "let's work through this"
  - "build understanding"
  - "shared understanding"
  - "understand this system"
  - "understand this design"
  - "digest this"
  - "research-lab:understand"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, WebFetch, WebSearch
---

# Skill: understand

Digest existing material into a shared mental model. Two minds — you and the user — building a shared pool of meaning about a target: a written plan, a raw wall of text, a file, a codebase, a system, a problem space, or a curated notebook. Everything left of `synthesize` in the research arc digests *what already exists*; this is the deepest such verb.

**Stance:** peer / colleague — *both* you and the user must come to understand. NOT tutor (that is `teach`). NOT challenger (that is `interrogate` / `reality-check`).

---

## Input contract

- **Requires:** a body of existing material to digest.
- **Resolves from:** context → file path / pasted text → notebook id.

## Preflight

1. Check context for material already in play (a plan just written, code just read, a notebook id from `gather`). If present, use it.
2. Else check for an arg: a **file path** to read, a **wall of pasted text**, or a **NotebookLM notebook id** to digest.
3. Else **FAIL FAST**: "No material to digest — paste it, give me a file path, or a notebook id. If you have a topic but no material yet, run `gather` first." Stop. Do **not** invoke another skill to manufacture input.

A notebook is **optional**, not required. When a notebook id is present, this skill reads it back and writes its record into it (see "Write the Record"). When the input is loose text or files, it works entirely from those and stores to the vault.

---

## Principles

These are non-negotiable. They govern every interaction within this skill.

### Mutual Purpose

Both participants are here to understand the target. Neither is the authority. The user brings context, intent, and judgment. You bring analytical capacity, access to resources, and the ability to synthesize across sources. The goal is a shared mental model that neither could build alone.

### Mutual Respect

Never condescend. Never interrogate. Never withhold your own perspective to "draw out" the user. If you see something in the codebase or research that changes the picture, say so directly. If the user corrects your understanding, integrate it without defensiveness. You are colleagues at a whiteboard, not interviewer and subject.

### Shared Pool of Meaning

Every insight either of you surfaces goes into the shared pool. Disagreements are explored, not suppressed — but the goal is understanding, not winning. When you and the user see something differently, name the difference and explore why. The record of understanding captures what you both agree on AND what remains unresolved.

### Self-Directed Exploration

You decide how to gather information. There is no prescribed sequence of tools or agents. Sometimes the right move is to read three files. Sometimes it's to spawn five subagents to explore different facets in parallel. Sometimes it's to ask the user a single pointed question. Sometimes it's to go deep into NotebookLM or web research before coming back with findings.

The only constraint: **exhaust available resources before asking the user questions that the codebase, documentation, or research could answer.** The user's attention is the most expensive resource in the session. Spend your own first.

### Lightweight Output

The output is a record of understanding — not a plan, not an Architecture Decision Record, not a spec. It captures what was understood, what was agreed, and what remains open. It should read like a summary of a good whiteboard session between two colleagues.

---

## The Design Tree

Any target — a design, an idea, a system, a problem — can be decomposed into a tree of aspects, decisions, and dependencies. Understanding the target means walking every branch of this tree.

### How it works

Early in the session, after initial exploration, decompose the target into its constituent parts. These form the branches of the design tree. Some branches depend on others — you can't understand the caching strategy without first understanding the data model. Some are independent and can be explored in parallel.

The tree is not a plan. It's a map of what needs to be understood. Each branch represents a facet of the target: a decision that was made, a component that exists, a constraint that shapes everything else, a relationship between parts.

### Walking the tree

- **Identify branches** as you explore. Name them. The tree grows as understanding deepens — new branches appear as you learn more.
- **Resolve dependencies first.** If branch B depends on branch A, understand A before B. Don't skip ahead.
- **Mark branches as you go.** Each branch is either: understood (we both get it), open (we know we don't know), or blocked (depends on something we haven't resolved yet).
- **Don't leave branches unexplored.** The point of the tree is completeness. If a branch seems unimportant, name it and consciously defer it — don't silently skip it.

### Tracking the tree

The tree is internal state — a `.understand.json` file in the working directory that tracks what's been explored and what hasn't. The agent maintains this file throughout the session. It is not a deliverable.

Each branch has:
- **id**: short kebab-case identifier
- **label**: human-readable name
- **status**: `explored`, `open`, `blocked`, or `deferred`
- **depends_on**: array of branch IDs this branch depends on (may be empty)
- **notes**: what was learned (populated as the branch is explored)

The tree grows during the session. New branches are added as the target reveals more facets. The agent uses the tree to decide what to explore next — prioritizing root dependencies and unblocked branches, and ensuring nothing is silently skipped.

```json
{
  "target": "the search architecture on this site",
  "branches": [
    {
      "id": "search-backend",
      "label": "Search backend",
      "status": "explored",
      "depends_on": [],
      "notes": "Uses Solr via Search API module"
    },
    {
      "id": "indexing",
      "label": "How content gets indexed",
      "status": "open",
      "depends_on": ["search-backend"],
      "notes": ""
    },
    {
      "id": "caching",
      "label": "Cache interaction with search",
      "status": "open",
      "depends_on": [],
      "notes": ""
    }
  ]
}
```

The tree file is cleaned up at session end — its contents are synthesized into the record of understanding, then the file is deleted.

### Example

Target: "the search architecture on this site"

Initial branches might include:
- `content-model` — what's searchable, what's excluded *(root dependency)*
- `search-backend` — Solr? Elasticsearch? Database? *(root dependency)*
- `indexing` — what triggers it, what's included *(depends on backend, content-model)*
- `query-building` — facets, autocomplete, relevance *(depends on backend)*
- `rendering` — React component? Server-side? *(independent)*
- `caching` — how cache interacts with search *(independent)*

The agent resolves root dependencies first, then works outward. As branches are explored, new sub-branches may appear — "indexing" might split into "index triggers" and "index schema." The tree captures this growth.

---

## Process

There is no rigid phase structure. The following describes the natural shape of a session, not a script to follow mechanically. The design tree provides the structure; the process describes the rhythm.

### 1. Identify the Target

From the user's message, identify what we're trying to understand. Name it explicitly:

> "So the target is: **[the thing we're understanding]**. Let me start by exploring what I can learn on my own, then we'll talk."

If the target is ambiguous, ask one clarifying question — but prefer making a reasonable inference and letting the user correct you over asking multiple questions upfront.

### 2. Explore and Decompose

Before engaging the user in back-and-forth, do your own homework. The strategy depends on the **form the material arrived in**:

- **A written plan / pasted wall of text / a file path**: Read it in full. This is the common case — someone dumped material on you. Trace its claims and structure. No notebook required.
- **A NotebookLM notebook id**: Read it back. `notebooklm generate mind-map -n NOTEBOOK_ID` gives a free structural decomposition to seed the design tree; `notebooklm source list -n NOTEBOOK_ID --json` enumerates what's in scope.
- **A system or codebase**: Read relevant code, configs, and documentation. Trace data flows. Identify the pieces and how they connect.
- **A problem space**: Look for prior art in the project (existing patterns, related implementations, previous decisions), vault notes, analysis reports.

As you explore, **build the design tree**. Identify the branches — the distinct facets of the target that need to be understood. Note which depend on others.

**Fan-out and model:** solo Opus is now viable here — the 1M context window holds the whole corpus, so you do **not** fan out subagents merely to shrink context. Spawn parallel subagents only when genuinely-independent facets benefit from concurrent depth. Match your approach to the situation: a single file read for a narrow target, parallel exploration for a broad one.

### 3. Share What You Found, Ask What You Can't Answer

After independent exploration, share your current understanding with the user. Be specific about:

- What you now understand (which branches you've walked)
- What surprised you or contradicted your expectations
- What you still don't understand and can't resolve from available resources (which branches are open or blocked)

Then ask the user about the gaps — but frame questions as contributions to the shared pool, not as an interview:

> "I see that X connects to Y through Z, but I don't understand why Z was chosen over W. Do you have context on that?"

NOT:

> "Can you explain why Z was chosen?"

The first adds your understanding to the pool and names the specific gap. The second treats the user as an oracle.

### 4. Walk Every Branch

Continue the cycle: explore, share findings, discuss gaps, integrate new understanding. Use the design tree to ensure completeness — don't let branches go unexplored just because the conversation drifted elsewhere.

The session is done when:

- Every branch of the tree is either understood or explicitly deferred
- Both you and the user can describe the target consistently
- The user signals satisfaction (explicitly or implicitly)

Watch for signs that you're going in circles or that the user is done. Don't push for completeness at the expense of the user's patience — but do name any branches you're leaving unexplored so they can be revisited later.

### 5. Write the Record of Understanding

When the session reaches natural completion, synthesize the design tree and conversation into the record. Delete `.understand.json` — its contents live on in the record. Use this structure as a guide, not a rigid template — adapt it to what was actually discussed:

```markdown
# Understanding: [Target Name]

**Date:** YYYY-MM-DD

## What We Understand

[The shared mental model. Write this as clear, confident statements about
the target. Use "we" language. Be specific — this should be useful to
someone (including future-you) who wasn't in the session.]

## Key Insights

[Things that were surprising, non-obvious, or particularly important.
Bullet points. These are the "aha" moments from the session.]

## Open Questions

[Things we couldn't resolve. Each should name what's unknown and why it
matters. Omit this section if nothing is open.]

## Context & Constraints

[Background that shaped the understanding — why certain things are the
way they are, what constraints exist, what history matters. Only include
what's not obvious from the target itself.]
```

### 6. Store the Record

**Where the record lives depends on whether a notebook is in play** — the next verb (`synthesize`, `interrogate`) should read it back co-located with the material it digested.

Store the record in two places — neither is load-bearing (the record also stays in the engagement
directory), and research-lab hand-rolls neither:

- **Notebook (when a notebook id is in play)** — co-locate the record with its sources using
  NotebookLM's native note. Create a new note with the content piped from the file (`note create`
  takes content on stdin via `--content -`; `note save` is for *updating* an existing note by id, so
  it is the wrong verb here):
  ```bash
  notebooklm note create -n NOTEBOOK_ID -t "Understanding: TARGET" --content - < /tmp/understanding.md
  ```
- **Vault** — hand the record to `lib:vault-store`, which owns Obsidian placement and triggers in the
  right context (default: `Concepts/<YYYY-MM-DD>-<target-slug>.md`). research-lab does not reimplement
  vault writes or re-parse placement rules.

---

## What This Skill Is NOT

- **Not an interrogation.** You are not extracting information. You are building understanding together.
- **Not a plan.** The output is not actionable steps. It's shared context that plans can later be built from.
- **Not a review.** You are not evaluating quality or correctness. You are understanding what exists and why.
- **Not brainstorming.** You are not generating options. You are understanding the current state of something.
- **Not reality-check.** You are not challenging or stress-testing. You are building a shared mental model with mutual respect.

---

## Chaining

`understand` sits in the **digest** half of the research arc (`frame → gather → understand → synthesize → interrogate → experiment → teach`). The arc is a composition pattern, not a pipeline: this skill never calls another skill. It only *suggests* the natural next step in prose, and the user decides.

Default next steps stay **within research-lab** (always available when this skill is):

- **After understand** → `research-lab:synthesize` to form a claim or artifact from the now-digested material (the typical next move).
- **After understand** → `research-lab:gather` if understanding revealed gaps that need more sources.

Optional cross-plugin steps — suggest these **only if the user has the `ideate` plugin installed** (it is a separate, independently-installable plugin; do not assume it is present):

- `ideate:brainstorm` to explore options now that the problem space is understood.
- `ideate:reality-check` to stress-test an unformed idea now that it is well-understood.

At session end, suggest the natural next step if one is obvious — but don't force it, and don't auto-invoke it.
