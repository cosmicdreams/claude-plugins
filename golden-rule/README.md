# golden-rule

A Claude Code mod that enforces the golden rule: **main is never the operating surface.** Every change is made in a dedicated worktree on its own branch and reaches `main` only through a pull request. Unlike an instruction file, a mod runs inside Claude Code on every tool call, for the main conversation and every subagent, so the rule cannot be skipped because an instruction file did not load.

## What it guards

A **main worktree** is a git working tree whose folder is named `main`, in practice `<project>/worktrees/main`. Projects without one are not governed, and everything outside a main worktree is free to change.

| Layer | What happens |
| --- | --- |
| Rule in context | The rule is added to every system prompt (personal account). On a Team seat, where Claude Code's built-in guard keeps mods out of the system prompt, a short form rides on each prompt and each subagent's prompt. |
| Edit, Write, NotebookEdit, EnterWorktree | Refused when the destination (symlinks followed) is inside a main worktree, with the `git worktree add` command to use instead. |
| Bash and Monitor | Every command runs through `hooks/sandbox/run.py` inside `/usr/bin/sandbox-exec`, which denies writes to main worktrees except the git metadata feature worktrees need (objects, non-main refs, other worktrees' folders, `FETCH_HEAD`). HEAD, index, config, hooks and the `main` ref stay denied, and the folders holding a main worktree cannot be moved. `cd` and exit status behave as usual. |
| Pushes | `git push` to `main` in any spelling, `gh pr merge --admin`, and API writes to `refs/heads/main` are refused. This is a backstop: real enforcement is branch protection on the host. |
| MCP tools | A tool whose name does not say it only reads, and whose arguments name a main worktree, is refused. |
| Other plugins | Their `$.fs.write` into a main worktree is refused, and their `$.process.run`/`spawn` run inside the same sandbox. |
| Self-protection | The plugin's files, `~/.claude/hooks/golden-rule.sh`, the Codex write guard, `~/.gitconfig`, `~/.git-hooks` and new hooks modules in skills folders cannot be written. A command that switches the plugin off in a settings file has that setting put back. |
| Tripwire | A command tied to a main worktree that hands work outside the sandbox (`ddev`, `docker`, `osascript`, `tmux`, ...) is watched; a change in the main worktree quarantines it until `/golden-rule clear`, which only the person can run. |

Every gate fails closed: a guard that throws or times out refuses the call.

`/golden-rule` shows what is guarded, recent refusals and any quarantine.

## Working with it

```bash
git -C <project>/worktrees/main fetch origin
git -C <project>/worktrees/main worktree add ../<topic> -b feature/<topic> --no-track origin/main
# work, commit, then
git push origin HEAD:feature/<topic>
gh pr create --head feature/<topic>
```

`--no-track` matters: tracking would be written into the main worktree's `.git/config`, which the sandbox refuses.

## Requirements and limits

- macOS (`/usr/bin/sandbox-exec`), `/usr/bin/python3`, Claude Code 2.1.287 or later.
- Main worktrees are found under `~/Sites`, `~/Tools` and `~/OpenSource` (`hooks/policy.json`), and anywhere a command runs or names.
- Built for full-access sessions. In auto mode the command rewrite makes Claude Code deny Bash calls.
- `--safe-mode`, `--bare`, or a hooks worker that crashes three times runs without installed mods; the settings hook `~/.claude/hooks/golden-rule.sh` stays as the backstop.
- A command costs about 0.2 s more. A watched command in a large main worktree costs a few seconds for the scan.

## Tests

```bash
claude plugin test .          # hook decisions, mocked engine
zsh tests/e2e/run.zsh         # the real sandbox against fixture repositories
zsh tests/live/run.zsh <out>  # the mod in a real headless session (uses the model)
```

Plan and design record: `~/Tools/CLAUDE-PLUGINS/plans/2026-10-06-golden-rule-mod.md`.
