---
id: lint-002
name: stale-tool-reference
tier: auto-fix
applies-to: agent
pattern: Agent definition references a tool, skill, or file path that no longer exists
created: 2026-03-20
source: Coaching — agents fail when directed to use nonexistent tools; fix is always to update the reference
---

## Problem

An agent's definition or a skill's instructions reference a tool, skill, command, or file path that has been renamed, moved, or removed. The agent will attempt to use it, fail, and either retry (wasting tokens) or get stuck.

## Detection

Grep agent definitions and skill files for:
- Skill names that don't match any installed skill
- File paths that don't resolve
- Tool names not in the agent's `tools:` frontmatter
- References to retired components

```bash
# Check if referenced skills exist
grep -r 'Skill("' <plugin>/agents/ | # extract skill names, verify each exists

# Check if referenced paths exist
grep -r 'references/' <plugin>/skills/ | # extract paths, verify each exists
```

## Fix

Update the reference to the current name/path. If the referenced component was removed without replacement, remove the reference and the instruction that depends on it.

This is an auto-fix rule because the fix is always mechanical (update the string) and low-risk (removing a broken reference can't make things worse).
