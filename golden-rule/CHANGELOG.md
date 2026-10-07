# Changelog

## 0.1.1

**Codex works again under the guard.** `codex exec` sandboxes its own commands with sandbox-exec, which macOS refuses inside another sandbox, so in 0.1.0 Codex could not run a single command. (0.1.0's spike tested Codex answering a question, not running a command.) A plain `codex exec` or `codex review` now runs outside the guard's sandbox, under Codex's own write guard, when every condition holds: one simple command with no chaining or pipes; its arguments expanded inside the sandbox, so `"$(cat prompt.md)"` works and cannot write; the `codex` on the PATH resolving to a pinned release under `~/.codex/packages`, which is now write-protected; no `--dangerously-*` flag, no `-c` override touching hooks, guards or sandboxes, and only the read-only or workspace-write sandbox; `CODEX_HOME` unset or `~/.codex`; Codex's write guard installed; and no output redirected into a main worktree or the guard's files. Anything else runs sandboxed, with a line saying why.

- The end-to-end suite now runs only outside Claude Code (a terminal, or the `!` prompt): under the guard, a session's commands cannot start a sandbox of their own.

## 0.1.0

**First release: the golden rule as a mod.** Main is never the operating surface, enforced in process on every tool call rather than asked for in an instruction file that may not load.

- The rule reaches the model in the system prompt, or, on a Team seat where the built-in guard keeps mods out of it, on each prompt and each subagent's prompt.
- Edit, Write, NotebookEdit and EnterWorktree into a main worktree are refused, with the worktree command to use instead.
- Bash and Monitor commands run inside a macOS sandbox that denies writes to main worktrees, their git state and the folders that hold them, while feature-worktree work (fetch, `worktree add --no-track`, commit, push, branch deletion) still works. Profiles for the fifty-odd main worktrees in the project folders compile in milliseconds through chunked regex rules.
- From a governed repository, pushes to `main`, `gh pr merge --admin` and API writes to `refs/heads/main` are refused; ungoverned repositories are left alone.
- MCP tools that would write to a main worktree, and other plugins' file writes and processes, are covered.
- The guard protects itself and puts back a setting a command used to switch it off.
- A tripwire quarantines a main worktree when a container or another outside process changes it during a command; `/golden-rule clear` lifts it, from the person only.
- Edits are judged case-insensitively and by the file they would leave; a linked main worktree's metadata outside its folder is protected; the folders holding protected files cannot be moved; failures refuse or quarantine instead of passing.
- Paths are resolved component by component (symlinks before `..`), file-identity paths are refused, git metadata is found from each main worktree's actual layout (separate git dirs, any linked-worktree id), and pushes are judged per command segment in the directory they run in.
- A link that leads nowhere is refused; MCP calls are refused while the session works inside a main worktree; a separate git dir's `.git` pointer is protected; settings are recognised by their resolved file; pushes follow every `git -C` and treat directory changes they cannot follow conservatively.
- MCP string arguments within the system's path limits are placed with links followed (newlines included), longer content is never mistaken for a path; settings files are resolved at each write.
- Tests: 33 mocked hook tests, 56 end-to-end sandbox tests on fixture repositories (normal, linked, separate-git-dir and long-path main worktrees), and a live headless run on the personal and Team accounts.
