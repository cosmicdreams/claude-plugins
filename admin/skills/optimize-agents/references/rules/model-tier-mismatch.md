---
id: lint-003
name: model-tier-mismatch
tier: warn
applies-to: agent
pattern: Agent pins a model that is stale, denied for an account, or wrong for its work
created: 2026-03-20
source: Rewritten 2026-09-29 — the original haiku/sonnet/opus ladder predated current models and ignored per-account model coverage.
---

## Problem

The right default is no `model:` field: the agent inherits the session's model. A pinned model goes stale when models change, can be a model an account's subscription does not cover (it then bills against extra usage and later hard-fails), or can be too small for judgment-heavy work.

## Detection

For each agent with a `model:` field:

1. If `~/.claude/model-access.md` exists, check the value against its denylist for every account the plugin runs on. A denied model is always a finding.
2. Flag pinned, date-versioned identifiers and retired families.
3. Flag a small model on an agent whose job is judgment: review, debugging, synthesis, or writing for people.

## Fix

Remove the field so the agent inherits, unless there is a stated reason to pin (for example, a high-volume mechanical pass). If a pin stays, use a current alias and add a one-line reason in the body. Warn tier: model changes affect output, so a human confirms.
