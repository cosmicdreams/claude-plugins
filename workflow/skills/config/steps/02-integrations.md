# Step 2 — Configure Integrations

For each tool detected as available in Step 1, gather the details needed.
Skip tools that were not found. Use `AskUserQuestion` for each integration block.

## Slack

If `slack` CLI is available:

Ask: "Which Slack workspaces do you use? List them (e.g. 'acquia, client-co'). Mark the default with a * (e.g. 'acquia*, client-co')."

Parse the response into a list of workspace entries. The one marked * (or the only one) is `default: true`.

```json
"slack": {
  "workspaces": [
    { "name": "acquia", "default": true },
    { "name": "client-co" }
  ]
}
```

## Jira

If `jira-cli` is available:

Try to auto-detect configured servers:
```bash
jira config list 2>/dev/null | grep -E "^server|^host" | head -10
cat ~/.config/.jira/.config.yml 2>/dev/null | grep -E "server:|host:" | head -10
```

Ask: "Which Jira servers do you have? Format: 'alias=server.atlassian.net' (one per line). Mark the default with *."

Example response:
```
work*=acquia.atlassian.net
schusterman=schusterman.atlassian.net
```

Parse into:
```json
"jira": {
  "servers": [
    { "alias": "work", "url": "acquia.atlassian.net", "default": true },
    { "alias": "schusterman", "url": "schusterman.atlassian.net" }
  ]
}
```

## GitHub

If `gh` is available and authenticated:

```bash
gh auth status 2>&1 | grep -E "Logged in|Account"
```

No further questions needed — `gh` uses the authenticated account automatically.

```json
"github": { "available": true }
```

## Google Workspace (email + calendar)

If `gws` is available:

Ask: "Do you use Google Workspace for email and calendar? (yes/no)"

```json
"email": { "provider": "google", "available": true },
"calendar": { "provider": "google", "available": true }
```

## TestRail

If `trcli` is available:

Ask: "What is your TestRail server URL? (e.g. 'company.testrail.io')"

```json
"testrail": { "available": true, "url": "company.testrail.io" }
```

## Obsidian

If `obsidian` CLI or Obsidian REST API is available, or if `~/.vaults` or `~/Vaults` exists:

```bash
ls ~/Vaults/ 2>/dev/null || ls ~/.vaults/ 2>/dev/null
```

Ask: "What is your Obsidian vault name and path? (e.g. 'Neurons=~/Vaults/Neurons')"

```json
"obsidian": {
  "available": true,
  "vault": "Neurons",
  "vault_path": "~/Vaults/Neurons"
}
```
