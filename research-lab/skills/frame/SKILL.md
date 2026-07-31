---
name: frame
description: >
  Sharpen a vague topic into a precise research question with explicit scope, stated
  assumptions, and falsification criteria. Facilitator stance — it asks the sharpening
  questions, it does not answer them. Runs first; not for gathering sources or forming a
  position.
triggers:
  - "frame this"
  - "sharpen this question"
  - "what should I be asking"
  - "scope this research"
  - "frame the question"
  - "research-lab:frame"
allowed-tools: Read, Write
---

# Frame

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Sharpen a vague topic into a precise research question with explicit scope, stated assumptions, and falsification criteria ("what would change my mind?"). The front-of-engagement verb — cheap, fast, runs first when it runs at all. Facilitator stance: it asks the sharpening questions, it does not answer them. Say "frame this", "sharpen this question", "what should I actually be asking", "scope this research", or "research-lab:frame". Not for gathering sources (that is gather) or forming a position (that is synthesize) — frame only sets up the question.

Turn a fuzzy topic into a sharp, falsifiable question. The **front** of the research arc. Cheap
and fast by design — framing is a setup, not a deliverable.

**Stance:** facilitator — ask the sharpening questions and reflect the user's answers back into a
tighter question. Do not answer the research question; that is what the rest of the arc is for.

---

## Input contract

- **Requires:** a topic or fuzzy goal.
- **Resolves from:** context → arg.

## Preflight

1. Check context for a topic or goal. If present, use it.
2. Else check for a topic passed as an arg.
3. Else **FAIL FAST**: "What's the topic you want to frame?" Stop.

---

## Process

Four moves:

### 1. Find the real question

A topic ("Drupal caching") is not a question. Push until you have a question with a verb and a
decidable answer. Ask one or two pointed questions if intent is ambiguous — prefer a reasonable
inference the user can correct over an interrogation.

### 2. Draw the scope line

State explicitly what is **in** scope and what is **out**. The out-of-scope list is more valuable —
it prevents `gather` from dragging in 40 tangential sources.

### 3. Surface the assumptions

List the assumptions the question is carrying. These become things later verbs test rather than
inherit silently.

### 4. Write the falsification criteria

The sharpest question carries its own kill switch: **what evidence would change your mind?** Name
it now, before any source is read, so `synthesize`/`interrogate` have a pre-registered bar instead
of a movable one.

---

## Output

Write `01-frame.md` to the engagement directory when one exists (otherwise present inline):

```markdown
# Frame: <topic>

## Question
<the sharp, decidable question>

## In scope
- ...

## Out of scope
- ...

## Assumptions to test
- ...

## Falsification criteria — what would change my mind
- ...
```

---

## Chaining

Suggest (never auto-invoke):

- **After frame** → `research-lab:gather` to collect sources against the framed question (typical next move).
- **After frame** → `research-lab:understand` if the material already exists and only needs digesting.
