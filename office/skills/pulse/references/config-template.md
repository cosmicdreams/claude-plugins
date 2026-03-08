# office:pulse Configuration Template

Create this file at `~/.claude/office-pulse.local.md`.
This is a user-level config — it lives in your home `.claude/` directory, not in any project, because pulse scans all your email and Jira regardless of which project you're working in.

```markdown
---
enabled: true
jira_projects:
  - PROJ
  - INFRA
email_source: gmail
priority_threshold: medium
---
```

## Field Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Set to `false` to pause pulse without deleting config |
| `jira_projects` | list | required | Jira project codes to watch (e.g. `PROJ`, `INFRA`) |
| `email_source` | string | `gmail` | Email provider. Only `gmail` supported (via `gws`) |
| `priority_threshold` | string | `medium` | Minimum priority to surface: `low`, `medium`, `high`, `critical` |

## State file

Pulse automatically maintains `~/.claude/office-pulse.state.jsonl` — do not edit manually.
Each line is a timestamped snapshot used to compute deltas between broadcasts.
The file is trimmed automatically to the last 7 days of entries.
