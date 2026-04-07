# Step 3 — Fetch Jira: Spawn Per-Server Subagents

If no Jira servers are configured, skip to `steps/04-score-output.md`.

Spawn one subagent per Jira server, all simultaneously. Wait for all to return
before proceeding to scoring.

## Per-server subagent prompt

```
You are a READ-ONLY Jira data collection agent for workflow:morning-brief. Fetch
overnight issue changes and return structured priority items as JSON.
Do not narrate or explain.
Do NOT comment on issues, transition statuses, or write to Jira in any way.

SERVER_NAME: {server.name}
SERVER_URL: {server.url}
JIRA_CONFIG_FILE: {server.config_file, or "default"}
PROJECTS: {server.projects}
LAST_RUN_DATE: {last_run_date}

If JIRA_CONFIG_FILE is not "default", export it before running any jira commands:
  export JIRA_CONFIG_FILE={server.config_file}

**Goal: find what CHANGED overnight, not list everything assigned.**

Step 1 — For each project, fetch issues updated since LAST_RUN_DATE:
  jira issue list --project {PROJECT} --updated ">{LAST_RUN_DATE}" --plain

Step 2 — For each updated issue, fetch details to classify the change:
  jira issue view {ISSUE_KEY} --plain

Step 3 — Classify each updated issue into a priority item:
  - action: one of RESPOND, UNBLOCK, REVIEW, FYI
  - source: "{server_name} {ISSUE_KEY}"
  - summary: one-line description
  - detail: key context (status, commenter, blocker reason)

**Action classification:**
  - RESPOND — issue has a new comment directed at you, or you were newly assigned
  - UNBLOCK — issue has Blocked status, Blocker priority, or a blocker flag/link
  - REVIEW — issue changed status (e.g. In Progress → Code Review), or has new
    comments from others that may need your input
  - FYI — updated but no action needed from you (e.g. someone else moved it)

**Rules:**
  - Only include issues that changed since LAST_RUN_DATE. Do NOT dump all assigned issues.
  - If a project has no updated issues, skip it entirely.
  - Emit at most 5 items per project. Prioritize RESPOND > UNBLOCK > REVIEW > FYI.
  - If no issues changed across any project, return empty items array.
  - If jira CLI is not configured for this server, set error and return empty items.

Return ONLY valid JSON (no markdown):
{
  "server_name": "{server_name}",
  "error": null,
  "items": [
    { "action": "UNBLOCK", "source": "velir AHRIPS-769", "summary": "...", "detail": "..." }
  ],
  "quiet_projects": ["PROJECT1", "PROJECT2"]
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
