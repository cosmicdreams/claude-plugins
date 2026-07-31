---
name: interviews
description: >
  Reference for the retro interview schema embedded in sprint Workflow output — what
  fields slice-workers and cross-reviewers emit, and how to verify results.json coverage.
  Interviews are collected inline by sprint:run, not by this skill.
---

# Retro Interview Schema

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Documents the retro interview schema embedded in sprint Workflow output. Use when reviewing the interview schema, understanding what retro fields slice-workers and cross-reviewers emit, or verifying results.json coverage. Trigger phrases include "retro interview schema", "what interview fields do agents emit", "verify interview coverage", "retro interview". Do NOT use to trigger agent shutdown or collect interviews manually — interviews are collected inline by sprint:run.

Sprint agents emit retro interview data as structured fields in the sprint Workflow output schema. No shutdown ceremony, no shutdown-imminent messages. Interviews land in `analysis-reports/retro-session/<YYYY-MM-DD>+<sprint>/results.json` alongside slice and review results.

## Where Results Live

```
analysis-reports/retro-session/<YYYY-MM-DD>+<sprint>/results.json
```

`retro:session` reads this file. No separate interview files per agent.

## Slice-Worker `retro_interview` Fields

These fields are required in every slice-worker's structured output:

| Field | Signal | Description |
|-------|--------|-------------|
| `what_worked` | KEEP | What was the single most effective thing this session — a practice, tool, or interaction that worked well and should be repeated? One sentence. |
| `what_didnt` | IMPROVE | What was the biggest obstacle or friction point? One sentence. |
| `technical_insight` | LEARN | What non-obvious technical knowledge did you discover this session that would help a future agent working on similar issues? |
| `one_change.change` | IMPROVE | If you could change ONE thing about how the team works for next session, what would it be? Specific, implementable action. |
| `one_change.category` | IMPROVE | TOOLING / COMMUNICATION / TESTING / WORKFLOW / INFRASTRUCTURE |
| `one_change.expected_impact` | IMPROVE | What improves and by roughly how much. |
| `key_decision` | LEARN | For the most challenging issue: the key technical decision made, alternatives rejected, and confidence level (HIGH / MEDIUM / LOW). |
| `cross_issue_pattern` | LEARN | Recurring pattern, common root cause, or repeated approach noticed across issues. "N/A — single issue" if only one. |
| `workflow_friction` | LEARN | Biggest friction point, category (TOOLING / COMMUNICATION / TESTING / CONTEXT_SWITCHING / WAITING), and time impact. |

## Cross-Reviewer `retro_interview` Fields

These fields are required in every cross-reviewer's structured output:

| Field | Signal | Description |
|-------|--------|-------------|
| `what_worked` | KEEP | Same as slice-worker. |
| `what_didnt` | IMPROVE | Same as slice-worker. |
| `technical_insight` | LEARN | Same as slice-worker. |
| `one_change` | IMPROVE | Same structure as slice-worker. |
| `failure_root_cause` | IMPROVE | For any failed validation: CODE_REGRESSION / TEST_DESIGN / INFRASTRUCTURE / HANDOFF_GAP / STANDARDS_ONLY / N/A |
| `handoff_quality` | IMPROVE | CLEAN / MINOR_GAPS / SIGNIFICANT_REWORK / BLOCKED |
| `infrastructure_friction` | IMPROVE | DDEV, environment, or tooling friction encountered, or "None". |

## Signal Mapping

| Field | Primary Signal | Secondary Signal |
|-------|---------------|-----------------|
| `what_worked` | KEEP | — |
| `technical_insight` | LEARN | — |
| `key_decision` | LEARN | IMPROVE (if low confidence) |
| `cross_issue_pattern` | LEARN | KEEP (if pattern is a good strategy) |
| `one_change` | IMPROVE | — |
| `what_didnt` | IMPROVE | — |
| `workflow_friction` | IMPROVE | — |
| `failure_root_cause` | IMPROVE | LEARN |
| `handoff_quality` | IMPROVE | LEARN |
| `infrastructure_friction` | IMPROVE | — |

## Verifying Coverage

```bash
cat analysis-reports/retro-session/<date>+<sprint>/results.json | jq '.results[].retro_interview | keys'
cat analysis-reports/retro-session/<date>+<sprint>/results.json | jq '.reviews[].retro_interview | keys'
```

`retro:session` proceeds with partial coverage and flags missing fields as process gaps.

## Obsidian Storage

After `retro:session` generates the report, the session skill archives results.json to the Neurons vault at:

```
Retrospectives/<YYYY-MM-DD>+<project-slug>+<sprint-slug>/results.json
```

Vault frontmatter:

```yaml
---
project: <project-slug>
sprint: <sprint-slug>
date: <YYYY-MM-DD>
tags: [retro, interviews]
---
```
