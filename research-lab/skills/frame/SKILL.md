---
name: frame
description: >
  Trigger this if the user says "frame this", "sharpen this question", or "scope this research". Not for collecting sources (research-lab:gather).
allowed-tools: Read, Write
---

# Frame

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Sharpen a vague topic into a precise research question with explicit scope, stated assumptions, and falsification criteria ("what would change my mind?"). The front-of-engagement verb — cheap, fast, runs first when it runs at all. Facilitator stance: it asks the sharpening questions, it does not answer them. Say "frame this", "sharpen this question", "what should I actually be asking", "scope this research", or "research-lab:frame". Not for gathering sources (that is gather) or forming a position (that is synthesize) — frame only sets up the question.

Turn a fuzzy topic into a sharp, falsifiable question. The **front** of the research arc. Cheap and fast by design — framing is a setup, not a deliverable.

**Stance:** facilitator — ask the sharpening questions and reflect the user's answers back into a tighter question. Do not answer the research question; that is what the rest of the arc is for.

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

A topic ("Drupal caching") is not a question. Push until you have a question with a verb and a decidable answer.

Ask in rounds. A round holds every open question whose answer does not depend on another open question; one that does waits for a later round. Number each question, give it a short title, and put your recommended answer on its own line, worded so "yes" accepts it:

```
❓ **Q1 - <title>**: <question, with the options if there are several>

➡️ <recommended answer>
```

Facts are your job, decisions are the user's. Don't ask what the conversation or a file you can `Read` already answers; read it and state what you found. After each round, recompute what is still open and ask the next round. Most frames need one round.

### 2. Draw the scope line

State explicitly what is **in** scope and what is **out**. The out-of-scope list is more valuable — it prevents `gather` from dragging in 40 tangential sources.

### 3. Surface the assumptions

List the assumptions the question is carrying. These become things later verbs test rather than inherit silently.

### 4. Write the falsification criteria

The sharpest question carries its own kill switch: **what evidence would change your mind?** Name it now, before any source is read, so `synthesize`/`interrogate` have a pre-registered bar instead of a movable one.

---

## Output

When no question is open, show the frame and ask the user to confirm it. Only then write `01-frame.md` to the engagement directory when one exists (otherwise present inline). The **Settled** section lists every question the user answered with what was decided (the recommendation itself when the answer was "yes"), so the next skill or a teammate reuses it instead of asking again:

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

## Settled
- Q1 <title>: <what was decided>
```

---

## Suggest next

Never auto-invoke.

- **After frame** → `research-lab:gather` to collect sources against the framed question (typical next move).
- **After frame** → `research-lab:understand` if the material already exists and only needs digesting.
