---
name: jira
description: >
  Manage Jira issues, tickets, and sprints via jira-cli. Use when the user asks about
  Jira issues, tickets, project tasks, sprint status, transitioning an issue status,
  adding comments, or viewing active sprints. Trigger phrases: "show my Jira issues",
  "view ticket", "transition issue", "move to done", "add comment to ticket",
  "active sprint", "what's in my sprint", "Jira backlog".
  Do NOT trigger for GitHub issues (use office:github for that).
---

# office:jira

This skill manages Jira through the `jira` CLI (jira-cli). Always use `--plain` flag
for script-friendly output that Claude can reliably parse.

## Authentication

If `jira` exits with an error about credentials or configuration, stop and tell the user:

> Jira authentication required. Run `jira init` and follow the prompts to configure
> your Jira server URL, email, and API token.

If `jira: command not found`, tell the user to install jira-cli:
https://github.com/ankitpokhrel/jira-cli

## Commands

### List assigned issues

Run:
```bash
jira issue list --assignee $(jira me) --plain
```

Format the output as a Markdown table:
| Key | Summary | Status | Priority | Updated |
|-----|---------|--------|----------|---------|

Group by project if issues span multiple projects.

### View an issue

Run:
```bash
jira issue view <ISSUE-KEY> --plain
```

Show all fields: summary, status, assignee, reporter, priority, description,
comments (last 3), and linked issues.

### Transition an issue status

First, list available transitions:
```bash
jira issue transition list <ISSUE-KEY> --plain
```

Show the user the available transitions. Ask them to confirm which status to move to.
Then run:
```bash
jira issue move <ISSUE-KEY> "<new-status>"
```

### Add a comment

Run:
```bash
jira issue comment add <ISSUE-KEY> --body "<comment_text>"
```

Always show the user the comment text and confirm before posting:
> Post this comment to <ISSUE-KEY>? (yes/no)

### View active sprint

Run:
```bash
jira sprint list --current --plain
```

Show: sprint name, start date, end date, and a table of issues in the sprint
grouped by status (To Do / In Progress / Done).

## Tips

- Issue keys follow the pattern PROJECT-123 (e.g., AHRIPS-456, PROJ-789)
- Use `jira me` to get the current user's identifier for assignee filtering
- The `--plain` flag ensures output is not colored/formatted with terminal escapes,
  making it easy for Claude to parse
- For project-specific work, `jira issue list --project <KEY>` filters by project

## Error handling

- Auth failure: instruct `jira init`
- `jira: command not found`: direct to https://github.com/ankitpokhrel/jira-cli
- Non-zero exit for other reasons: show stderr output and ask user how to proceed

## Output style

Format all output as clean Markdown tables or lists. Never dump raw CLI output
at the user — always reformat for readability. For long descriptions, use collapsible
details blocks if appropriate.
