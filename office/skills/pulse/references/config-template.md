# office:pulse Configuration

## Config file: ~/.claude/office-pulse.json

Single source of truth for all pulse and morning-brief configuration. Human-authored and agent-updated.
Edit directly or ask Claude to update it.

```json
{
  "enabled": true,
  "email_source": "gmail",
  "priority_threshold": "medium",
  "jira": {
    "projects": ["PROJ", "INFRA"]
  },
  "slack": {
    "workspaces": [
      {
        "url": "https://drupal.slack.com",
        "name": "Drupal",
        "keywords": ["urgent", "blocked", "your-name-here"],
        "channels": ["general", "experience-builder", "preview", "javascript"]
      },
      {
        "url": "https://myteam.slack.com",
        "name": "My Team",
        "keywords": ["deploy", "incident"],
        "channels": ["team-general", "alerts"]
      }
    ]
  },
  "updated": "2026-03-11T09:00:00",
  "updated_by": "user"
}
```

## Field Reference

### Top-level

| Field | Type | Description |
|---|---|---|
| `enabled` | boolean | Set to `false` to pause pulse without deleting config |
| `email_source` | string | Email provider — only `gmail` supported (via `gws`) |
| `priority_threshold` | string | Minimum priority to surface: `low` / `medium` / `high` / `critical` |
| `jira` | object | Jira configuration (see below) |
| `slack` | object | Slack configuration (see below) |
| `updated` | string | ISO timestamp of last update (managed by agent) |
| `updated_by` | string | What wrote the last update (managed by agent) |

### jira object

| Field | Type | Description |
|---|---|---|
| `projects` | list | Jira project codes to watch (e.g. `PROJ`, `INFRA`) |

### slack object

| Field | Type | Description |
|---|---|---|
| `workspaces` | list | List of workspace objects — one entry per Slack workspace |

### workspace object (inside slack.workspaces)

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Full workspace URL (e.g. `https://drupal.slack.com`) |
| `name` | string | recommended | Human-readable label shown in output |
| `channels` | list | yes | Channel names to monitor in this workspace (no `#` prefix) |
| `keywords` | list | no | Keywords to flag in this workspace's channels (case-insensitive) |

---

## Project-level override: .claude/office-pulse.json

Optional. Place in any project's root `.claude/` directory. Uses the same JSON schema.
Only these fields are used when the project override is active:

```json
{
  "jira": {
    "server": "https://acme.atlassian.net",
    "config_file": "~/.config/.jira/.config-acme.yml",
    "projects": ["PROJ", "INFRA"]
  },
  "slack": {
    "workspaces": [
      {
        "url": "https://myteam.slack.com",
        "name": "My Team",
        "channels": ["project-general", "project-dev"]
      }
    ]
  }
}
```

| Field | Description |
|---|---|
| `jira.server` | Alternate Jira instance URL for this project |
| `jira.config_file` | Path to jira-cli config for the alternate instance. Create with: `JIRA_CONFIG_FILE=<path> jira init` |
| `jira.projects` | Project codes on the alternate Jira instance |
| `slack.workspaces` | Project-specific workspaces/channels. Say "use project channels" to activate. |

When pulse runs from a project directory with this file:
- Project Jira fetched via `jira.config_file` against `jira.server`
- Global Jira uses the default jira-cli config
- If project `slack.workspaces` differ from active config, pulse shows:
  `[project config available — say "use project channels" to switch]`

---

## Modifying config mid-session

| What you say | What happens |
|---|---|
| "add #channel to [workspace]" | Appends channel to that workspace in `office-pulse.json` |
| "remove #channel from [workspace]" | Removes channel from that workspace |
| "add a keyword [term] to [workspace]" | Adds workspace-level keyword |
| "use project channels" | Copies project `.claude/office-pulse.json` workspaces into main config |

---

## State file

`~/.claude/office-pulse.state.jsonl` — do not edit manually.
One JSON line per run. Trimmed automatically to last 7 days.
Tracks `email_last_id`, `jira_snapshots`, and `slack_channels` (last-seen `ts` per channel,
keyed as `workspace_hostname/channel_name`).
