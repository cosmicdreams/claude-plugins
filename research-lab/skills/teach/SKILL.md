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

You don't understand something until you can make someone *who wasn't there* understand it. `teach`
is the **back** of the research arc: it takes a formed, hardened claim and makes it land with an
outside audience — a product manager, an exec, a non-developer stakeholder.

**The test is the spine; the materials are the deliverable; the spine certifies the deliverable.**
These are not in tension. For an internal-only researcher the materials are throwaway and only the
test matters. For outward communication the materials *are* the point — and the gate is what
guarantees they'll land *before* they go in front of anyone.

**Stance:** learner — the agent plays the naive student who won't accept jargon and has none of
your context. **Notebook persona:** `notebooklm configure --mode learning-guide` (a tutor).
**Audience:** outsiders — every artifact must **supply** context, never assume it.

---

## Input contract

- **Requires:** a formed claim / material **+ a named target audience.**
- **Resolves from:** context → file / notebook id.

## Preflight

1. Check context for a formed claim/material **and** a named audience. If both present, use them.
2. Else check for an arg: a file path or notebook id for the material; ask for the audience if it
   is not named.
3. Else **FAIL FAST**: "What am I explaining, and to whom? Give me the material (or a notebook id)
   and the target audience." Stop. Do **not** invoke another skill to manufacture either.

The **named audience** is part of the contract, not optional — the whole verb is audience-relative.
"A product manager", "a non-technical exec", "a new engineer on the team" each change what the artifact must
supply.

---

## The spine — the automated Feynman gate (Workflow)

The user invoked this skill, which **explicitly instructs a `Workflow` call**. The gate is a small
pipeline: **produce artifact → fresh agent takes a quiz on it → grade.** Its correctness depends on
the agent being **fresh and context-isolated** — it must answer using *only the produced artifact*,
never this conversation, or the gate measures nothing.

1. **Build the quiz from the material** (sourced, not invented) and shape it into the
   `[{q, answer}]` array the Workflow consumes as `args.quiz`:
   - **If a notebook is in play:**
     ```bash
     notebooklm generate quiz -n NOTEBOOK_ID --difficulty medium
     ```
     Read its questions and reference answers and convert them into `[{q, answer}]`.
     (`generate flashcards` is a useful secondary probe.)
   - **If there is no notebook** (the contract also accepts a plain file / pasted material): write 3–5
     comprehension questions and their reference answers directly *from the material* into the same
     `[{q, answer}]` shape.
   Either way you now hold `quiz` as `[{q, answer}]` — pass it, the artifact, and the audience as the
   Workflow `args`.
2. **A fresh, no-context Workflow `agent()` takes the quiz using only the artifact.** Its score is
   the comprehension measure. If it passes, the artifact supplies enough context to stand alone in
   front of your stakeholder. If it fails, you've found exactly where the explanation assumes
   knowledge the audience won't have — *before* the meeting, not during it.

### Reference Workflow script

```javascript
export const meta = {
  name: 'teach-feynman-gate',
  description: 'Produce an explainer artifact and certify it with a fresh-agent comprehension quiz',
  phases: [{ title: 'Gate' }],
}
// args: { artifact: "<the produced briefing/deck text>", quiz: [{q, answer}], audience: "a product manager" }
const GRADE = {
  type: 'object',
  properties: {
    score:     { type: 'number' },                 // fraction correct, 0..1
    misses:    { type: 'array', items: { type: 'string' } }, // where the artifact assumed context
    verdict:   { type: 'string', enum: ['lands', 'revise'] },
  },
  required: ['score', 'misses', 'verdict'],
}
const grade = await agent(
  `You are "${args.audience}" with NO prior context. Read ONLY this artifact, then answer the quiz. ` +
  `Mark where the artifact assumed knowledge you don't have.\n\nARTIFACT:\n${args.artifact}\n\n` +
  `QUIZ:\n${JSON.stringify(args.quiz)}`,
  { label: 'feynman-quiz', phase: 'Gate', schema: GRADE }
)
return grade   // verdict 'revise' + misses tells you exactly what to fix
```

If the gate returns `revise`, fix the named gaps in the artifact and re-run. The `misses` list is
the punch-list — each is a place the explanation leaked your context.

---

## The materials — the deliverable (sourced from the material)

Produce the artifact that fits the audience and channel. Prefer NotebookLM's native generators —
they cite the actual sources and supply context by construction:

```bash
notebooklm generate report -n NOTEBOOK_ID --format briefing-doc   # product manager briefing
notebooklm generate slide-deck -n NOTEBOOK_ID                     # stakeholder meeting
notebooklm revise-slide -n NOTEBOOK_ID ...                        # iterate the deck
notebooklm generate audio -n NOTEBOOK_ID                          # async consumption
notebooklm generate infographic -n NOTEBOOK_ID                    # exec one-pager
notebooklm generate flashcards -n NOTEBOOK_ID                     # secondary comprehension probe
```

| Audience / channel | Artifact |
|---|---|
| product manager, written | briefing doc (`generate report --format briefing-doc`) |
| Stakeholder meeting | slide deck (`generate slide-deck` + `revise-slide`) |
| Async / commute | audio overview (`generate audio`) |
| Exec one-pager | infographic (`generate infographic`) |

---

## Why the comprehension probe belongs here and not in synthesize

It's about audience and *what is being tested*. `synthesize` produces a correct claim for insiders
who already share your context; `interrogate` already proved it's right. The quiz tests something
different — whether the **explanation transfers** to someone *without* your context. That question
is only meaningful for an outside audience, which is the definition of `teach`. Running the quiz
inside `synthesize` would test whether people who already understand the material understand it — a
category error.

Two independent failure modes: **synthesize/interrogate guard against being *wrong*; teach guards
against being *incomprehensible*.** A claim can be correct and still fail to teach. The quiz catches
the second failure, invisible to synthesize.

> **synthesize proves you're right; teach proves you can make someone else see it.**

---

## Chaining

`teach` is usually terminal — the artifact is the deliverable. Suggest (never auto-invoke):

- **If the gate keeps returning `revise`** the claim itself may be the problem, not the explanation → `research-lab:interrogate` to re-check the claim, or `research-lab:synthesize` to reshape it.
- **To publish the engagement notebook**: `notebooklm share --public` / set `view-level`.
