# workflow.json Schema Reference

Full schema for `~/.claude/workflow.json`.

```json
{
  "integrations": {
    "slack": {
      "workspaces": [
        { "name": "string", "default": true }
      ]
    },
    "jira": {
      "servers": [
        { "alias": "string", "url": "string", "default": true }
      ]
    },
    "github": {
      "available": true
    },
    "email": {
      "provider": "google | microsoft",
      "available": true
    },
    "calendar": {
      "provider": "google | microsoft",
      "available": true
    },
    "testrail": {
      "available": true,
      "url": "string"
    },
    "obsidian": {
      "available": true,
      "vault": "string",
      "vault_path": "string"
    }
  },
  "projects": [
    {
      "alias": "string",
      "cwd_patterns": ["string"],
      "jira": "alias matching integrations.jira.servers[].alias",
      "slack_workspace": "name matching integrations.slack.workspaces[].name"
    }
  ],
  "data_path": "string (absolute or ~ path)"
}
```

## Resolution rules (for agent reasoning)

- **Default integration**: use `default: true` entry for each integration type
- **Project context**: if cwd matches a project's `cwd_patterns`, use that project's integrations
- **Explicit override**: user passes an alias directly (e.g. `/pulse schusterman`)
- **Ambiguous**: if cwd matches no project and there is no default, ask the user

## Migration from office-pulse.json

Legacy `~/.claude/office-pulse.json` fields map as follows:

| Legacy field | workflow.json location |
|---|---|
| `slack.workspaces[]` | `integrations.slack.workspaces[]` |
| `jira.projects[]` | use project cwd_patterns |
| `channels` | stored in `data_path/morning-brief/channels.json` |
