---
name: teach
description: >
  Make a formed claim land with someone who wasn't there. Produces the deliverable (briefing doc,
  slide deck, audio overview, infographic) AND certifies it with an automated Feynman gate: a quiz
  generated from the material, taken by a fresh no-context agent using only the produced artifact —
  the score is whether the explanation transfers. synthesize proves you're right; teach proves you
  can make someone else see it. Audience is outsiders, so artifacts must SUPPLY context (contrast
  synthesize, whose artifacts assume it). Say "teach this", "make a briefing", "explain this to a
  product manager", "build a deck for", "make this land", or "research-lab:teach". Needs a formed claim plus a
  named target audience.
triggers:
  - "teach this"
  - "make a briefing"
  - "explain this to"
  - "build a deck for"
  - "make this land"
  - "create an audio overview"
  - "research-lab:teach"
allowed-tools: Bash, Read, Write, Workflow
---

# Teach

Make a formed, hardened claim land with an outside audience. **The back** of the research arc.

**The test is the spine; the materials are the deliverable; the spine certifies the deliverable.**

**Stance:** learner — play the naive student who won't accept jargon and has none of your context.
**Notebook persona:** `notebooklm configure --mode learning-guide`.
**Audience:** outsiders — every artifact must **supply** context, never assume it.

---

## Input contract

- **Requires:** a formed claim / material **+ a named target audience.**
- **Resolves from:** context → file / notebook id.

## Preflight

1. Check context for a formed claim/material **and** a named audience. If both present, use them.
2. Else check for an arg: a file path or notebook id, and ask for the audience if not named.
3. Else **FAIL FAST**: "What am I explaining, and to whom? Give me the material and the target audience." Stop.

The **named audience** is part of the contract, not optional — the whole verb is audience-relative.

---

## Step 1 — Produce the artifact

Produce the artifact that fits the audience and channel. Prefer NotebookLM's native generators:

```bash
notebooklm generate report -n NOTEBOOK_ID --format briefing-doc   # product manager briefing
notebooklm generate slide-deck -n NOTEBOOK_ID                     # stakeholder meeting
notebooklm generate revise-slide -n NOTEBOOK_ID "<change>"        # iterate a deck slide
notebooklm generate audio -n NOTEBOOK_ID                          # async consumption
notebooklm generate infographic -n NOTEBOOK_ID                    # exec one-pager
notebooklm generate flashcards -n NOTEBOOK_ID                     # secondary comprehension probe
```

| Audience / channel | Artifact |
|---|---|
| product manager, written | briefing doc |
| stakeholder meeting | slide deck |
| async / commute | audio overview |
| exec one-pager | infographic |

When there is no notebook, produce the artifact from the material directly as prose or markdown.

---

## Step 2 — Build the quiz

Build 3–5 comprehension questions and reference answers from the material (not invented):

- **Notebook in play:** `notebooklm generate quiz -n NOTEBOOK_ID --difficulty medium` — parse into
  `[{q, answer}]`.
- **No notebook:** write questions directly from the material into the same `[{q, answer}]` shape.

---

## Step 3 — Run the Feynman gate (Workflow)

The user invoked this skill, which **explicitly instructs a Workflow call**. The gate agent must be
**fresh and context-isolated** — it answers using *only the produced artifact*, never this
conversation. That isolation is the correctness mechanism.

```javascript
export const meta = {
  name: 'teach-feynman-gate',
  description: 'Certify an explainer artifact with a fresh-agent comprehension quiz',
  phases: [{ title: 'Gate' }],
}
// args: { artifact: "<produced briefing/deck text>", quiz: [{q, answer}], audience: "<audience>" }
const GRADE = {
  type: 'object',
  properties: {
    score:   { type: 'number' },
    misses:  { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string', enum: ['lands', 'revise'] },
  },
  required: ['score', 'misses', 'verdict'],
}
const grade = await agent(
  `You are "${args.audience}" with NO prior context. Read ONLY this artifact, then answer the quiz. ` +
  `Mark where the artifact assumed knowledge you don't have.\n\nARTIFACT:\n${args.artifact}\n\n` +
  `QUIZ:\n${JSON.stringify(args.quiz)}`,
  { label: 'feynman-quiz', phase: 'Gate', schema: GRADE }
)
return grade
```

If `verdict` is `revise`, fix the `misses` in the artifact and re-run. Each miss is a place the
explanation leaked your context.

---

## Chaining

`teach` is usually terminal. Suggest (never auto-invoke):

- **If the gate keeps returning `revise`** → `research-lab:interrogate` to re-check the claim, or
  `research-lab:synthesize` to reshape it.
- **To publish the engagement notebook:** `notebooklm share public -n NOTEBOOK_ID --enable`
