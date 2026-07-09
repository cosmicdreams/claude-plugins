---
name: ideas-funnel:decay
description: >
  Applies the ideas-funnel memory state machine: confidence decay, confirmation
  aging, hardened flag updates, at-risk transitions, and archive candidates.
  Trigger phrases: "decay funnel memory", "/ideas-funnel:decay".
triggers:
  - /ideas-funnel:decay
  - decay funnel memory
allowed-tools:
  - Bash
  - Read
  - Edit
  - Grep
  - Glob
---

**Used by:** nightly pipeline after ingest/refinery/lint + human for manual audits.

# ideas-funnel:decay

Apply memory evolution without inventing new claims.

## Rules

- Valid `state` values are `fresh`, `stable`, `at_risk`, `archived`.
- `hardened` is a boolean flag, never a `state`.
- `hardened: true` when `confidence >= 0.85` and `confirmation_count >= 10`.
- `hardened: true` pauses decay until contradiction.
- Fast half-life: 7 days; standard: 30 days; slow: 180 days; frozen: no decay.
- If confidence drops below `0.7`, `stable -> fresh`.
- If confidence drops below `0.4`, `fresh|stable -> at_risk`.
- If `at_risk` is older than 30 days with no review, mark `archived`.

## Scope

Scan:

- `Concepts/*.md`
- `Entities/*.md`
- `Domains/*/*.md`
- `Domains/*/Entities/*.md`
- `Bridges/*.md`

Do not modify `Sources/` unless explicitly asked.

## Output

Append a log entry:

```markdown
## [YYYY-MM-DD] decay | touched: N | stable: N | fresh: N | at_risk: N | archived: N | hardened: N
```

Return JSON:

```json
{
  "pages_touched": 0,
  "state_changes": 0,
  "at_risk": [],
  "archived": [],
  "hardened": []
}
```
