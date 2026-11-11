---
name: harden
description: >
  Turn a mistake agents keep repeating into a check that makes it impossible, choosing the
  highest enforcement level that works and proving the check fails on a real past mistake.
  Keeps the rule-to-enforcer table, for your own workflow or for one repository's AGENTS.md.
  Not for changing a team project's Confluence process page
  (process-lab:codify).
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# workshop:harden

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Use when the same correction has been given twice ("you did it again", "how many times", "make this impossible", "harden this", "stop agents doing X"), when a retro or reflection produces a lesson a script could enforce, or when a rule in the table has no enforcer and was broken anyway. Works on the user's own workflow and plugins, and on one repository's own checks when its history shows the same mistake twice. For a team project's written process, hand the change to process-lab:codify instead.

Assume every contributor is an agent that sees only the files it opened, copies the nearest example, and takes the shortest path that works. Written rules do not stop that agent; checks do. The method comes from pstack's `correct` skill (Lauren Tan, MIT).

## 1. Find the mistake classes

Read the evidence: recent corrections in memory notes, the progress log, reverted commits, review comments, and the rules in [the table](../../references/rule-enforcers.md). Group the mistakes into classes. A class counts once it has happened twice. A rule already in the table with level `prose` that was broken again is a repeat: it qualifies at once.

Run the table check to list the open repeats:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/rule_table.py" check
```

For a repository, collect its evidence first. The script lists fix and revert commits with their files, failed CI runs, inline review comments (bots included) and the review-loop ledgers saved for that repository:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/mine_evidence.py" --repo <path> --since <YYYY-MM-DD>
```

Group the results yourself. Skip noise: transient CI errors, checks already fixed, and bot findings dismissed with a reason. A repository's table is the "Rules and their enforcers" table in its `AGENTS.md`; check it with `rule_table.py check --table <repo>/AGENTS.md`.

## 2. Pick the highest level that works

Try each level in order and stop at the first that can hold the rule:

1. **architecture**: remove the way to make the mistake. One owner per piece of state, one supported way per task, delete the old way an agent would copy.
2. **hook**: a Claude Code hook or guard refuses the action and its message names the fix.
3. **schema**: a type, schema or validator makes the bad state unwritable.
4. **lint**: a check or continuous integration job fails, and its error names the file or command to use instead. If the pattern is already common, fail only when a change adds more.
5. **test**: a test that fails when the behavior breaks and passes when only internals change.
6. **prose**: an instruction file or memory note. Use only for judgment calls nothing can check.

Record why each higher level did not work.

## 3. Prove it bites

Replay the recorded past mistake against the new check and watch it fail. Prove it against what ships, not a stand-in: a pre-commit check reads the index, not the working tree; a dependency check counts what the deploy installs; a config check covers every collection the import writes. A check that has never been seen to fail on a real mistake is not an enforcer yet: tests that pass are not enough, because a guard can pass its tests and never fire in a real session. Where the check is a hook, prove it in a live session as well as in the test suite. Exceptions go on the offending line with a reason and an expiry date.

Ship each class as its own pull request in a dedicated worktree, under the repository's normal review.

## 4. Keep the table

Update [rule-enforcers.md](../../references/rule-enforcers.md), or the repository's `AGENTS.md` table in repository mode: one row per rule with its source, level, enforcer, where it runs and the past mistake it was proven on. Bump `Repeats` when a prose rule is broken again. Drop a row once its mistake cannot happen. Record where each enforcer runs. In repository mode, treat a `local` enforcer as prose until CI backs it: a git hook or a command someone has to remember does not run for every contributor, and a global `core.hooksPath` silently skips the repository's hooks. The check lists these rows under `local_only`. Run the check again; it fails on a malformed row or a non-prose row without an enforcer, where it runs, or proof.

## Reply

Each class with its evidence, the level chosen and why a higher level did not work, the proof that the check failed on the past mistake, and the table rows changed.
