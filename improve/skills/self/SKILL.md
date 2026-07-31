---
name: self
description: >
  Evaluate and improve any agent definition against its stated purpose — whether prompt,
  model, tools, and instructions align with what it is meant to achieve. Any agent may
  invoke it on itself.
triggers:
  - "improve this agent"
  - "evaluate agent definition"
  - "is this agent well-defined"
  - "improve yourself"
  - "improve:self"
---

# Self: Agent Definition Improvement

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Evaluate and improve any agent definition against its stated purpose. Checks whether an agent's prompt, model, tools, and instructions are aligned with what it's supposed to achieve. Can target any agent — including the process-engineer itself. Use when an agent seems to be underperforming, drifting from its role, or when you want to audit agent definitions proactively. Any agent can invoke this skill on itself.

Evaluate whether an agent definition is aligned with its purpose.

## Evaluation Framework

### 1. Read the definition

Full file: frontmatter (name, description, color, tools, model) and prompt body.

### 2. State the purpose

Derive from `description`, role section, and spawn context. Write: "This agent exists to ___."

### 3. Evaluate alignment

| Dimension | Question | Red flags |
|---|---|---|
| **Model** | Appropriate for the complexity? | Opus for routine work. Haiku for judgment-heavy work. |
| **Tools** | Has what it needs? Nothing it doesn't? | Missing tools referenced in prompt. Unused listed tools. |
| **Prompt length** | As long as needed, no longer? | Repeated sections. Instructions for things agent never does. |
| **Clarity** | Fresh instance knows what to do on first read? | Ambiguous or contradictory rules. |
| **Scope** | Not too much or too little? | Long lists spanning multiple concerns. |
| **Actionability** | Can act on instructions or are they aspirational? | "Should" and "consider" without concrete steps. |
| **Description quality** | Accurately triggers this agent? | Doesn't match what agent actually does. Too generic. |

### 4. Propose changes

```
Dimension: <which>
Finding: <what's misaligned>
Current: <what it says>
Proposed: <what it should say>
Rationale: <why this improves purpose alignment>
```

### 5. Apply changes

- Trivial fixes (typos, removing unused tools, tightening description): apply via `improve:fix`
- Substantive changes (rewriting sections, changing model tier): surface to human first
- Structural redesign (split, merge, retire): surface to human

### 6. Self-improvement

When evaluating the process-engineer's own definition: if the methodology has a gap, update the relevant skill, not just the definition. Apply the same trust model — don't auto-fix your own structural changes.

## Anti-patterns to check for

- **Compliance theater** — long "do not" lists that don't help the agent do its job
- **Context bloat** — instructions for rare edge cases loaded on every spawn
- **Stale references** — skills, files, or tools that no longer exist
- **Role confusion** — definition describes what it observes rather than what it does
- **Missing methodology** — agent knows its goal but not its method
- **Over-specification** — step-by-step instructions for things the model already knows
