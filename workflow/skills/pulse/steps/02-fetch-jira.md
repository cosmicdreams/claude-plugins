# Step 2 — Fetch Jira

Spawn one subagent per Jira server simultaneously.

## Subagent prompt template

```
You are a Jira data collection agent for workflow:pulse.

SERVER: {server.name} ({server.url})
JIRA_CONFIG_FILE: {server.config_file, or "default"}
PROJECTS: {server.projects}
LAST_RUN_DATE: {last_run_date}

If JIRA_CONFIG_FILE is not "default", export it before running any jira commands:
  export JIRA_CONFIG_FILE={server.config_file}

Use the lib:jira skill to fetch issues updated since LAST_RUN_DATE across all PROJECTS.
Focus on: issues assigned to you, issues with new comments, status changes, and blocked issues.
If LAST_RUN_DATE is unknown, look back 24 hours.
If jira is unavailable or auth fails, report that clearly.

Report your findings as a concise summary — what changed, what needs attention, any blockers.
Label each issue with its server name ({server.name}) so the synthesizing agent knows the source.
```

## No Jira servers configured

If `integrations.jira.servers` is empty, skip this step entirely and proceed with
Slack results only.
