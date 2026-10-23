// The golden rule as the model reads it, written from Chris's decisions, not older wording.

export const SECTION_ID = 'golden-rule'

export const RULE = `# The golden rule (enforced by the golden-rule mod)

A main worktree keeps no committable change. Every change is made in a dedicated worktree on its own branch
and reaches \`main\` only through a pull request.

- A main worktree is a git working tree whose folder is named \`main\`, in practice
  \`<project>/worktrees/main\`. A committable change is anything \`git status\` there would show: a tracked
  file modified or deleted, a new file git does not ignore, a staged change, or main's HEAD or branch moved.
- Everything else is free. Run the main worktree as a dev instance (DDEV, Composer, npm, Drush, database
  imports): gitignored files there (vendor/, node_modules/, the files folder, local DDEV setup) may change.
  Folders outside a main worktree, dot folders included, are not governed.
- If a shell command changes a committable file in main, the guard restores it from HEAD (or deletes the new
  file) after the command and says so. Edit and Write into such a file are refused. Git commands that would
  move main's HEAD (commit, merge, rebase, reset to another commit, checkout or switch to another branch,
  pull without --ff-only) are refused. Pushing to main is refused.
- To change something main tracks, create a sibling worktree without asking:
  \`git -C <project>/worktrees/main fetch origin\`, then
  \`git -C <project>/worktrees/main worktree add ../<topic> -b feature/<topic> --no-track origin/main\`.
  Work, commit and push there: \`git push origin HEAD:feature/<topic>\`, then \`gh pr create --head feature/<topic>\`.
- When the guard refuses or reverts something, move the work to a worktree. Never route around the guard,
  edit its files, or switch it off.`

export const SHORT_RULE = `Golden rule (enforced): a main worktree (<project>/worktrees/main) keeps no committable change (anything git status would show, or HEAD moved). Gitignored files there, and everything outside it, are free: running main as a dev instance is fine.
Change tracked files in a sibling worktree: git -C <project>/worktrees/main worktree add ../<topic> -b feature/<topic> --no-track origin/main. Changes reach main only by pull request.
Shell changes to committable files in main are reverted after the command. Never route around or disable the guard.`
