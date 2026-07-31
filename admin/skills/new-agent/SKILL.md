---
name: new-agent
description: >
  Write a brand-new agent definition — sprint team role, standalone specialist, or plugin
  agent. Not for editing, reviewing, listing, or optimizing existing agents
  (admin:optimize-agents).
triggers:
  - "create an agent"
  - "new agent"
  - "add a role"
  - "build an agent"
---

# Agent Creator

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Use when the user needs a brand-new agent written — any role, any plugin, any purpose. Trigger phrases: "new agent", "add an agent", "create an agent", "make an agent", "I need an agent", "add a role", "build an agent", "write an agent", "sprint agent for", "agent that does X". Covers sprint team roles, standalone specialist agents, and plugin agents. Do NOT use for editing existing agents, reviewing agent quality, listing agents, or optimizing agent definitions.

Build a standards-compliant agent definition and place it in the right location.

## Standards Reference

**Colors in use by sprint, admin, and drupal-lab plugins — do not reuse:**
| Agent | Color |
|-------|-------|
| team-lead | red |
| process-engineer | purple |
| issue-analyzer | cyan |
| implementer | orange |

**Check `.claude/agents/` for the full collision list before assigning a color.**

**Model selection:** Omit the `model` field to inherit the session model — correct when unsure.
- `haiku` — procedural/checklist work, runs tools and reports output, no code writing
- `sonnet` — writes code, makes judgment calls, synthesizes information
- `opus` / `fable` — only when sonnet demonstrably fails on large or long-running work

**Sprint tools (required if agent participates in team sprints):**
`SendMessage, TaskUpdate, TaskList, TaskGet`

## Checklist: Before Writing the File

Gather enough context to fill every section. You need at minimum:
- [ ] Agent's primary job (one sentence — becomes the description)
- [ ] Sprint agent or standalone? (determines Team Coordination section)
- [ ] Minimum tool set with a reason for each tool
- [ ] Model tier (or omit to inherit)
- [ ] 3–5 key process steps in order
- [ ] What role-specific errors to recover from (transient vs. permanent)
- [ ] 2–4 role-specific quality gates before marking work complete

If any item is unclear from context, ask one focused question. Do not generate the file with placeholder content.

## Agent Definition Template

```markdown
---
name: <kebab-case-name>
description: <one sentence: what it does and when to use it>
color: <unique color — check collision table and .claude/agents/ first>
tools: <comma-separated minimum set>
model: <haiku|sonnet|opus|fable — omit entirely to inherit>
---

# <Title Case Name>

## Capabilities
- <bullet per capability, specific and concrete>

## Process
1. <first step>
2. <second step>
3. <...>
4. Update task + message team-lead (see Team Coordination)

## Team Coordination (when in a team sprint)

**On task start:**
1. `TaskUpdate(taskId, status: in_progress, owner: "<agent-name>")` — claim immediately
2. Begin work

**On task complete:**
1. `TaskUpdate(taskId, status: completed)`
2. `SendMessage(to: "team-lead", summary: "<5-10 word preview>", message: "<completion message>")`
3. `TaskList` — check for next assigned task; if none, tell team-lead you're available

**If blocked:**
- `SendMessage(to: "team-lead", summary: "blocked, need input", message: "Blocked: [reason]. Need: [what].")` — immediately

## Error Recovery

**Transient** (retry once): [role-specific transient errors]
**Permanent** (escalate immediately): [role-specific permanent errors]

## Quality Gates

Before marking work complete:
- [ ] [role-specific gate]
- [ ] [role-specific gate]
```

**Rules:**
- Omit Team Coordination entirely if the agent will not be used in team sprints
- Error Recovery and Quality Gates are always required — fill with role-specific content
- Target 60–80 lines total

## Register

1. **Project-specific agent**: write to `.claude/agents/<name>.md` in the project root
2. **Plugin agent** (reusable across projects): write to the plugin's `agents/` directory and reinstall
