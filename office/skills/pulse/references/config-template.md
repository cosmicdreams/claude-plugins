# office:pulse Configuration Template

Create this file at `~/.claude/office-pulse.local.md`.
This is a user-level config — it lives in your home `.claude/` directory, not in any project.

```markdown
---
enabled: true
jira_projects:
  - PROJ
  - INFRA
email_source: gmail
priority_threshold: medium
slack_default_workspace: https://drupal.slack.com
slack_keywords:
  - urgent
  - blocked
  - your-name-here
slack_channels:
  - channel: general
  - channel: project-alpha
  - channel: project-beta
  - channel: project-gamma
    workspace: https://other.slack.com
---
```

## Field Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Set to `false` to pause pulse without deleting config |
| `jira_projects` | list | required | Jira project codes to watch (e.g. `PROJ`, `INFRA`) |
| `email_source` | string | `gmail` | Email provider. Only `gmail` supported (via `gws`) |
| `priority_threshold` | string | `medium` | Minimum priority to surface: `low`, `medium`, `high`, `critical` |
| `slack_default_workspace` | string | `https://slack.com` | Default Slack workspace URL. Applied to any channel entry that omits `workspace`. |
| `slack_keywords` | list | `[]` | Keywords to flag in Slack messages (case-insensitive). Add your name, project names, or alert terms. |
| `slack_channels` | list | `[]` | Channels to monitor. Each entry: `{ channel: name, workspace?: url }`. Omit `workspace` to use `slack_default_workspace`. |

## Project-level channel override

To get a focused briefing when working in a specific project, create `.claude/office-pulse.local.md`
in that project's root directory:

```markdown
---
slack_channels:
  - channel: experience-builder
  - channel: preview
---
```

**Merge rules:**
- `slack_channels` from the project config **replaces** the global list entirely
- All other fields (`jira_projects`, `email_source`, `priority_threshold`, `slack_keywords`,
  `slack_default_workspace`) are always read from the global config — project config cannot override them
- Running from outside any project directory → global channels (full briefing)
- Running from inside a project directory with `.claude/office-pulse.local.md` → project channels only

## Ad-hoc daily override (focus file)

`office:morning-brief` writes `~/.claude/office-slack-focus.json` with a confirmed channel list.
If that file exists and is non-empty, pulse uses it instead of either config. This lets you temporarily
focus on different channels without editing your config files.

To clear the focus override and revert to config channels, delete the focus file:
```bash
rm ~/.claude/office-slack-focus.json
```

## State file

Pulse automatically maintains `~/.claude/office-pulse.state.jsonl` — do not edit manually.
Each line is a timestamped snapshot used to compute deltas between broadcasts.
The file is trimmed automatically to the last 7 days of entries.
The `slack_channels` field within each state entry tracks the last-seen Slack `ts` per channel.
