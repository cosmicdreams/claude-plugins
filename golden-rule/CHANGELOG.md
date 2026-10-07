# Changelog

## 0.1.0

**First release: the golden rule as a mod.** Main is never the operating surface, enforced in process on every tool call rather than asked for in an instruction file that may not load.

- The rule reaches the model in the system prompt, or, on a Team seat where the built-in guard keeps mods out of it, on each prompt and each subagent's prompt.
- Edit, Write, NotebookEdit and EnterWorktree into a main worktree are refused, with the worktree command to use instead.
- Bash and Monitor commands run inside a macOS sandbox that denies writes to main worktrees, their git state and the folders that hold them, while feature-worktree work (fetch, `worktree add --no-track`, commit, push, branch deletion) still works. Profiles for the fifty-odd main worktrees in the project folders compile in milliseconds through chunked regex rules.
- Pushes to `main`, `gh pr merge --admin` and API writes to `refs/heads/main` are refused.
- MCP tools that would write to a main worktree, and other plugins' file writes and processes, are covered.
- The guard protects itself and puts back a setting a command used to switch it off.
- A tripwire quarantines a main worktree when a container or another outside process changes it during a command; `/golden-rule clear` lifts it, from the person only.
- Tests: 20 mocked hook tests, 33 end-to-end sandbox tests on fixture repositories, and a live headless run on the personal and Team accounts.
