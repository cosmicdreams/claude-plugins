# Step 3 — Map Projects to Integrations

This step is optional but significantly improves context inference. Skip if the user
has only one Jira server and one Slack workspace — defaults will always be correct.

If the user has multiple Jira servers or Slack workspaces, ask:

"Do you want to map specific directories to integrations? This lets workflow skills
automatically use the right Jira server or Slack workspace based on where you're working.

For each project, provide: alias, directory path(s), and which integrations to use.

Example:
```
alias=schusterman
paths=/Users/you/Sites/SCHUSTERMAN
jira=schusterman
slack=client-co
```

Enter one project per block, or skip if you only use defaults."

Parse each block into:

```json
{
  "alias": "schusterman",
  "cwd_patterns": ["/Users/you/Sites/SCHUSTERMAN"],
  "jira": "schusterman",
  "slack_workspace": "client-co"
}
```

## How workflow skills use this

When a workflow skill runs, it checks:
1. Does the current working directory match any `cwd_patterns`? → use that project's integrations
2. If not, use `default: true` integration for each type

The agent determines which project applies — this data is the input to that reasoning,
not a rigid lookup.
