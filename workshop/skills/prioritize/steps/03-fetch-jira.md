# Step 3 — Fetch Jira: Spawn Per-Server Subagents

If no Jira servers are configured, skip to `steps/04-score-output.md`.

Spawn one subagent per Jira server, all simultaneously. Wait for all to return
before proceeding to scoring.

## Goal

Surface Jira items that need your attention today. Two passes:

1. **Delta pass**: what changed overnight — new comments, status transitions, new
   assignments since LAST_RUN_DATE
2. **Attention pass**: standing obligations regardless of recency — blocked issues
   you own, issues **due today or overdue**, high-priority items assigned to you
   with no recent activity, anything in progress for an unusually long time

A deadline does not announce itself in the delta pass — an issue assigned to you and
due today may have had no comment or status change in days, so Pass 1 will never see
it. Pass 2 is what catches it. Treat "assigned to me and due today/overdue" as a
first-class attention signal, not an afterthought.

## Per-server subagent prompt

```
You are a READ-ONLY Jira data collection agent for workshop:prioritize. Identify
Jira issues that need the user's attention TODAY — both recent changes and standing
obligations. Do not narrate or explain.
Do NOT comment on issues, transition statuses, or write to Jira in any way.

SERVER_NAME: {server.name}
SERVER_URL: {server.url}
JIRA_CONFIG_FILE: {server.config_file, or "default"}
PROJECTS: {server.projects}
LAST_RUN_DATE: {last_run_date}

If JIRA_CONFIG_FILE is not "default", export it before running any jira commands:
  export JIRA_CONFIG_FILE={server.config_file}

**Pass 1 — Delta (overnight changes):**
For each project, fetch issues updated since LAST_RUN_DATE:
  jira issue list --project {PROJECT} --updated ">{LAST_RUN_DATE}" --plain

CLI quirk: on some jira-cli versions the `--updated ">DATE"` operator silently
returns nothing. If a project returns zero updated issues, retry with JQL before
concluding it is quiet:
  jira issue list --project {PROJECT} --jql 'updated >= "{LAST_RUN_DATE}"' --plain

For each updated issue (up to 5 per project), fetch details:
  jira issue view {ISSUE_KEY} --plain

Classify each change:
  - RESPOND — new comment directed at you, or you were newly assigned
  - REVIEW — status changed, or new comments from others that may need your input
  - FYI — updated but no action needed from you

**Pass 2 — Attention (standing obligations):**
Fetch your full assigned workload. Include the due date column so deadlines are
visible without opening every issue:
  jira issue list --assignee $(jira me) --status "~Done" --status "~Closed" \
    --columns "key,summary,status,priority,updated,duedate" --plain

From your assigned issues, identify items that need attention TODAY:
  - DUE — any issue with a due date of TODAY or earlier (overdue) that is not Done/
    Closed. Always surface, regardless of status, comments, or recency. A near-
    deadline assigned to you is top-tier even when nothing about the issue "changed"
    — this is the signal Pass 1 structurally cannot see.
  - UNBLOCK — any issue with Blocked status, Blocker priority, or blocker link/flag.
    These are always top priority regardless of when they were last updated.
  - RESPOND — issues where the last comment is from someone else asking you something,
    even if it was days ago. Check the last 1-2 comments on each assigned issue.
  - REVIEW — issues assigned to you in a review-like status (Code Review, QA, etc.)
  - STALE — issues assigned to you in "In Progress" with no update in >5 days.
    These suggest forgotten work. Classify as REVIEW with a note about staleness.

For Pass 2, fetch details on up to 10 assigned issues that look like they need
attention (due today/overdue, blocked, review status, or stale). Do NOT fetch details
on every assigned issue — filter by due date, status, and recency first.

**Build priority items.** Each item has:
  - action: one of RESPOND, UNBLOCK, DUE, REVIEW, FYI
  - source: "{server_name} {ISSUE_KEY}"
  - summary: one-line description
  - detail: key context (due date, status, commenter, days stale, blocker reason)

**Rules:**
  - Do NOT dump all assigned issues. Only emit items that need attention.
  - Deduplicate: if an issue appears in both passes, use the higher-priority action.
  - Emit at most 5 items per project. Prioritize RESPOND > DUE > UNBLOCK > REVIEW > FYI.
  - A project is `quiet` ONLY when it has zero items across BOTH passes. Do not mark a
    project quiet based on the delta pass alone — an assigned issue surfaced in Pass 2
    (due today, blocked, awaiting your review, or stale) disqualifies its project from
    `quiet`, even if nothing changed in the delta window. Compute `quiet_projects` from
    the final merged item list, not from Pass 1.
  - If jira CLI is not configured for this server, set error and return empty items.

Return ONLY valid JSON (no markdown):
{
  "server_name": "{server_name}",
  "error": null,
  "items": [
    { "action": "DUE", "source": "velir SPSX-612", "summary": "...", "detail": "Due today; In Development; assigned to you." }
  ],
  "quiet_projects": ["PROJECT1"]
}
```

## Failure handling

If a server subagent fails entirely, treat it as:
`{ "server_name": "...", "error": "subagent failed", "items": [], "quiet_projects": [] }`

If `jira` is not installed or auth fails, set `error` to the message and return
empty items. Include a hint about what to configure.

## Merge results

Collect all items from all servers into a flat list. Track quiet projects and
any server errors.

Proceed to `steps/04-score-output.md` with: slack_items, jira_items, quiet_channels,
quiet_projects, errors.
