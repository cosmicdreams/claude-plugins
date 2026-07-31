---
name: attach
description: >
  Map the topology of a process — which files, agents, skills, hooks, crons, and configs
  constitute it — producing the map other improve skills use to know where to change
  things. Not for making changes (improve:fix).
triggers:
  - "attach to"
  - "map this process"
  - "what does this process consist of"
  - "improve:attach"
---

# Attach: Map Process Topology

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Map the topology of a process — discover which files, agents, skills, hooks, crons, and configurations constitute it. Produces a topology map that other improve skills use to know where to make changes. Use when first engaging with a process, when asked to "attach to" or "map" a process, or when you need to understand what a process consists of. Do NOT use for making changes — use improve:fix for that.

Discover and map the constituent parts of a process before improving it.

## Discovery Steps

### 1. Identify the entry point

Where does the process start? A skill invocation, cron, hook, or agent spawn?

### 2. Trace the components

| Component type | Where to look | What to record |
|---|---|---|
| Agents | `<plugin>/agents/*.md` | Name, model, tools, purpose |
| Skills | `<plugin>/skills/*/SKILL.md` | Name, triggers, what it does |
| Hooks | `<plugin>/hooks/hooks.json` | Event, script path, what it does |
| Crons | Active cron loops | Schedule, what it invokes |
| Config | `.claude/`, vault | Tunable parameters |
| Board/state | `.beads/`, state files | What state the process reads/writes |
| External deps | CLIs, APIs, DDEV | Required external tools |

### 3. Check for a domain improve skill

If `<domain>:improve` exists, invoke it — it knows the topology better than generic discovery.

### 4. State the purpose

Write it explicitly: "This process exists to ___." All improvement is measured against this.

### 5. Output the topology map

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
**Tunable parameters:** <list>
**Known constraints:** <DDEV slots, API limits, model costs, etc.>
```
