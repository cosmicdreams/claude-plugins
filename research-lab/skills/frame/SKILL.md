---
name: frame
description: >
  Sharpen a vague topic into a precise research question with explicit scope, stated assumptions,
  and falsification criteria ("what would change my mind?"). The front-of-engagement verb — cheap,
  fast, runs first when it runs at all. Facilitator stance: it asks the sharpening questions, it
  does not answer them. Say "frame this", "sharpen this question", "what should I actually be
  asking", "scope this research", or "research-lab:frame". Not for gathering sources (that is
  gather) or forming a position (that is synthesize) — frame only sets up the question.
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

Turn a fuzzy topic into a sharp, falsifiable question. The **front** of the research arc
(`frame → gather → understand → synthesize → interrogate → experiment → teach`): it runs first
when it runs at all, and it is deliberately cheap. Framing was formerly buried in seminar's Step 1;
it is now its own verb so a vague goal gets sharpened *before* any sources are gathered.

**Stance:** facilitator — you ask the sharpening questions and reflect the user's answers back
into a tighter question. You do **not** answer the research question yourself; that is what the
rest of the arc is for.
**Model & fan-out:** solo, **Haiku**. Framing is light reasoning over a short input — no notebook,
no fan-out.

---

## Input contract

- **Requires:** a topic or fuzzy goal.
- **Resolves from:** context → arg.

## Preflight

1. Check context for a topic or goal already in play. If present, use it.
2. Else check for a topic passed as an arg.
3. Else (rare) **FAIL FAST**: "What's the topic you want to frame?" Stop.

This verb rarely fails its contract — almost any phrase is a framable topic. The work is
*sharpening* it, not finding it.

---

## Process

Work the topic down to a question the rest of the arc can actually act on. Four moves:

### 1. Find the real question

A topic ("Drupal caching") is not a question. Push until you have a question with a verb and a
decidable answer ("Does cache-tag granularity below the node level measurably improve CDN survival
after an edit, or just add invalidation overhead?"). Ask the user one or two pointed questions if
the intent is ambiguous — prefer a reasonable inference the user can correct over an interrogation.

### 2. Draw the scope line

State explicitly what is **in** scope and what is **out**. The out-of-scope list is the more
valuable one — it is what stops `gather` from dragging in 40 tangential sources.

### 3. Surface the assumptions

List the assumptions the question is carrying ("assumes the CDN honors `s-maxage`", "assumes edits
are the dominant invalidation event"). These become things later verbs test rather than inherit
silently.

### 4. Write the falsification criteria

The sharpest question carries its own kill switch: **what evidence would change your mind?** Name
it now, before any source is read, so `synthesize`/`interrogate` have a pre-registered bar instead
of a movable one.

---

## Output

A short framed-question record — present inline, and write `01-frame.md` to the engagement
directory when one exists:

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

Keep it to a screen. Framing is a setup, not a deliverable.

---

## Chaining

Frame is the setup; it hands a sharp question to the gathering/digesting verbs. Suggest (never auto-invoke):

- **After frame** → `research-lab:gather` to collect sources against the framed question (the typical next move).
- **After frame** → `research-lab:understand` if the material already exists and only needs digesting against the new question.

If the user has the `ideate` plugin installed, `ideate:brainstorm` is also a reasonable next step when the framed question is really an idea to generate against rather than a corpus to research.
