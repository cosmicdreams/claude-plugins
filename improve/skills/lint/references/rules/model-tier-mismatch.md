---
id: lint-003
name: model-tier-mismatch
tier: warn
applies-to: agent
pattern: Agent model tier doesn't match the complexity of its work
created: 2026-03-20
source: Coaching — cost optimization; opus for routine work is wasteful, haiku for judgment work is insufficient
---

## Problem

An agent is assigned a model tier that doesn't match its actual workload:
- **Opus for routine work** — paying for capability the agent doesn't use (log reading, simple edits, board operations)
- **Haiku for judgment-heavy work** — insufficient capability for tasks requiring nuanced analysis, complex debugging, or architectural decisions

## Detection

Review agent definition:
1. Read the agent's responsibilities and typical tasks
2. Classify the work complexity:
   - **Routine**: file reading, board operations, simple edits, log parsing → haiku
   - **Moderate**: code analysis, pattern matching, multi-step workflows → sonnet
   - **Complex**: architectural decisions, nuanced debugging, creative problem-solving → opus
3. Compare against the `model:` field in frontmatter

## Fix

Change the `model:` field in the agent's frontmatter. This is a warn-tier rule because model changes can affect output quality — the human should confirm before switching, especially when downgrading.

When proposing a change, include:
- Current model and why it's mismatched
- Proposed model and expected impact
- Risk assessment (what could degrade if the model is too small)
