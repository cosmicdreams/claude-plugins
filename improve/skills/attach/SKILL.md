---
name: attach
description: >
  Map the topology of a process — discover which files, agents, skills, hooks, crons, and
  configurations constitute it. Produces a topology map that other improve skills use to
  know where to make changes. Use when first engaging with a process, when asked to
  "attach to" or "map" a process, or when you need to understand what a process consists of.
  Do NOT use for making changes — use improve:fix for that.
triggers:
  - "attach to"
  - "map this process"
  - "what does this process consist of"
  - "improve:attach"
---

# Attach: Map Process Topology

Before you can improve a process, you need to know what it's made of. This skill discovers and maps the constituent parts of any process in the plugin ecosystem.

## What You're Mapping

A "process" is anything that runs over time to achieve a purpose:
- A sprint pipeline (agents, board, hooks, skills)
- An ideas funnel (cron stages, scoring, promotion)
- A drover watch loop (triage, implementation, verification)
- A single agent's workflow during a task
- A skill's execution path

## Discovery Steps

### 1. Identify the entry point

Where does the process start? A skill invocation, a cron, a hook, an agent spawn? Find it.

### 2. Trace the components

From the entry point, trace what gets invoked:

| Component type | Where to look | What to record |
|---|---|---|
| Agents | `<plugin>/agents/*.md` | Name, model, tools, purpose |
| Skills | `<plugin>/skills/*/SKILL.md` | Name, triggers, what it does |
| Hooks | `<plugin>/hooks/hooks.json` | Event, script path, what it does |
| Crons | Active cron loops | Schedule, what it invokes |
| Config files | `.claude/`, `.local.md`, vault | What parameters are tunable |
| Board/state | `.beads/`, state files | What state the process reads/writes |
| External deps | CLIs, APIs, DDEV | What external tools are required |

### 3. Check for a domain improve skill

If a domain `:improve` skill exists (e.g. `sprint:improve`, `drover:improve`), invoke it — it knows the topology better than generic discovery.

### 4. Identify the purpose

Every process exists to achieve something. State it explicitly:
- "This sprint pipeline exists to take issues from ready to done with quality gates"
- "This ideas funnel exists to surface novel AI ecosystem ideas with merit"
- "This drover loop exists to detect, triage, and fix Drupal errors automatically"

The purpose statement is what all improvement is measured against.

### 5. Output the topology map

Write a structured summary. Format:

```
## Process: <name>
**Purpose:** <one sentence>
**Entry point:** <how it starts>
**Components:**
- Agent: <name> (<plugin>/agents/<file>) — <purpose>
- Skill: <name> (<plugin>/skills/<dir>/SKILL.md) — <purpose>
- Hook: <event> (<plugin>/hooks/scripts/<file>) — <purpose>
- Config: <path> — <what it controls>
- State: <path> — <what it tracks>
**Tunable parameters:** <list of things that can be changed>
**Known constraints:** <DDEV slots, API limits, model costs, etc.>
```

This map is what `improve:fix` uses to know where to make changes and what `improve:lint` uses to know what to check.
