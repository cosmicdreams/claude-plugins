---
name: github
description: >
  Manage GitHub pull requests and issues via the gh CLI. Trigger when the user asks
  about pull requests, PRs, GitHub issues, PR review status, CI checks, checking out a
  PR branch, or merging a PR. Trigger phrases: "show my PRs", "view pull request",
  "PR status", "check PR checks", "checkout PR", "list issues", "open issues on GitHub",
  "review this PR", "is my PR passing", "are my checks green", "merge PR",
  "who reviewed my PR". Do NOT trigger for Jira tickets (use lib:jira for that).
  Do NOT trigger for non-GitHub git operations (git commit, git push, git log, etc.).
---

# lib:github

Everything shells out to the `gh` CLI — no API clients are built.

## Pre-flight checks

Check these before running any command:

**`gh` not installed** — direct the user to: https://cli.github.com

**Auth failure** — if `gh` exits 4 or prints "authentication required", stop and instruct:
> Run `gh auth login` and follow the prompts to authenticate.

**Not in a git repo** — if a repo-scoped command fails with "not a git repository":
> Navigate to your project directory first, then retry.

## Commands

### List pull requests

```bash
gh pr list
```

Show open PRs by default. Format as a Markdown table:

| # | Title | Author | Status | Updated |
|---|-------|--------|--------|---------|

Include total count. If no PRs: "No open pull requests."

Tip: `gh pr list --author @me` filters to your own PRs. Use `--repo owner/name` for cross-repo work.

### View a pull request

```bash
gh pr view <number>
```

Show:
- Title, number, author, branch (head → base)
- Status (open/closed/merged) and draft status
- Description (body)
- Review status summary (approved/changes requested/pending)
- Recent comments count
- Link to PR on GitHub

Tip: `gh pr view` without a number shows the PR for the current branch.

### Check PR CI status

```bash
gh pr checks <number>
```

Format as a status summary — this makes pass/fail scannable at a glance without reading details:

```
CI Status for PR #<number>: <title>

✅ build (2m 15s)
✅ test (4m 30s)
❌ lint (failed — see details)
⏳ deploy-preview (pending)

Overall: 2 passing, 1 failing, 1 pending
```

If all checks pass: "All checks passing ✅"
If any fail: highlight the failing checks and provide the check detail URL.

### Checkout a PR branch

```bash
gh pr checkout <number>
```

After success: "Switched to branch '<branch-name>' for PR #<number>: <title>"

`gh pr checkout` handles the case where the branch already exists locally — confirm the switched branch name to the user.

### Merge a pull request

```bash
gh pr merge <number>
```

Ask the user for merge strategy if not specified: merge commit, squash, or rebase. Use `--merge`, `--squash`, or `--rebase` accordingly.

After success: "PR #<number> merged into <base-branch>."
If checks are failing or reviews are missing, warn before proceeding.

### List issues

```bash
gh issue list
```

Format as a Markdown table:

| # | Title | Labels | Assignee | Updated |
|---|-------|--------|----------|---------|

Show open issues by default. Include total count.

Tip: `gh issue list --assignee @me` filters to your assigned issues. Use `--repo owner/name` for cross-repo work.

## Error handling

- Non-zero exits not covered above: show stderr verbatim and ask the user how to proceed.
