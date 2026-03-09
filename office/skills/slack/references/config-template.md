# office:slack Configuration Template

Create this file at `~/.claude/office-slack.local.md`.
User-level config — lives in `~/.claude/`, not in any project directory.

```markdown
---
channels:
  - general
  - engineering
  - alerts
message_limit: 50
---
```

## Field Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `channels` | list | none | Channel names or IDs to watch. Used as default when calling skills don't specify channels explicitly. |
| `message_limit` | integer | `50` | Default number of messages to fetch per channel per run. Increase for busier channels. |

## Notes

- Channel names are case-sensitive and should match exactly as they appear in Slack (without the `#` prefix)
- Channel IDs (e.g. `C01234567`) also work and are more stable than names
- Run `office:slack` → "list my slack channels" to get IDs for all your joined channels
- This config is read by `office:slack` and passed through to `office:pulse` and `office:morning-brief`
