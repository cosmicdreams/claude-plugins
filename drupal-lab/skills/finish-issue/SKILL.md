---
name: finish-issue
description: Use when work on a Drupal issue is complete and ready to close out the
  worktree. Invoke after review passes, or when deciding to submit, park, or discard
  a branch. Trigger phrases: 'finish the issue', 'close out the worktree', 'submit
  the patch', 'done with this issue', 'discard the worktree'.
allowed-tools: Bash, Read, Grep
---

# Finish Issue

Closes out a Drupal issue worktree with a deliberate decision. No worktree drifts open
indefinitely — every session ends with an explicit choice.

---

## Step 1: Assess Current State

Run from the **project root** (the directory containing `worktrees/`).

```bash
ISSUE=<issue-number>

# Verify worktree exists
ls worktrees/$ISSUE/ 2>/dev/null || echo "Worktree not found"

# Check for uncommitted changes
git -C worktrees/$ISSUE status --short

# Check commits ahead of main
git -C worktrees/$ISSUE log main..HEAD --oneline

# Check DDEV status
ddev describe 2>/dev/null | grep -E "status|name" | head -5
```

Report:
- Uncommitted changes (if any — these need attention before most paths)
- Commits ahead of main (the actual work)
- Whether DDEV is running

---

## Step 2: Choose a Path

Present these four options and wait for the user's choice:

```
How do you want to finish this issue?

A) Submit as MR    — push branch to drupal.org GitLab and create a merge request
B) Submit as patch — generate a .patch file for manual upload to the issue
C) Keep as WIP     — park the worktree for a future session; optionally stop DDEV
D) Discard         — work is not going forward; remove the worktree entirely
```

If review has passed, suggest A or B. If review failed or work is early, surface C or D.

---

## Path A: Submit as MR

### A1 — Verify clean state
```bash
git -C worktrees/$ISSUE status --short
```
If uncommitted changes exist: stop. Ask the user to commit or stash before proceeding.

### A2 — Generate contribution comment
Invoke `drupal-lab:issue-summary` to produce the drupal.org-ready comment before pushing.
The comment documents the problem, approach, changed files, and test instructions.

### A3 — Provide push command for user
The git guard prevents agents from pushing. Provide this command for the user to run in a
separate terminal:

```bash
cd worktrees/<issue-number>
git push origin issue-<issue-number>
```

After pushing, the MR URL follows this pattern:
```
https://git.drupalcode.org/project/drupal/-/merge_requests/new?merge_request[source_branch]=issue-<issue-number>
```

For contributed modules, the remote URL will differ — check with:
```bash
git -C worktrees/$ISSUE remote get-url origin
```

### A4 — Stop DDEV
```bash
cd worktrees/$ISSUE && ddev stop
```

### A5 — Confirm to user
- Branch pushed: `issue-<issue-number>`
- MR URL (or instructions to open one)
- Contribution comment: ready to paste into the drupal.org issue
- DDEV: stopped
- Worktree: preserved (branch still available for follow-up)

---

## Path B: Submit as Patch

### B1 — Verify clean state
```bash
git -C worktrees/$ISSUE status --short
```
Uncommitted changes will be included in the patch. Flag any unintentional files.

### B2 — Generate patch
```bash
git -C worktrees/$ISSUE diff main > /tmp/issue-$ISSUE.patch
wc -l /tmp/issue-$ISSUE.patch
```

Move to project root for easy access:
```bash
mv /tmp/issue-$ISSUE.patch ./issue-$ISSUE.patch
```

### B3 — Generate contribution comment
Invoke `drupal-lab:issue-summary` to produce the drupal.org-ready comment.

### B4 — Stop DDEV
```bash
cd worktrees/$ISSUE && ddev stop
```

### B5 — Confirm to user
- Patch file: `./issue-$ISSUE.patch` (line count, ready to attach to issue)
- Contribution comment: ready to paste
- DDEV: stopped
- Worktree: preserved

---

## Path C: Keep as WIP

Work continues in a future session. The worktree stays active.

### C1 — Document current state
Note in the kanban card or analysis report:
- What is done
- What remains
- Any blockers or open questions
- Last test run result

### C2 — Optionally stop DDEV
Ask: "Do you want to stop DDEV to free resources? You'll restart it next session."

If yes:
```bash
cd worktrees/$ISSUE && ddev stop
```

### C3 — Confirm to user
- Worktree: active at `worktrees/$ISSUE/`
- DDEV: stopped (or still running — whichever applies)
- Next session: run `drupal-lab:process-lifecycle` INIT to resume

---

## Path D: Discard

Work is not going forward. Confirm before removing anything.

### D1 — Confirm twice
State explicitly what will be deleted:
```
About to discard worktrees/<issue-number>/.
This removes all uncommitted changes and the isolated branch.
Committed changes on issue-<issue-number> are preserved in git history.
Type 'discard' to confirm.
```

Wait for the user to confirm before proceeding.

### D2 — Stop DDEV
```bash
cd worktrees/$ISSUE && ddev stop && ddev delete --omit-snapshot -y 2>/dev/null || true
```

### D3 — Remove worktree
```bash
# From project root
git worktree remove worktrees/$ISSUE --force
```

### D4 — Optionally delete the branch
```bash
# From worktrees/main
git -C worktrees/main branch -d issue-$ISSUE 2>/dev/null || \
  git -C worktrees/main branch -D issue-$ISSUE
```

Ask before deleting the branch — the user may want to keep it for reference.

### D5 — Confirm to user
- Worktree removed: `worktrees/$ISSUE/`
- Branch: deleted or preserved (per user choice)
- DDEV: stopped and cleaned up

---

## Context Awareness

All relative paths assume execution from the **project root** — the directory containing
`worktrees/`. If you are inside a worktree, `cd ../..` first.

The git guard blocks `git push` from agents. Paths A and B provide the push/upload command
for the user to run manually in a separate terminal.
