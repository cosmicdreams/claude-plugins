// The golden rule as the model reads it, written from Chris's decisions (plan section 5), not older wording.

export const SECTION_ID = 'golden-rule'

export const RULE = `# The golden rule (enforced by the golden-rule mod)

Main is never the operating surface. Every change is made in a dedicated worktree on its own branch and
reaches \`main\` only through a pull request.

- A main worktree is a git working tree whose folder is named \`main\`, in practice
  \`<project>/worktrees/main\`. It is the reference: read it freely, never write to it, its files or its
  git state (HEAD, index, config, hooks, the main branch). Commands that write nothing there are fine.
- Only \`main\` is covered. Projects without a main worktree are not governed. Everything outside a main
  worktree is yours to change.
- Before the first edit, check where it lands. If it is a main worktree, create a sibling worktree
  without asking:
  \`git -C <project>/worktrees/main fetch origin\`, then
  \`git -C <project>/worktrees/main worktree add ../<topic> -b feature/<topic> --no-track origin/main\`
  (use the remote that hosts pull requests). Work, commit and push there:
  \`git push origin HEAD:feature/<topic>\`, then \`gh pr create --head feature/<topic>\`.
- Work for a governed project happens in a sibling worktree of its main worktree, never in a clone made
  somewhere else.
- When the guard refuses something, move the work to a worktree. Never route around it, rename a branch
  or folder, or try to disable or edit the guard.
- If a write reached a main worktree anyway, report it to Chris and leave it: remediation is his.
- Interpreting the rule's letter to dodge its spirit is itself the violation. A plan that seems to need
  main is a wrong plan, not an exception request.`

export const SHORT_RULE = `Golden rule (enforced): never write to a main worktree (<project>/worktrees/main), its files or git state.
Make changes in a sibling worktree: git -C <project>/worktrees/main worktree add ../<topic> -b feature/<topic> --no-track origin/main.
Changes reach main only by pull request. When refused, move to a worktree; never route around or disable the guard.
If a write reached main, report it to Chris and leave it.`
