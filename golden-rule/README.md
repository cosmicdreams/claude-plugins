# golden-rule

A Claude Code mod that enforces the golden rule: **main is never the operating surface.** Every change is made in a dedicated worktree on its own branch and reaches `main` only through a pull request. Unlike an instruction file, a mod runs inside Claude Code on every tool call, for the main conversation and every subagent, so the rule cannot be skipped because an instruction file did not load.

## What it guards

A **main worktree** is a git working tree whose folder is named `main`, in practice `<project>/worktrees/main`. Projects without one are not governed, and everything outside a main worktree is free to change.

| Layer | What happens |
| --- | --- |
| Rule in context | The rule is added to every system prompt (personal account). On a Team seat, where Claude Code's built-in guard keeps mods out of the system prompt, a short form rides on each prompt and each subagent's prompt. |
| Edit, Write, NotebookEdit, EnterWorktree | Refused when the destination (symlinks followed, any letter case) is inside a main worktree or the git metadata of a repository that has one, with the `git worktree add` command to use instead. A gitignored, untracked file in a main worktree is the exception (see below). |
| Bash and Monitor | Every command runs through `hooks/sandbox/run.py` inside `/usr/bin/sandbox-exec`, which denies writes to main worktrees except the git metadata feature worktrees need (objects, non-main refs, other worktrees' folders, `FETCH_HEAD`) and the gitignored, untracked files of a main worktree the command runs in or names. HEAD, index, config, hooks and the `main` ref stay denied, and the folders holding a main worktree cannot be moved. `cd` and exit status behave as usual. |
| Pushes | From a governed repository, `git push` to `main` in any spelling, `gh pr merge --admin`, and API writes to `refs/heads/main` are refused (by the bootstrap, which knows the real working directory). Repositories without a main worktree are left alone. This is a backstop: real enforcement is branch protection on the host. |
| MCP tools | A tool whose arguments name a main worktree is refused unless `mcpReadTools` in `hooks/policy.json` lists it as read-only. |
| Other plugins | Their `$.fs.write` into a main worktree is refused, and their `$.process.run`/`spawn` run inside the same sandbox. |
| Self-protection | The plugin's files, `~/.claude/hooks/golden-rule.sh`, the Codex write guard, `~/.gitconfig`, `~/.git-hooks`, new hooks modules in skills folders, and the folders holding any of them cannot be written or moved. Edits that would switch the plugin off are refused by the file they would leave; a command that switches it off or uninstalls it (in `~/.claude`, `~/.claude-work` or `CLAUDE_CONFIG_DIR`) has that put back; `/config` rows about hooks or plugins are refused. |
| Tripwire | A command tied to a main worktree that names a program handing work outside the sandbox (`ddev`, `docker`, `osascript`, `tmux`, ...) is watched; a change in the main worktree, or a check that fails, quarantines it until `/golden-rule clear`, which only the person can run. A change to a gitignored, untracked file is not a change, when the rule that ignores it was there, unchanged, before the command. An unreadable quarantine record refuses rather than clears. |

Every gate fails closed: a guard that throws or times out refuses the call.

`/golden-rule` shows what is guarded, recent refusals and any quarantine.

## Gitignored files in a main worktree

A gitignored, untracked file is not part of the reference: a local DDEV setup (`.ddev/config.local.yaml`, DDEV's generated files), `vendor/`, the Drupal files folder. Writing one changes nothing a pull request would carry, so DDEV, Composer and a database import can run in a main worktree to compare it with a feature branch. `hooks/sandbox/ignored.py` is the one source for all three layers, and reads only the repository's own ignore files (`.gitignore` files git reads, and `info/exclude`), never the person's global excludes file.

| Layer | How it decides |
| --- | --- |
| Edit, Write, MCP | `git check-ignore` for the path. |
| Sandbox | The ignored files and folders that exist when the command starts, exactly as git lists them, as literal and subpath rules; no ignore pattern is translated. A folder is allowed whole only when git ignores the folder itself. Only for main worktrees the command runs in or names; every other one stays denied whole. |
| Tripwire | Every changed file (folders aside) is passed to `git check-ignore`; it is explained only by an ignore file that was there, with the same content, before the command. Modified and deleted tracked files and untracked, unignored files added or removed are compared with git's listings from before. |

Every layer refuses, whatever git says: a path whose case-folded, NFC-normalised spelling is a tracked file or a folder of one; anything inside a submodule; any file named `.gitignore`; `.git`; a file with more than one hard link (and in the sandbox, every allowance while any tracked file has one). Git runs as `/usr/bin/git` from a clean environment, without global or system configuration, the global excludes file or fsmonitor. The settings hook applies the same checks.

Still protected: tracked files, ignored or not; untracked files git does not ignore; `!` re-included paths; every ignore file and `info/exclude`; the `.git` metadata.

Limits: in the sandbox, a new ignored file in a folder git does not ignore (`.ddev/new.local.yaml`) cannot be created. A folder is opened whole only after every entry in it has been checked (no hard links, plain ASCII names), at most 2,000 entries a folder and 3,000 a command, shallowest first; larger folders (`vendor/`, `node_modules/`, the files folder) stay denied to shell commands, which reach them through a container, and Edit and Write still judge files in them one by one. A `.gitignore` is denied everywhere in an opened main worktree. Paths are quoted as plain ASCII, since the profile reader does not read JSON `\u` escapes. The allowance is computed when the command starts: an outside process that changes an ignore file while a command runs is seen only by the tripwire, and only for watched commands. The tripwire compares folder modes, owners and flags but not their times, which move whenever an ignored file is added, so an outside process that creates and deletes an unignored file within one command, or makes an empty folder, is not seen. A sync daemon (DDEV's Mutagen) that writes after a command returns is outside the tripwire's window. Building the allowance costs about half a second for a command that touches a main worktree.

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
- Main worktrees are found two levels under the home folder (`~/<folder>/<project>/worktrees/main`, set in `hooks/policy.json`), and anywhere a command runs or names.
- Commands that hand work to another process (`osascript`, `tmux`, `open`, `launchctl`, a container engine) are watched, not refused, and only when they name the program; one started indirectly, by a script, is not seen. Whether to refuse them outright is open (plan question A).
- Built for full-access sessions. In auto mode the command rewrite makes Claude Code deny Bash calls.
- `--safe-mode`, `--bare`, or a hooks worker that crashes three times runs without installed mods; the settings hook `~/.claude/hooks/golden-rule.sh` stays as the backstop.
- A command costs about 0.2 s more. A watched command in a large main worktree costs a few seconds for the scan.

## Tests

```bash
claude plugin test .          # hook decisions, mocked engine
zsh tests/e2e/run.zsh         # the real sandbox against fixture repositories
/usr/bin/python3 -I tests/sandbox/ignored_test.py   # the ignore translation and tripwire against a fixture
zsh tests/live/run.zsh <out>  # the mod in a real headless session (uses the model)
```

Plan and design record: `~/Tools/CLAUDE-PLUGINS/plans/2026-10-06-golden-rule-mod.md`.
