# golden-rule

A Claude Code mod that enforces the golden rule: **a main worktree keeps no committable change.** Every change to what main tracks is made in a dedicated worktree on its own branch and reaches `main` only through a pull request. The mod runs inside Claude Code on every tool call, for the main conversation and every subagent.

## What it guards

A **main worktree** is a git working tree whose folder is named `main`, in practice `<project>/worktrees/main`. A **committable change** is anything `git status` there would show: a tracked file modified or deleted, a new file git does not ignore, a staged change, or main's HEAD or branch moved.

Nothing else is governed. Gitignored files in main (`vendor/`, `node_modules/`, the files folder, a local DDEV setup) change freely, so main can run as a dev instance: DDEV, Composer, npm, Drush and database imports just work. Folders outside a main worktree, dot folders included, are not touched.

| Layer | What happens |
| --- | --- |
| Rule in context | The rule is added to every system prompt (personal account). On a Team seat, where Claude Code's built-in guard keeps mods out of the system prompt, a short form rides on each prompt and each subagent's prompt. |
| Edit, Write, NotebookEdit | Refused when the destination (symlinks followed, any letter case) is a file the main worktree could commit, or the git metadata of a repository that has one, with the `git worktree add` command to use instead. A gitignored, untracked file is allowed (`git check-ignore`, with the person's global excludes, as `git status` sees it). |
| Bash and Monitor | Every command runs through `hooks/sandbox/run.py`, which knows the shell's real working directory. Before: pushes to `main`, and git commands in a main worktree that would move its HEAD or branch (commit, merge or pull without `--ff-only`, rebase, reset to another commit, checkout or switch to another branch, renaming or deleting main, stash pop/apply), are refused. Around a command run in or naming a main worktree: `git status` before and after; every tracked file the command changed is restored from HEAD, every new unignored file is deleted, and the command reports it and exits non-zero. A file that was already changed before the command is left alone and reported. |
| Pushes | From a governed repository, `git push` to `main` in any spelling, `gh pr merge --admin`, and API writes to `refs/heads/main` are refused. Repositories without a main worktree are left alone. Branch protection on the host is the real enforcement. |
| MCP tools | A tool whose path arguments land on a committable file in main is refused, unless `mcpReadTools` in `hooks/policy.json` lists it as read-only. |
| Other plugins | Their `$.fs.write` is judged like Write; their `$.process.run`/`spawn` go through the same bootstrap. |
| Self-protection | The plugin's own files and `~/.claude/hooks/golden-rule.sh` cannot be edited; a command naming them is refused, and a command that changed them anyway is reported. A command that switches the plugin off or uninstalls it has that put back; `/config` rows about hooks or plugins are refused unless the person changes them. A command that removes or moves a main worktree folder or its `.git` is refused. |

Every gate fails closed: a guard that throws refuses the call.

`/golden-rule` shows what is guarded and recent refusals.

## Limits

- A command that does not run in or name a main worktree is not checked: a script handed only a feature-worktree path that writes into main by itself is not seen.
- The after-check sees what the command left when it returned. A container or sync daemon (DDEV's Mutagen) writing a tracked file later is not seen; the next command tied to that main worktree will find it already changed and leave it, with a report.
- A command that runs while you edit a tracked file in main yourself will revert your edit too. Edit tracked files in a feature worktree.
- There is no sandbox. One would break every tool that applies its own (Codex, some build tools), since macOS does not nest them.

## Working with it

```bash
git -C <project>/worktrees/main fetch origin
git -C <project>/worktrees/main worktree add ../<topic> -b feature/<topic> --no-track origin/main
# work, commit, then
git push origin HEAD:feature/<topic>
gh pr create --head feature/<topic>
```

Keep main current with `git -C <project>/worktrees/main pull --ff-only`.

## Requirements

- macOS, `/usr/bin/python3`, `/usr/bin/git`, Claude Code 2.1.287 or later.
- Main worktrees are found two levels under the home folder (`~/<folder>/<project>/worktrees/main`, set in `hooks/policy.json`), and anywhere a command runs or names.
- A command costs about 0.3 s more; one tied to a main worktree about 0.3 s more again for the status check.

## Tests

```bash
claude plugin test .          # hook decisions, mocked engine
zsh tests/e2e/run.zsh         # the real bootstrap against fixture repositories
zsh tests/live/run.zsh <out>  # the mod in a real headless session (uses the model)
```
