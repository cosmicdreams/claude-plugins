---
name: delegate
description: >
  Select a permitted current model and effort for bounded funnel work.
  Not for health diagnosis; use ideas-funnel:supervise.
---

# Route funnel work

Before every model stage and between batches run `~/bin/allowance --json` (or `scripts/health.py`). All windows of the selected pool must be known, nonnegative, less than 360 minutes old, not stale and at least 20% remaining. Missing or stale data is unavailable. Stop launching at the floor; a preflight cannot guarantee future spend. Record before/after readings without inventing token-to-percentage conversion. Jev is optional external spend with its existing fallback, never called by pulls.

Read current global tier policy and `~/.claude/model-access.md`; inspect the target provider's active account/configuration, never infer it from the parent. Consult live `orchestrator_capabilities` before selection under host refresh rules. Use tiers 1–5 only, never Fable. Do not embed model defaults in domain configs. Select the current tier primary and explicit effort from live option IDs; fallback only as global policy permits. Unknown coverage is not proof of subscription coverage.

- Inventory, URL dedup and collection: deterministic scripts.
- Bounded ingest proposals: tier 3.
- Refinery on three unrelated sources: tier 4.
- Rule-detected failures, conflicts or stale backlog requiring judgment: tier 5.

T3 uses `delegate_task`, shared isolation, with a self-contained packet: task, files, cap, acceptance criteria, no writes, no subdelegation, verification and return schema. Follow returned `next`; dispatch success is not completion. Never create a child's checkout or substitute a command-line agent when delegation fails. Report a manual work packet instead, with automatic ingest disabled.

Return actual provider/model/effort, route reason, allowance readings, items processed, failures and unknowns. Unknown model availability stops that stage.

Check the selected Claude provider configuration directory explicitly. `allowance` reads `CLAUDE_CONFIG_DIR`; do not use a personal-account reading to authorize work-account dispatch. If the selected account has no fresh reading, skip that pool. Do not switch accounts to bypass policy.
