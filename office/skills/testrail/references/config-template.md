# office:testrail Configuration Template

Create this file at `~/.claude/office-testrail.local.md`.
User-level config — lives in `~/.claude/`, not in any project directory.

```markdown
---
host: yourinstance.testrail.io
username: your@email.com
api_key: your-api-key-here
default_project_id: 1
---
```

## Field Reference

| Field | Required | Description |
|---|---|---|
| `host` | yes | TestRail instance hostname (no `https://` prefix) |
| `username` | yes | Your TestRail login email |
| `api_key` | yes | API key from TestRail → My Settings → API Keys |
| `default_project_id` | no | Used when no project is specified in a command |

## Generating an API key

1. Log into TestRail
2. Go to **My Settings** (top-right avatar menu)
3. Select the **API Keys** tab
4. Click **Add Key**, give it a name, copy the key
5. Paste it as `api_key` above

## Finding IDs

Once configured, run `office:testrail` → "list projects" to find your `project_id`.
Then "list plans" or "list suites" to find the IDs you need for test extraction.
