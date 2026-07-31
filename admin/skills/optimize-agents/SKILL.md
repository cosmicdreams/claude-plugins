---
name: optimize-agents
description: >
  Audit agent definition files for stale tool syntax, outdated model references, and
  defensive-prose bloat. Not for writing new agents (admin:new-agent) or for reviewing
  skills.
---

# Optimize Agent Definitions

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Audits agent definition files for correctness and token efficiency. Checks for stale tool syntax, outdated model references, and defensive-prose bloat. Use when the user says "optimize agents", "review agent definitions", "check agent models", "are agents well-configured", "trim agent prompts", or "audit agents". NOT for creating new agents (use admin:new-agent) or for reviewing skill definitions.

Audit agent definitions for correctness and token efficiency. Remove stale references and bloat.

## Input

- Agent directory (default: `.claude/agents/`)
- Optional: specific agent file

## Step 1: Inventory

Read all `*.md` files in the agents directory. For each, extract:
- name, description, color, tools, model (from YAML frontmatter)
- Body line count

Flag agents missing required frontmatter fields: `name`, `description`, `color`, `tools`.

## Step 2: Model Audit (omit-to-inherit)

The correct default is to **omit the `model` field** — the agent inherits the session model, which is usually right. Only keep an explicit model override when it is clearly justified.

Flag agents with explicit model overrides and evaluate each:
- Is `haiku` appropriate? Only when the task is purely procedural: run a command, compare output against rules, report pass/fail. No code writing, no judgment calls.
- Is `sonnet` appropriate? When the agent writes code, makes judgment calls, or synthesizes information.
- Is `opus` or `fable` present? These should be rare. Flag for review — justify or remove.
- Is the value stale? Known stale values: `claude-opus-4`, `claude-sonnet-4`, `claude-3-5-sonnet-20241022`, `claude-3-haiku-20240307`, or any pinned date-versioned ID. Replace with tier name (`haiku`, `sonnet`, `opus`, `fable`) or remove to inherit.

## Step 3: Tool Syntax Audit

Flag stale SendMessage usage in agent bodies:
- Old schema: `type=`, `recipient=`, `content=` parameters
- Correct schema: `{to, summary, message}`

Flag agents referencing non-existent tools or tools they demonstrably never call.

## Step 4: Defensive-Prose Audit

Token efficiency target: 60–80 lines body. Flag agents over 100 lines for review.

Cut in order of savings:
1. **Anti-pattern walls** — blocks of "do NOT do X" rules. One statement per rule; delete repetition.
2. **Repeated warnings** — the same caution stated in multiple places.
3. **Behavioral coaching prose** — "Always be thorough", "Make sure to check", "Remember to". Replace with specific imperatives or delete.
4. **Role-playing text** — "You are a senior engineer with 15 years experience". Replace with responsibility list.
5. **Embedded output templates** — full markdown templates with placeholders. Replace with a 1–2 line structural description.
6. **Cross-agent boilerplate** — near-identical protocol blocks duplicated across 5+ agents. Extract to a shared reference.

Keep:
- Specific commands and exact syntax
- Communication format templates
- Decision criteria unique to this agent
- Numbered process steps
- Role-specific quality gates

## Step 5: Apply and Verify

For each agent:
1. Fix YAML frontmatter (missing fields, stale model values)
2. Fix SendMessage syntax if stale
3. Trim body if over 100 lines (preserve meaning, cut bloat)

Verify:
```bash
for f in .claude/agents/*.md; do
  name=$(basename "$f" .md)
  model=$(grep -m1 '^model:' "$f" | awk '{print $2}')
  lines=$(wc -l < "$f")
  echo "$name: model=${model:-inherited} lines=$lines"
done
```

## Decision Table

| Agent has explicit model | Evaluation |
|--------------------------|------------|
| None / omitted | Correct default — inherits session model |
| `haiku` | Keep only if purely procedural (no code, no judgment) |
| `sonnet` | Keep if code writing or judgment calls are central |
| `opus` / `fable` | Flag — justify or remove |
| Date-versioned ID | Replace with tier name or remove |
