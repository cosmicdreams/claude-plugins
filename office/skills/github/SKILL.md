---
name: github
description: >
  Manage GitHub pull requests and issues via the gh CLI. Use when the user asks about
  pull requests, PRs, GitHub issues, PR review status, CI checks, or wants to checkout
  a PR branch. Trigger phrases: "show my PRs", "view pull request", "PR status",
  "check PR checks", "checkout PR", "list issues", "open issues on GitHub",
  "review this PR", "is my PR passing". Do NOT trigger for Jira tickets
  (use office:jira for that).
---

# office:github

This skill manages GitHub interactions through the `gh` CLI. It does not build API
clients — everything shells out to `gh`.

## Authentication

If `gh` returns an auth error (typically exits 4 or with "authentication required"):

> GitHub authentication required. Run `gh auth login` and follow the prompts.

If not inside a git repository when running repo-specific commands:

> This command requires a git repository. Navigate to your project directory first.

If `gh: command not found`, direct the user to: https://cli.github.com

## Commands

### List pull requests

Run:
```bash
gh pr list
```

Format as a Markdown table:
| # | Title | Author | Status | Updated |
|---|-------|--------|--------|---------|

Show open PRs by default. Mention total count. If no PRs: "No open pull requests."

### View a pull request

Run:
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

### List issues

Run:
```bash
gh issue list
```

Format as a Markdown table:
| # | Title | Labels | Assignee | Updated |
|---|-------|--------|----------|---------|

Show open issues by default. Mention total count.

### Check PR CI status and checks

Run:
```bash
gh pr checks <number>
```

Format as a status summary:
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

### Checkout a PR branch locally

Run:
```bash
gh pr checkout <number>
```

After success: "Switched to branch '<branch-name>' for PR #<number>: <title>"
If the branch already exists locally, `gh pr checkout` handles it — confirm the
switched branch name.

## Tips

- Run `gh pr list --author @me` to filter to your own PRs
- Run `gh issue list --assignee @me` to filter to your assigned issues
- `gh pr view` without a number shows the PR for the current branch (if any)
- For cross-repo work, use `--repo owner/name` flag

## Error handling

- Auth failure: `gh auth login`
- Not in a git repo: navigate to project directory
- `gh: command not found`: https://cli.github.com
- Other non-zero exits: show stderr and ask user how to proceed

## Output style

Format all output as clean Markdown. Use emoji status indicators (✅ ❌ ⏳ 🔄) for
CI checks and PR status. Tables for lists. Keep it actionable and scannable.
