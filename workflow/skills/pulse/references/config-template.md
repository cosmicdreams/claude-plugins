# workflow:pulse Configuration

## Config file

Checked in order: `.claude/workflow.json` (project scope) → `~/.claude/workflow.json` (user scope).
If neither exists, `.claude/workflow.json` is created from this template.

Human-authored and agent-updated. Edit directly or ask Claude to update it.

```json
{
  "enabled": true,
  "priority_threshold": "medium",
  "jira": {
    "servers": [
      {
        "url": "https://acme.atlassian.net",
        "name": "Acme",
        "config_file": "~/.config/.jira/.config-acme.yml",
        "projects": ["PROJ", "INFRA"]
      }
    ]
  },
  "slack": {
    "workspaces": [
      {
        "url": "https://myteam.slack.com",
        "name": "My Team",
        "user_id": null,
        "keywords": ["deploy", "incident"],
        "channels": ["team-general", "alerts"]
      }
    ]
  }
}
```

`user_id` is populated automatically on first run and cached for all future runs.

## Field Reference

### Top-level

| Field | Type | Description |
|---|---|---|
| `enabled` | boolean | Set to `false` to pause pulse without deleting config |
| `priority_threshold` | string | Minimum priority to surface: `low` / `medium` / `high` / `critical` |
| `jira` | object | Jira configuration (see below) |
| `slack` | object | Slack configuration (see below) |

### jira object

| Field | Type | Description |
|---|---|---|
| `servers` | list | One entry per Jira server — see server object below |

### jira server object

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Jira instance URL (e.g. `https://acme.atlassian.net`) |
| `name` | string | recommended | Human-readable label shown in output |
| `config_file` | string | no | Path to jira-cli config for this server. Create with: `JIRA_CONFIG_FILE=<path> jira init`. Omit to use the default jira-cli config. |
| `projects` | list | yes | Project codes to watch on this server (e.g. `PROJ`, `INFRA`) |

### workspace object (inside slack.workspaces)

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Full workspace URL (e.g. `https://myteam.slack.com`) |
| `name` | string | recommended | Human-readable label shown in output |
| `user_id` | string | auto | Your Slack user ID — set automatically on first run via `agent-slack auth whoami` |
| `channels` | list | yes | Channel names to monitor (no `#` prefix) |
| `keywords` | list | no | Keywords to flag in this workspace's channels (case-insensitive) |

---

## State file

`~/.claude/office-pulse.state.jsonl` — do not edit manually.
One JSON line per run, trimmed automatically to last 7 days.
Tracks `ts` (last run timestamp) and `jira_snapshots` (issue comment/status snapshots).
