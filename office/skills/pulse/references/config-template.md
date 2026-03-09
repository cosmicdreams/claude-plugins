# office:pulse Configuration Template

## Static config: ~/.claude/office-pulse.local.md

Human-authored. Never modified at runtime. Provides initial defaults and a seed channel list.

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
  - channel: experience-builder
  - channel: javascript
    workspace: https://drupal.slack.com
---
```

## Field Reference

| Field | Type | Description |
|---|---|---|
| `enabled` | boolean | Set to `false` to pause pulse without deleting config |
| `jira_projects` | list | Jira project codes to watch (e.g. `PROJ`, `INFRA`) |
| `email_source` | string | Email provider — only `gmail` supported (via `gws`) |
| `priority_threshold` | string | Minimum priority to surface: `low` / `medium` / `high` / `critical` |
| `slack_default_workspace` | string | Workspace URL applied to any channel entry that omits `workspace` |
| `slack_keywords` | list | Keywords to flag in messages (case-insensitive). Add your name, project names, alert terms. |
| `slack_channels` | list | Seed channel list. Written to `office-pulse.json` on first run only. Each entry: `{ channel: name, workspace?: url }` |

---

## Runtime config: ~/.claude/office-pulse.json

**This is the source of truth for which channels pulse monitors.**

Agent-owned and updated mid-session when you tell Claude to add, remove, or switch channels.
Do not edit manually — ask Claude to update it instead.

Created automatically on first pulse run, seeded from `slack_channels` in the static config.

```json
{
  "updated": "2026-03-09T09:30:00",
  "updated_by": "pulse-init",
  "slack_channels": [
    { "workspace": "https://drupal.slack.com", "channel": "experience-builder" },
    { "workspace": "https://drupal.slack.com", "channel": "preview" }
  ]
}
```

### Modifying channels mid-session

Say any of the following to Claude while pulse is running:

| What you say | What happens |
|---|---|
| "add #channel" | Appends channel to `office-pulse.json` |
| "remove #channel" | Removes channel from `office-pulse.json` |
| "switch to #ch1 and #ch2" | Replaces channel list entirely |
| "use project channels" | Copies channels from `.claude/office-pulse.local.md` into JSON |
| "reset slack channels" | Copies channels from `~/.claude/office-pulse.local.md` into JSON |

---

## Project-level seed: .claude/office-pulse.local.md

Optional. Place in any project's root `.claude/` directory. Contains only `slack_channels`.

```markdown
---
slack_channels:
  - channel: experience-builder
  - channel: preview
---
```

When you run pulse from inside a project directory that has this file, pulse detects it and
shows: `[project config available — say "use project channels" to switch]`

Saying "use project channels" writes those channels into `~/.claude/office-pulse.json`.
All other settings (Jira, email, keywords, workspace) always come from the global static config.

---

## State file

`~/.claude/office-pulse.state.jsonl` — do not edit manually.
One JSON line per run. Trimmed automatically to last 7 days.
Tracks `email_last_id`, `jira_snapshots`, and `slack_channels` (last-seen `ts` per channel).
