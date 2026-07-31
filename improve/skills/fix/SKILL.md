---
name: fix
description: >
  Make a directed process change in the right place so it propagates to the running
  process — locate the target, edit, verify it takes effect. For when you already know
  what must change. Not for uncertain improvements (improve:experiment).
triggers:
  - "fix this process"
  - "make this change stick"
  - "improve:fix"
---

# Fix: Make a Directed Change That Sticks

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Make a directed process change in the right place so it propagates to the running process. Handles locating the target file, making the edit, and verifying the change takes effect. Use when you know what needs to change — either from your own observation, a lint rule, or because the human pointed at the problem. Do NOT use for uncertain improvements — use improve:experiment for those.

## Step 1: Locate the target

| Behavior | Where it lives |
|---|---|
| Agent prompt/instructions | `<plugin>/agents/<name>.md` |
| Agent model tier | Frontmatter `model:` |
| Agent tool access | Frontmatter `tools:` |
| Skill instructions | `<plugin>/skills/<name>/SKILL.md` |
| Skill reference data | `<plugin>/skills/<name>/references/<file>` |
| Hook behavior | `<plugin>/hooks/scripts/<script>` |
| Hook registration | `<plugin>/hooks/hooks.json` |
| Cron schedule | Managed via `/loop` |
| Plugin metadata | `<plugin>/.claude-plugin/plugin.json` |
| Project instructions | `CLAUDE.md` or `.claude/` config |
| Global instructions | `~/.claude/CLAUDE.md` or `~/.claude/me.md` |

Use a topology map from `improve:attach` if available; otherwise use Grep and Glob.

## Step 2: Make the edit

Read the target file first. Make the minimal change that addresses the problem. Preserve existing conventions.

## Step 3: Propagation

| Change type | Propagation | Action needed |
|---|---|---|
| Agent definition | Next spawn | None (running agents won't see it) |
| Skill SKILL.md | Next invocation | None |
| Skill reference | Next invocation that reads it | None |
| Hook script | Next hook event | Ensure executable (`chmod +x`) |
| hooks.json | Requires plugin reinstall | Run `reinstall-plugin.sh <plugin>` in a separate terminal, then `/reload-plugins` |
| plugin.json | Requires plugin reinstall | Same |
| CLAUDE.md | Immediate | None |

Plugin reinstall cannot be run from within a Claude Code session (CLAUDECODE env var blocks nested CLI). Tell the human and wait.

## Step 4: Verify

Re-read the file to confirm the edit. If reinstall is needed, tell the human. If testable, test.

## Recording the fix

After a successful fix: if this is a pattern, record it as a watch rule via `improve:lint`. If taught by the human, record their confidence-level guidance.
