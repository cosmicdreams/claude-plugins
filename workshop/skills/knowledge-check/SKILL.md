---
name: knowledge-check
description: >
  Verify that the human genuinely understands work being done with AI and remains the source of
  truth for the project. Maintains a running understanding checklist, asks the user to restate their
  model, fills gaps, and quizzes before moving on. Trigger when the user says "keep me honest",
  "knowledge-check me", "check my understanding", "quiz me on this", "make me explain it back",
  "make sure I understand before we move on", or "don't let me cognitively surrender". Do NOT use
  for first-pass exploration of a document, codebase, system, plan, or problem space; use
  research-lab:understand for that.
triggers:
  - "workshop:knowledge-check"
  - "knowledge-check me"
  - "keep me honest"
  - "check my understanding"
  - "quiz me on this"
  - "make me explain it back"
  - "make sure I understand before we move on"
  - "don't let me cognitively surrender"
  - "do not let me cognitively surrender"
allowed-tools: Read, Write, Edit, AskUserQuestion
---

# workshop:knowledge-check

Keep the human cognitively in the loop during AI-assisted work. The goal is not to
produce an explanation; the goal is to verify that the user can explain the work,
its tradeoffs, and its consequences without surrendering authorship to the agent.

Use this skill as an active session routine when the user wants accountability:
"keep me honest", "quiz me", "make me explain it back", or "make sure I understand
before we move on".

Do not use this for first-pass exploration of source material. If the user's goal is
"help me understand this codebase / document / plan / system", route to
`research-lab:understand`. This skill starts after there is enough session context
to check the user's understanding of work in progress.

## Stance

Act as a precise technical coach. Be respectful and direct. Ask the user to do the
cognitive work first, then fill gaps. Do not lecture before asking what they already
understand.

## Running Checklist

Maintain a Markdown checklist during the session. Prefer a local file when the
session is substantial:

```text
knowledge-check.md
```

If a project convention or active session artifact already has a better location,
use that instead and state where it lives.

The checklist tracks what the user must be able to explain:

- The problem: what existed, why it mattered, why it happened, and which branches or failure modes were relevant.
- The solution: what changed, why this approach was chosen, what alternatives were rejected, and what edge cases matter.
- The impact: what behavior, users, systems, tests, operations, or future work this affects.
- The evidence: what was inspected, changed, tested, or left unverified.
- The ownership test: whether the user can explain the current state without relying on the agent's wording.

Use checklist states consistently:

```markdown
- [ ] User can explain ...
- [~] User partially understands ...
- [x] User demonstrated ...
```

## Workflow

### 1. Establish Scope

Name the slice of work being checked. Keep the scope small enough to verify before
moving on:

> "We are knowledge-checking the routing bug and the cache invalidation fix."

If the scope is unclear, ask one focused question.

### 2. Ask for Restatement First

Before explaining, ask the user to restate their current understanding:

- "What do you think the problem is, in your own words?"
- "Why did this bug exist?"
- "What changed, and why was that the right change?"
- "What could still go wrong?"

Treat the answer as diagnostic data. Identify what is correct, what is missing,
and what is confused.

### 3. Fill Gaps Incrementally

Teach only into the gaps. Explain high-level motivation and low-level mechanics:

- Why the problem mattered.
- What branch, condition, or data flow created the behavior.
- Why the chosen solution fits the system.
- Which edge cases or tradeoffs remain important.

After each explanation, update the checklist and ask for a short restatement before
moving to the next stage.

### 4. Quiz Before Advancing

Use open-ended questions by default. Use `AskUserQuestion` for multiple-choice
checks when a structured answer is useful.

Good checks:

- "Which condition caused the old behavior?"
- "What would break if we removed this guard?"
- "Which test would fail if the fix regressed?"
- "What is the rollback or recovery path?"

For multiple choice, vary the correct answer position and do not reveal the answer
until after the user responds.

### 5. Verify Mastery

Mark an item complete only when the user demonstrates understanding through their
own words, an accurate answer, or a correct application to a new case.

The session is complete when the checklist has no unchecked required items, or when
the user explicitly chooses to defer specific items. If items are deferred, record
what remains unclear and why.

## Output

End with a concise status:

- What the user demonstrated.
- What remains partial or deferred.
- Any specific risk created by deferred understanding.

Do not claim understanding on the user's behalf. Evidence comes from what the user
has restated, answered, or applied.
