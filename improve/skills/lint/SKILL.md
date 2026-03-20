---
name: lint
description: >
  Check processes against known problem patterns (lint rules) and manage the lint ruleset.
  Provides global/default rules that apply across all domains. Domain plugins augment with
  their own rules via their :improve skill. Use to scan for known issues, add new rules
  from observations, promote/demote rules between confidence tiers, or review the current
  ruleset. Do NOT use for making fixes — use improve:fix for that.
triggers:
  - "check for process issues"
  - "lint this process"
  - "show lint rules"
  - "add a lint rule"
  - "improve:lint"
---

# Lint: Process Pattern Checking

Check processes against known problem patterns. Manage the growing ruleset that represents your accumulated expertise.

## Rule Structure

Each lint rule lives in `${CLAUDE_PLUGIN_ROOT}/skills/lint/references/rules/` as an individual markdown file:

```markdown
---
id: <unique-id>
name: <short name>
tier: auto-fix | warn | watch | warn-permanent
applies-to: agent | skill | hook | cron | any
pattern: <what to look for>
created: <ISO date>
source: <how this rule was learned — observation, coaching, experiment>
---

## Problem
<What the pattern looks like and why it's a problem>

## Detection
<How to detect this pattern — what to grep for, what to check in logs, what to look for in definitions>

## Fix
<What to change and where — specific enough that improve:fix can act on it>
```

## Rule Tiers

| Tier | Behavior | Promotion criteria |
|---|---|---|
| **auto-fix** | Apply the fix without asking. Log what was changed. | Human explicitly authorized, OR pattern confirmed 3+ times with successful fixes |
| **warn** | Surface to human with evidence. Wait for guidance. | Default for new recurring patterns |
| **watch** | Log when seen. Don't act, don't surface. | Default for first-time observations |
| **warn-permanent** | Like warn, but never auto-promote. | Human explicitly said "always ask me about this kind of thing" |

## Checking a Process

### 1. Load rules

Read all rules from `${CLAUDE_PLUGIN_ROOT}/skills/lint/references/rules/`.

### 2. Load domain rules

If a domain `:improve` skill exists for the process being checked, invoke it to get domain-specific rules. Domain rules augment global rules — they don't replace them.

### 3. Evaluate each applicable rule

For each rule where `applies-to` matches the component type:
1. Run the detection steps
2. If the pattern is found:
   - **auto-fix**: invoke `improve:fix` immediately. Log what was changed.
   - **warn**: report to human with the evidence and suggested fix
   - **watch**: log the observation. Don't act.

### 4. Report

```
## Lint Results: <process name>
- <N> auto-fixed (list what changed)
- <N> warnings (list with evidence)
- <N> watched (list for the record)
- <N> clean
```

## Managing Rules

### Adding a new rule

When you observe a pattern or the human teaches you one:

1. Create a new file in `${CLAUDE_PLUGIN_ROOT}/skills/lint/references/rules/` with the structure above
2. Set the initial tier:
   - Human said "always fix this" → `auto-fix`
   - Human said "always ask about this" → `warn-permanent`
   - Recurring pattern → `warn`
   - First observation → `watch`

### Promoting a rule

When evidence accumulates:

1. A `watch` rule seen 2+ times → propose promotion to `warn`
2. A `warn` rule successfully fixed 3+ times → propose promotion to `auto-fix`
3. Never promote a `warn-permanent` rule

To propose promotion, surface the evidence to the human:
```
Lint rule "<name>" has been [triggered N times / fixed successfully N times].
Current tier: <tier>. Proposed: <new tier>.
Evidence: <list of instances>
Promote? [This requires your confirmation]
```

### Demoting a rule

If a fix made by an auto-fix rule causes problems:
1. Immediately demote to `warn`
2. Record what went wrong in the rule file
3. Surface to the human
