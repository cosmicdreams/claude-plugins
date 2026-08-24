# workshop.json Schema Reference

Full schema for `~/.claude/workshop.json`.

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
        {
          "name": "string",
          "url": "string",
          "projects": ["PROJECTKEY"],
          "config_file": "default | path to a jira-cli config yml",
          "default": true
        }
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
  "prioritize": {
    "weights": {
      "RESPOND": 100, "UNBLOCK": 80, "REVIEW": 40, "FYI": 10, "stale_bonus": 5,
      "scope": { "sprint": 30, "release": 20, "backlog": -30 }
    }
  },
  "scout": {
    "sources": [
      { "type": "feed | page | search", "url": "string", "name": "string", "cadence": "3d", "weight": 1.0 }
    ],
    "interests": ["string"],
    "anti_interests": ["string"],
    "feedback_weights": { "<source-or-topic:key>": 1.0 },
    "dedup_horizon": "7d"
  },
  "data_path": "string (absolute or ~ path)"
}
```

- `prioritize.weights` — optional override of the default ranking tiers used by `workshop:prioritize`.
- `scout` — source list, interest profile, and learned feedback weights for `workshop:scout`.

## Resolution rules (for agent reasoning)

- **Default integration**: use `default: true` entry for each integration type
- **Project context**: if cwd matches a project's `cwd_patterns`, use that project's integrations
- **Explicit override**: user passes an alias directly (e.g. `/prioritize schusterman`)
- **Ambiguous**: if cwd matches no project and there is no default, ask the user

## Migration from office-pulse.json

Legacy `~/.claude/office-pulse.json` fields map as follows:

### Jira server fields

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Referenced by `projects[].jira`. The schema previously called this `alias`; the running config uses `name`. |
| `url` | yes | Server base URL, for display only. |
| `projects` | yes | Project keys to query. **Every jira-cli query must pass `--project`** — without it the CLI falls back to the single `project` key in its config file and silently reports one project as the whole workload. |
| `config_file` | no | Path to a jira-cli config yml, or `"default"`. Set this for any server that is not the one jira-cli was initialized against; consumers export it as `JIRA_CONFIG_FILE`. A second server is unreachable without it. |

Discovery hint: jira-cli configs live in `~/.config/.jira/`. The default is `.config.yml`;
additional servers are conventionally `.config-<name>.yml`. Probe that directory rather than
assuming a single server exists.

### Legacy mapping

| Legacy field | workshop.json location |
|---|---|
| `slack.workspaces[]` | `integrations.slack.workspaces[]` |
| `jira.projects[]` | use project cwd_patterns |
| `channels` | stored in `data_path/prioritize/channels.json` |
