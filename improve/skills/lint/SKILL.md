---
name: lint
description: >
  Check processes against known problem patterns and manage the lint ruleset — scan for
  known issues, add rules from observations, promote or demote rules between confidence
  tiers. Domain plugins augment it via their own :improve skill. Not for fixing
  (improve:fix).
triggers:
  - "check for process issues"
  - "lint this process"
  - "show lint rules"
  - "add a lint rule"
  - "improve:lint"
---

# Lint: Process Pattern Checking

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Check processes against known problem patterns (lint rules) and manage the lint ruleset. Provides global/default rules that apply across all domains. Domain plugins augment with their own rules via their :improve skill. Use to scan for known issues, add new rules from observations, promote/demote rules between confidence tiers, or review the current ruleset. Do NOT use for making fixes — use improve:fix for that.

Check processes against known problem patterns. Manage the ruleset that represents accumulated expertise.

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
source: <how this rule was learned>
---

## Problem
## Detection
## Fix
```

## Rule Tiers

| Tier | Behavior | Promotion criteria |
|---|---|---|
| **auto-fix** | Apply the fix without asking. Log what changed. | Human explicitly authorized, OR confirmed 3+ times with successful fixes |
| **warn** | Surface to human with evidence. Wait for guidance. | Default for recurring patterns |
| **watch** | Log when seen. Don't act, don't surface. | Default for first-time observations |
| **warn-permanent** | Like warn, but never auto-promote. | Human explicitly said "always ask me about this" |

## Propagation Table

Where lint rules and rtk/headroom integrations apply across the plugin ecosystem:

| Plugin | Lint applies | rtk applies | headroom applies |
|---|---|---|---|
| sprint | agents, skills, hooks | slice-worker and cross-reviewer Bash calls | — |
| retro | skills | — | transcript reads (JSONL files >100k tokens) |
| research-lab | skills (preflight-contract rule) | — | understand/gather: pasted text walls |
| ideate | skills | — | — |
| improve | agents, skills | Bash in scripts/agents | — |
| drupal-lab | agents, skills | phpunit/phpcs/phpstan in scripts and agents | — |
| ideas-funnel | skills | — | ingest: large raw articles |
| admin | skills | — | — |
| workshop | skills | — | — |

rtk and headroom are **optional accelerators**. Every integration preflights with `command -v rtk` / `command -v headroom` and degrades silently when absent.

## Checking a Process

### 1. Load rules

Read all rules from `${CLAUDE_PLUGIN_ROOT}/skills/lint/references/rules/`.

### 2. Load domain rules

If a domain `:improve` skill exists, invoke it — domain rules augment global rules.

### 3. Evaluate each applicable rule

For each rule where `applies-to` matches:
1. Run the detection steps
2. If pattern found:
   - **auto-fix**: invoke `improve:fix` immediately, log what changed
   - **warn**: report to human with evidence and suggested fix
   - **watch**: log the observation, don't act

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

1. Create file in `${CLAUDE_PLUGIN_ROOT}/skills/lint/references/rules/` with structure above
2. Initial tier:
   - Human said "always fix this" → `auto-fix`
   - Human said "always ask" → `warn-permanent`
   - Recurring pattern → `warn`
   - First observation → `watch`

### Promoting a rule

1. `watch` seen 2+ times → propose promotion to `warn`
2. `warn` fixed successfully 3+ times → propose promotion to `auto-fix`
3. Never promote `warn-permanent`

Surface evidence to human before promoting:
```
Lint rule "<name>" triggered N times. Current: <tier>. Proposed: <tier>.
Evidence: <list>
Promote? [requires confirmation]
```

### Demoting a rule

If an auto-fix rule causes problems: demote to `warn` immediately, record what went wrong, surface to human.
