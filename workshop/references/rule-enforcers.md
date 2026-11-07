# Rule-to-enforcer table

Each workflow rule paired with what enforces it. `workshop:harden` maintains this table and `scripts/rule_table.py check` validates it.

- **Level** is one of `architecture`, `hook`, `schema`, `lint`, `test`, `prose`.
- **Enforcer** names the check (path or plugin). Required unless the level is `prose`.
- **Proven on** names the real past mistake the enforcer was seen to fail on. Required unless the level is `prose`.
- **Repeats** counts times a rule was broken after it was written down. A `prose` row with 2 or more repeats is a hardening candidate.

| Rule | Source | Level | Enforcer | Proven on | Repeats |
| --- | --- | --- | --- | --- | --- |
| A main worktree keeps no committable change | global instructions, golden rule | hook | `golden-rule` plugin (PreToolUse and PostToolUse guard) | fired in a live session on 2026-11-06, refusing a delegate call that named a main worktree path; its own suite covers edits and commits | 0 |
| Spell out acronyms on first use, except the blessed list | memory note `feedback_acronym_rule.md` | prose | | | 13 |
| Every stage of a multi-agent workflow restates the owner's permission limits | memory note `feedback_restate_limits_every_stage.md` | prose | | | 1 |
| Synthesis outputs become tracked cards immediately | memory note `feedback_synthesis_to_backlog.md` | prose | | | 1 |
