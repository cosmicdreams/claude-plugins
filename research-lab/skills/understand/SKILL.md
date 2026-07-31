---
name: understand
description: >
  Build a shared mental model of existing material with the user — a plan, pasted text, a
  file, a codebase, a system, a problem space, or a NotebookLM notebook. No notebook
  required. The agent chooses its own strategy rather than following a script; output is a
  lightweight record of understanding. Not for quick lookups, implementation, or
  adversarial challenge.
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

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Digest existing material into a shared mental model. You and the user work together to build shared understanding of a target — a written plan, a wall of pasted text, a file, a codebase, a system, a problem space, or a curated NotebookLM notebook. Does NOT require a notebook: it accepts pasted text, a file path, OR a notebook id. Follows Crucial Conversations principles: mutual purpose, mutual respect, shared pool of meaning. The agent decides its own strategy for gathering information rather than following a fixed script. Output is a lightweight record of understanding — written into the notebook when one is in play, otherwise stored in the vault. Use when the user wants to deeply understand existing material before planning or building. Say "let's understand", "help me understand", "understand this", "walk through this with me", or "research-lab:understand". Not for quick lookups, not for implementation, not for adversarial challenge (use reality-check for an unformed idea, interrogate for a formed claim).

Digest existing material into a shared mental model. Two minds — you and the user — building a
shared pool of meaning about a target: a written plan, a raw wall of text, a file, a codebase, a
system, a problem space, or a curated notebook.

**Stance:** peer / colleague — *both* you and the user must come to understand. Not tutor (that is
`teach`). Not challenger (that is `interrogate` / `reality-check`).

---

## Input contract

- **Requires:** a body of existing material to digest.
- **Resolves from:** context → file path / pasted text → notebook id.

## Preflight

1. Check context for material already in play. If present, use it.
2. Else check for an arg: a **file path**, a **wall of pasted text**, or a **NotebookLM notebook id**.
3. Else **FAIL FAST**: "No material to digest — paste it, give me a file path, or a notebook id. If you have a topic but no material yet, run `gather` first." Stop.

When headroom is present (`command -v headroom`), large pasted walls of text or fetched sources can
be compressed before digestion to reduce context consumption.

---

## Principles

**Mutual purpose:** both participants are here to understand the target. Neither is the authority.
Build a shared mental model that neither could build alone.

**Mutual respect:** colleagues at a whiteboard — say directly when something changes the picture;
integrate corrections without defensiveness.

**Shared pool of meaning:** every insight either of you surfaces goes in. Disagreements are
explored, not suppressed. The record captures what you both agree on AND what remains unresolved.

**Self-directed exploration:** decide how to gather information — no prescribed tool sequence.
Exhaust available resources before asking the user questions the codebase or documentation could answer.

---

## The Design Tree

Any target can be decomposed into a tree of aspects, decisions, and dependencies. Understanding
means walking every branch.

Build the tree as you explore. Each branch has an identifier, a label, a status (`explored`,
`open`, `blocked`, or `deferred`), optional dependencies, and notes. Maintain the tree as internal
state throughout the session — it guides what to explore next.

When a notebook id is in play, `notebooklm generate mind-map -n NOTEBOOK_ID --kind note-backed` gives
a parseable JSON decomposition (`{mind_map, note_id, kind}`) to seed the tree — use `--kind
note-backed`, not the default interactive Studio map, when you need to *read* the structure.

Resolve dependencies first, work outward, and do not leave branches unexplored without naming the
deferral.

---

## Process

No rigid phase structure. The natural shape:

**1. Identify the target.** Name it explicitly. If ambiguous, make a reasonable inference and let
the user correct you.

**2. Explore and decompose.** Do your own homework before engaging the user in back-and-forth:

- **Plan / pasted text / file:** read it in full; trace claims and structure.
- **Notebook id:** read it back; `generate mind-map --kind note-backed` gives a free, parseable structural decomposition.
- **System or codebase:** read relevant code, configs, docs; trace data flows.

Fan-out to parallel subagents only when independently explorable facets benefit from concurrent
depth — the 1M context window holds the whole corpus for a single target.

**3. Share findings; ask about gaps.** Be specific about what you now understand, what surprised
you, and what remains open. Frame questions as contributions to the shared pool, not as an
interview.

**4. Walk every branch.** Continue the cycle until every branch is either understood or explicitly
deferred, and both you and the user can describe the target consistently.

**5. Write the record of understanding.** When the session reaches natural completion, synthesize
into the record. Use this structure as a guide, adapt to what was actually discussed:

```markdown
# Understanding: [Target Name]

**Date:** YYYY-MM-DD

## What We Understand
[Shared mental model — confident statements about the target, using "we" language.]

## Key Insights
[Surprising, non-obvious, or particularly important findings.]

## Open Questions
[Unresolved items. Each names what is unknown and why it matters. Omit if none.]

## Context and Constraints
[Background that shaped the understanding — history, constraints, why things are the way they are.]
```

**6. Store the record.**

- **Notebook** — co-locate with sources using `note create` (content piped via `--content -`):
  ```bash
  notebooklm note create -n NOTEBOOK_ID -t "Understanding: TARGET" --content - < /tmp/understanding.md
  ```
- **Vault** — hand to `lib:vault-store`, which owns Obsidian placement.

research-lab does not reimplement vault writes. The record also stays in the engagement directory.

---

## Chaining

Suggest (never auto-invoke):

- **After understand** → `research-lab:synthesize` to form a claim from the digested material (typical next move).
- **After understand** → `research-lab:gather` if understanding revealed gaps that need more sources.
