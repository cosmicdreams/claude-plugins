---
id: lint-004
name: missing-tools-declaration
tier: auto-fix
applies-to: agent
pattern: Agent definition frontmatter has no tools field
created: 2026-03-20
source: Process-engineer evaluation found 4 agents (experimentalist, researcher, principal-investigator, deep-debugger) with no tools field — invisible dependency on defaults that breaks silently if defaults change
---

## Problem

An agent definition's YAML frontmatter has no `tools:` field. The agent inherits whatever defaults the runtime provides, creating an invisible dependency. If defaults change, the agent silently loses capability with no error.

This is especially dangerous when the agent's prompt body references specific tools (e.g. "SendMessage to team-lead") that aren't guaranteed by defaults.

## Detection

For each agent definition file (`*/agents/*.md`):

1. Parse the YAML frontmatter (between `---` markers)
2. Check for the presence of a `tools:` field
3. If missing → this rule triggers

```bash
# Find agent definitions missing tools field
for f in $(find . -path '*/agents/*.md' -not -path '*/node_modules/*'); do
  if ! head -20 "$f" | grep -q '^tools:'; then
    echo "MISSING tools: $f"
  fi
done
```

## Fix

Add a `tools:` field to the frontmatter based on tool references in the prompt body:

1. Scan the prompt body for tool names (Read, Write, Edit, Bash, Grep, Glob, LSP, SendMessage, Skill, Agent, TaskCreate, TaskUpdate, TaskList, TaskGet, TeamCreate, CronCreate, etc.)
2. Add each referenced tool to the frontmatter `tools:` field
3. If no tools are explicitly referenced, add the minimum set for the agent's role:
   - Read-only agents: `Read, Glob, Grep`
   - Code editing agents: `Read, Write, Edit, Bash, Grep, Glob`
   - Coordinating agents: add `SendMessage, TaskUpdate, TaskList, TaskGet`
   - Agents that invoke skills: add `Skill`
