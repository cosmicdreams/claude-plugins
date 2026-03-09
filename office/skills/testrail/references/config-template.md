# office:testrail Configuration Template

Create this file at `~/.claude/office-testrail.local.md`.
User-level config — lives in `~/.claude/`, not in any project directory.

**The API key is NOT stored here.** See "API Key Setup" below.

```markdown
---
host: yourinstance.testrail.io
username: your@email.com
default_project_id: 1
---
```

## Field Reference

| Field | Required | Description |
|---|---|---|
| `host` | yes | TestRail instance hostname (no `https://` prefix) |
| `username` | yes | Your TestRail login email |
| `default_project_id` | no | Used when no project is specified in a command |

## API Key Setup (choose one)

### Option 1: 1Password CLI (recommended — already installed)

Sign in and store the key:
```bash
op signin   # first-time account setup — follow the prompts
op item create --category login --title "TestRail" \
  --field "username=your@email.com" \
  --field "credential=your-api-key"
```

The skill reads it as: `op://Private/TestRail/credential`

To verify:
```bash
op read "op://Private/TestRail/credential"
```

To update:
```bash
op item edit "TestRail" --field "credential=new-api-key"
```

### Option 2: macOS Keychain

Encrypted at rest, unlocked by Touch ID / login password:
```bash
security add-generic-password -s "testrail" -a "your@email.com" -w "your-api-key"
```

To verify: `security find-generic-password -s "testrail" -a "your@email.com" -w`

### Option 3: Environment variable

Add to `~/.zshrc`:
```bash
export TESTRAIL_API_KEY="your-api-key"
```

## Generating a TestRail API Key

1. Log into TestRail
2. Go to **My Settings** (top-right avatar menu)
3. Select the **API Keys** tab
4. Click **Add Key**, give it a name, copy the key
5. Store it using one of the methods above — never paste it into a file

## Finding IDs

Once configured, run `office:testrail` → "list projects" to find your `project_id`.
Then "list plans" or "list suites" to find the IDs you need for test extraction.
