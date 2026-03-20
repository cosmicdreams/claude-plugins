---
name: fix
description: >
  Make a directed process change in the right place so it propagates to the running process.
  Handles locating the target file, making the edit, and verifying the change takes effect.
  Use when you know what needs to change — either from your own observation, a lint rule,
  or because the human pointed at the problem. Do NOT use for uncertain improvements —
  use improve:experiment for those.
triggers:
  - "fix this process"
  - "make this change stick"
  - "improve:fix"
---

# Fix: Make a Directed Change That Sticks

You know what to change. This skill handles the mechanics: find the right file, make the edit, ensure propagation, verify effect.

## Step 1: Locate the Target

Every process behavior lives in a file. Map the problem to its source:

| Behavior | Where it lives |
|---|---|
| Agent prompt/instructions | `<plugin>/agents/<name>.md` |
| Agent model tier | Frontmatter `model:` in agent definition |
| Agent tool access | Frontmatter `tools:` in agent definition |
| Skill instructions | `<plugin>/skills/<name>/SKILL.md` |
| Skill reference data | `<plugin>/skills/<name>/references/<file>` |
| Hook behavior | `<plugin>/hooks/scripts/<script>` |
| Hook registration | `<plugin>/hooks/hooks.json` |
| Cron schedule | Managed via `/loop` — not a file edit |
| Board/kanban rules | Skill instructions that reference `bd` commands |
| Plugin metadata | `<plugin>/.claude-plugin/plugin.json` |
| Project instructions | `CLAUDE.md` or `.claude/` config files |
| Global instructions | `~/.claude/CLAUDE.md` or `~/.claude/me.md` |

If you have a topology map from `improve:attach`, use it. If not, use `Grep` and `Glob` to locate the behavior.

## Step 2: Make the Edit

Read the target file first. Always. Then make the minimal change that addresses the problem.

**Principles:**
- Smallest possible edit — don't rewrite surrounding content
- Preserve existing conventions (indentation, formatting, style)
- If adding instructions to an agent, use the agent's existing voice and structure
- If changing a parameter, change only that parameter

## Step 3: Propagation

Not all changes take effect immediately. Know the propagation model:

| Change type | Propagation | Action needed |
|---|---|---|
| Agent definition edit | Next agent spawn picks it up | None — but running agents won't see it |
| Skill SKILL.md edit | Next skill invocation picks it up | None |
| Skill reference edit | Next skill invocation that reads the reference | None |
| Hook script edit | Next hook event fires it | Ensure script is executable (`chmod +x`) |
| hooks.json edit | Requires plugin reinstall | Run `reinstall-plugin.sh <plugin>` in separate terminal, then `/reload-plugins` |
| plugin.json edit | Requires plugin reinstall | Same as above |
| CLAUDE.md edit | Immediate in current session | None |

**Important:** If the change requires a plugin reinstall, tell the human. You cannot run the reinstall from within a Claude Code session (CLAUDECODE env var blocks nested CLI). The human runs it in a separate terminal.

## Step 4: Verify

After the change, confirm it will take effect:

1. **Re-read the file** — confirm the edit is present and correct
2. **Check propagation** — if a reinstall is needed, tell the human and wait
3. **If possible, test** — if the change affects a skill, invoke it. If it affects an agent, note that verification requires the next spawn.

## Recording the Fix

After a successful fix, consider:

- **Is this a pattern?** If so, use `improve:lint` to record it as a watch rule
- **Was this taught by the human?** Record their guidance about confidence level (auto-fix vs. always-ask)
- **Did the fix require unusual propagation?** Update your knowledge of the propagation model
