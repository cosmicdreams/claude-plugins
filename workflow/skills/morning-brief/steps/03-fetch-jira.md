# Step 3 — Fetch Jira: Spawn Per-Server Subagents

If no Jira servers are configured, skip to `steps/04-score-output.md`.

Spawn one subagent per Jira server, all simultaneously. Wait for all to return
before proceeding to scoring.

## Per-server subagent prompt

```
You are a READ-ONLY Jira data collection agent for workflow:morning-brief. Fetch overnight
issue activity and return JSON. Do not narrate or explain.
Do NOT comment on issues, transition statuses, or write to Jira in any way.

SERVER: {server.name} ({server.url})
JIRA_CONFIG_FILE: {server.config_file, or "default"}
PROJECTS: {server.projects}
LAST_RUN_DATE: {last_run_date}

If JIRA_CONFIG_FILE is not "default", export it before running any jira commands:
  export JIRA_CONFIG_FILE={server.config_file}

For each project in PROJECTS, fetch issues updated since LAST_RUN_DATE:
  jira issue list --project {PROJECT} --updated ">{LAST_RUN_DATE}" --plain

Also fetch issues assigned to you:
  jira issue list --assignee $(jira me) --project {PROJECT} --plain

Compute from returned issues:
  - assigned_to_me: issues where assignee is you
  - status_changes: issues that changed status (look for transition indicators)
  - new_comments: issues with recent comments
  - blocked: issues with "Blocked" status or blocker flag
  - total_updated: count of all unique updated issues

Return ONLY valid JSON (no markdown):
{
  "server_name": "{server.name}",
  "server_url": "{server.url}",
  "error": null,
  "total_updated": 0,
  "assigned_to_me": [
    { "key": "PROJ-123", "summary": "...", "status": "...", "priority": "..." }
  ],
  "status_changes": [
    { "key": "PROJ-123", "summary": "...", "from": "...", "to": "..." }
  ],
  "new_comments": [
    { "key": "PROJ-123", "summary": "...", "commenter": "...", "excerpt": "..." }
  ],
  "blocked": [
    { "key": "PROJ-123", "summary": "...", "reason": "..." }
  ]
}
```

## Failure handling

If a server subagent fails entirely, treat it as:
`{ "server_name": "...", "error": "subagent failed", "total_updated": 0, "assigned_to_me": [], "status_changes": [], "new_comments": [], "blocked": [] }`

If `jira` is not installed or auth fails, set `error` to the message and empty arrays
for all fields.

## Merge results

Collect all subagent results into:

```json
{
  "servers": {
    "{server_name}": { ...per-server result... }
  }
}
```

Proceed to `steps/04-score-output.md` with both Slack and Jira merged results.
