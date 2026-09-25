---
name: jira
description: >
  Jira issues, tickets, sprints, and worklogs via Atlassian's twg CLI: view, list, transition
  status, comment, log time, show the active sprint. Not for GitHub issues — use lib:github.
---

# lib:jira

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Manage Jira issues, tickets, sprints, and time logging via twg. Use when the user asks about Jira issues, tickets, project tasks, sprint status, transitioning an issue status, adding comments, logging time, or viewing active sprints. Trigger phrases: "show my Jira issues", "view ticket", "transition issue", "move to done", "add comment to ticket", "log time", "active sprint", "what's in my sprint", "Jira backlog". Do NOT trigger for GitHub issues (use lib:github for that).

For deeper Jira work — bulk edits, links, custom fields, similar-issue search, boards — load
Atlassian's own `twg-jira` skill. This skill covers the everyday verbs.

## Credit belongs to the user

Everything written to Jira must read as the user's own work. They steer the agent, so the
credit is theirs. Never add "Generated with Claude", robot emoji, `Co-Authored-By` lines,
"AI-generated", or any other agent marker to a comment, description, summary, or worklog.
The lib plugin's `twg-attribution-guard.sh` hook blocks writes that do; rewrite the text
rather than working around it.

## Authentication

twg signs in with the user's own Atlassian account (OAuth). If a command fails with an
auth error, stop and tell the user:

> Jira authentication required. Run `! twg login` to sign in through the browser.

If `twg: command not found`, direct the user to https://developer.atlassian.com/cloud/twg-cli/.

The site comes from `~/.config/twg/auth.conf`. For a different Atlassian site, add
`--site <prefix>` to every command.

## Output

Always pass `-o json --output-summary none` and name the fields you need with `--fields`.
Without `--output-summary none`, large results are written to a temporary file and stdout
holds only a summary. Query results live under `.data.issues[]`; each issue carries `key`,
`summary`, `status.name`, `priority.name`, `updated`, `duedate`, and `url`. More pages exist
when `.pageInfo.hasNextPage` is true — pass `.pageInfo.nextCursor` to `--after`.
`workitem get` returns `.data[]`, one object per key requested. Sprint queries page with
`--start-at` and `--max-results` against `.data.total` instead of a cursor.

## List assigned issues

```bash
twg jira workitem query --jql "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC" \
  --fields key,summary,status,priority,updated --limit 50 -o json --output-summary none
```

This spans every project. Unlike jira-cli, twg never narrows to a default project, so add
`project = KEY` to the JQL when the user asks about one project.

Format output as a Markdown table, grouped by project when issues span several:
| Key | Summary | Status | Priority | Updated |
|-----|---------|--------|----------|---------|

## View an issue

```bash
twg jira workitem get ISSUE-KEY --comments -o json --output-summary none
```

Show summary, status, assignee, reporter, priority, description, the last 3 comments, and
linked issues. Pass several keys in one call to fetch them together; never loop `get`.

## Transition an issue status

Transition names vary by project and cannot be assumed. List them first:

```bash
twg jira workitem transitions query --id ISSUE-KEY -o json --output-summary none
```

If the user named a target status and exactly one transition matches it, use that one. Otherwise show the available transitions and ask which one. Then:

```bash
twg jira workitem transition --id ISSUE-KEY --transition-id "Target Status"
```

## Add a comment

```bash
twg jira workitem comment create --issue-id ISSUE-KEY --body "comment_text" --body-format markdown
```

Show the comment text and confirm before posting — clients can see many of these projects:

> Post this comment to ISSUE-KEY? (yes/no)

## Log time

```bash
twg jira workitem worklog add --issue-id ISSUE-KEY --time-spent "1h 30m" \
  --started "2026-09-21T09:00:00.000-0400" --comment "what was done" --comment-format plain
```

Confirm the issue, duration, start time, and comment with the user before logging — worklogs
feed billable time. Write the comment as the user describing their own work.

## View active sprint

```bash
twg jira board sprints query --project PROJECT-KEY --state active -o json --output-summary none
twg jira sprint workitems query --id SPRINT_ID -o json --output-summary none
```

A project can have several active sprints; show each one rather than asking which. Show
sprint name, start and end dates, and the issues grouped by status (To Do / In Progress / Done).

## Error handling

- Auth failure: instruct `! twg login`
- `twg: command not found`: direct to https://developer.atlassian.com/cloud/twg-cli/
- `warning: --select matched no fields`: the field path was wrong and the full payload came back; fix the path
- Blocked by `twg-attribution-guard.sh`: remove the agent credit from the text and retry
- Any other non-zero exit: show stderr; if the cause is clear, fix and retry, and ask only when it is not

## Output style

Format all output as clean Markdown tables or lists. Never dump raw JSON. For long
descriptions, use collapsible details blocks if appropriate.
