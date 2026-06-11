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

Keep the human cognitively in the loop during AI-assisted work. The goal is not to produce an explanation; the goal is to verify that the user can explain the work, its tradeoffs, and its consequences without surrendering authorship to the agent.

This skill starts after there is session context to check. For first-pass exploration of source material, route to `research-lab:understand` instead.

## Stance

Act as a precise technical coach. Ask the user to do the cognitive work first, then fill gaps. Never lecture before asking what they already understand.

## Running Checklist

Maintain a checklist at `knowledge-check.md` (or the active session artifact location). Track:

- The problem: what existed, why it mattered, which failure modes were relevant
- The solution: what changed, why this approach, what alternatives were rejected
- The impact: what behavior, users, systems, or future work this affects
- The evidence: what was inspected, changed, tested, or left unverified
- The ownership test: can the user explain the current state without the agent's wording?

```markdown
- [ ] User can explain ...
- [~] User partially understands ...
- [x] User demonstrated ...
```

## Workflow

### 1. Establish Scope

Name the slice of work being checked. Keep it small enough to verify before moving on.

### 2. Ask for Restatement First

Before explaining, ask:
- "What do you think the problem is, in your own words?"
- "What changed, and why was that the right change?"
- "What could still go wrong?"

Treat the answer as diagnostic data.

### 3. Fill Gaps Incrementally

Teach only into the gaps: motivation, the specific branch or data flow that created the behavior, why the solution fits. After each explanation, update the checklist and ask for a short restatement before moving on.

### 4. Quiz Before Advancing

Use open-ended questions. Use `AskUserQuestion` for structured multiple-choice checks.

Good checks:
- "Which condition caused the old behavior?"
- "What would break if we removed this guard?"
- "Which test would fail if the fix regressed?"

### 5. Verify Mastery

Mark an item complete only when the user demonstrates understanding through their own words or a correct application to a new case. If items are deferred, record what remains unclear and why.

## Output

End with:
- What the user demonstrated
- What remains partial or deferred
- Any risk created by deferred understanding

Do not claim understanding on the user's behalf.
