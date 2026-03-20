---
name: jira
description: >
  Manage Jira issues, tickets, and sprints via jira-cli. Use when the user asks about
  Jira issues, tickets, project tasks, sprint status, transitioning an issue status,
  adding comments, or viewing active sprints. Trigger phrases: "show my Jira issues",
  "view ticket", "transition issue", "move to done", "add comment to ticket",
  "active sprint", "what's in my sprint", "Jira backlog".
  Do NOT trigger for GitHub issues (use lib:github for that).
---

# lib:jira

## Authentication

If `jira` exits with an auth or configuration error, stop and tell the user:

> Jira authentication required. Run `jira init` and follow the prompts to configure
> your Jira server URL, email, and API token.

If `jira: command not found`, direct the user to install jira-cli:
https://github.com/ankitpokhrel/jira-cli

## List assigned issues

```bash
jira issue list --assignee $(jira me) --plain
```

Always include `--plain` — it strips terminal color codes so output is parseable. Without it, ANSI escape sequences corrupt the text.

Format output as a Markdown table:
| Key | Summary | Status | Priority | Updated |
|-----|---------|--------|----------|---------|

Group by project if issues span multiple projects.

## View an issue

```bash
jira issue view ISSUE-KEY --plain
```

Show all fields: summary, status, assignee, reporter, priority, description,
comments (last 3), and linked issues.

Issue keys follow the pattern PROJECT-123 (e.g., PROJ-456, TEAM-789).

## Transition an issue status

Always list available transitions first — transition names vary by project configuration
and cannot be assumed:

```bash
jira issue transition list ISSUE-KEY --plain
```

Show the user the available transitions. Ask which status to move to. Then run:

```bash
jira issue move ISSUE-KEY "new-status"
```

## Add a comment

```bash
jira issue comment add ISSUE-KEY --body "comment_text"
```

Always show the comment text and confirm before posting — Jira comments cannot be
deleted without admin access:

> Post this comment to ISSUE-KEY? (yes/no)

## View active sprint

```bash
jira sprint list --current --plain
```

Show: sprint name, start date, end date, and a table of issues grouped by status
(To Do / In Progress / Done).

## Tips

- Use `jira me` to get the current user's identifier for assignee filtering
- Filter by project: `jira issue list --project KEY --plain`

## Error handling

- Auth failure: instruct `jira init`
- `jira: command not found`: direct to https://github.com/ankitpokhrel/jira-cli
- Non-zero exit for other reasons: show stderr and ask user how to proceed

## Output style

Format all output as clean Markdown tables or lists. Never dump raw CLI output —
always reformat for readability. For long descriptions, use collapsible details
blocks if appropriate.
