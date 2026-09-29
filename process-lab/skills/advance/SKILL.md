---
name: advance
description: >
  Carry out what the project's process requires at a gate — Jira transition, ticket comment,
  testing steps, links — or record a waiver with its reason. Also declares gates hooks cannot
  detect. Not for listing what is outstanding (process-lab:lint).
---

# Discharge an obligation

Hooks name what a gate requires; this skill does it. Rules for Jira are in `${CLAUDE_PLUGIN_ROOT}/references/jira-strategy.md` and apply unless the project's page says otherwise.

## 1. What is owed

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/process_lab.py" status --json [--ticket KEY]
```

For a gate detected by `declared` (for example, deployed for user acceptance testing), confirm with the user that it happened, then record it, which opens its obligations:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/process_lab.py" declare --gate <gate> [--ticket KEY]
```

Never infer that a declared gate was crossed. Ask.

## 2. Do each one

Work through the obligations the user wants to handle now:

- **Jira transition** — read the transitions offered for the issue now, apply the one the gate names, record its id. If it is not offered, stop and say so.
- **Ticket comment, testing steps, pull request link** — draft from the diff, commits, and test output. Post comments to internal tickets once the user has seen them. Anything a client can see is draft-then-approve: show it, let the user edit, send only on approval.
- **Anything else** — do what the obligation text says, or ask the user how this project does it.

After each one:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/process_lab.py" discharge --gate <gate> --obligation <id> --evidence "<what shows it was done>" --actor agent [--ticket KEY]
```

Evidence is concrete: a transition id, a comment link, a pull request URL.

## 3. Or waive it

When the obligation does not fit this change, record why rather than skipping it. The reason must say something a teammate could argue with ("configuration-only change, no user-facing behavior"), not "not needed".

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/process_lab.py" waive --gate <gate> --obligation <id> --reason "<why>" --actor human [--ticket KEY]
```

Only the user decides to waive. Waiver reasons feed `process-lab:codify`.

Whenever you pass `--ticket` to `status`, pass the same `--ticket` to every `discharge`, `waive`, and `declare` that follows, so work on one ticket is never recorded against the branch's ticket.

## 4. When a ticket comes back

Pushing again does not reopen anything; repeat pushes are normal. When a ticket is sent back (rejected in testing, rejected by the client, certification failed), reopen the gates it must pass again, with the reason:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/process_lab.py" reopen --gate <gate> --reason "<why it came back>" [--ticket KEY]
```
