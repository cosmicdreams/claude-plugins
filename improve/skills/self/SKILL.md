---
name: self
description: >
  Evaluate and improve any agent definition against its stated purpose. Checks whether an
  agent's prompt, model, tools, and instructions are aligned with what it's supposed to
  achieve. Can target any agent — including the process-engineer itself. Use when an agent
  seems to be underperforming, drifting from its role, or when you want to audit agent
  definitions proactively. Any agent can invoke this skill on itself.
triggers:
  - "improve this agent"
  - "evaluate agent definition"
  - "is this agent well-defined"
  - "improve yourself"
  - "improve:self"
---

# Self: Agent Definition Improvement

Evaluate whether an agent definition is aligned with its purpose and improve it if not.

This skill works on any agent definition file — not just the process-engineer. Any agent can invoke `improve:self` to evaluate its own definition.

## Evaluation Framework

### 1. Read the Definition

Read the full agent file: frontmatter (name, description, color, tools, model) and system prompt body.

### 2. State the Purpose

What is this agent supposed to do? Derive from:
- The `description` field in frontmatter
- The role section in the prompt
- The context in which it's spawned

Write it as one sentence: "This agent exists to ___."

### 3. Evaluate Alignment

Check each dimension against the purpose:

| Dimension | Question | Red flags |
|---|---|---|
| **Model** | Is the model tier appropriate for the complexity of this agent's work? | Opus for routine work (wasteful). Haiku for judgment-heavy work (insufficient). |
| **Tools** | Does the agent have the tools it needs? Does it have tools it doesn't need? | Missing tools it references in its prompt. Tools listed that it never uses. |
| **Prompt length** | Is the prompt as long as it needs to be and no longer? | Sections that repeat other sections. Instructions for things the agent never does. |
| **Clarity** | Would a fresh agent instance know what to do on first read? | Ambiguous instructions. Contradictory rules. References to undefined terms. |
| **Scope** | Does the agent try to do too much or too little? | Long lists of responsibilities that span multiple concerns. |
| **Actionability** | Can the agent act on its instructions, or are they aspirational? | "Should" and "consider" without concrete steps. Goals without methods. |
| **Description quality** | Does the frontmatter description accurately trigger this agent? | Description doesn't match what the agent actually does. Too generic. |

### 4. Propose Changes

For each misalignment found, propose a specific edit:

```
Dimension: <which dimension>
Finding: <what's misaligned>
Current: <what it says now>
Proposed: <what it should say>
Rationale: <why this improves purpose alignment>
```

### 5. Apply Changes

Based on trust model:
- **Trivial fixes** (typos, removing unused tools, tightening description): apply directly via `improve:fix`
- **Substantive changes** (rewriting prompt sections, changing model tier): surface to human first
- **Structural redesign** (agent should be split, merged, or retired): definitely surface to human

### 6. Self-Improvement Special Case

When evaluating the process-engineer's own definition:
- Be honest about gaps — the point of self-improvement is to find them
- If your methodology has a gap, update the relevant skill not just your own definition
- Apply the same trust model — don't auto-fix your own structural changes

## Anti-Patterns in Agent Definitions

Common issues to check for:

- **Compliance theater** — Long lists of "do not" rules that don't help the agent do its job
- **Context bloat** — Instructions for rare edge cases loaded on every spawn
- **Stale references** — References to skills, files, or tools that no longer exist
- **Role confusion** — Agent definition describes what it observes rather than what it does
- **Missing methodology** — Agent knows its goal but not its method
- **Over-specification** — Step-by-step instructions for things the model already knows how to do
