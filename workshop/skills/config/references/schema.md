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
          "site": "twg site prefix",
          "projects": ["PROJECTKEY"],
          "auth": "oauth | api-token",
          "login": "account email (api-token only)",
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
| `site` | yes | twg site prefix (`velir` for `https://velir.atlassian.net`). Consumers pass it as `--site` or `TWG_SITE`. |
| `projects` | yes | Project keys to query. twg has no default project, so a query without `project = KEY` spans the whole site. |
| `auth` | no | `"oauth"` (default) uses the `twg login` session, which covers only sites in the user's Atlassian organization. `"api-token"` is for any other site: consumers export `TWG_CONFIG_DIR=~/.config/twg-<name>`, `TWG_USER=<login>`, `TWG_TOKEN="$JIRA_API_TOKEN"` and `TWG_SITE=<site>` in a subshell. The isolated config directory keeps the OAuth session intact. |
| `login` | with api-token | Account email for API-token auth. The token itself stays in `JIRA_API_TOKEN` and is never stored here. |
| `config_file` | legacy | jira-cli config path from before the twg migration. Ignored. |

### Legacy mapping

| Legacy field | workshop.json location |
|---|---|
| `slack.workspaces[]` | `integrations.slack.workspaces[]` |
| `jira.projects[]` | use project cwd_patterns |
| `channels` | stored in `data_path/prioritize/channels.json` |
