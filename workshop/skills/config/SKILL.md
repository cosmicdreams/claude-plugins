---
name: config
description: >
  Discover and configure workflow integrations into ~/.claude/workshop.json — probes for
  available CLIs and asks about your integrations and projects. Run on first setup or when
  a workshop skill reports missing config.
triggers:
  - "workshop:config"
  - "configure workflows"
  - "set up workflow config"
  - "add integration"
  - "add jira server"
  - "add slack workspace"
  - "update workflow config"
  - "workflow setup"
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# workshop:config — Integration Discovery & Configuration

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Discover and configure workflow integrations. Run workshop:config when setting up for the first time, after adding a new tool, or when a workflow skill reports that config is missing or incomplete. Probes the system for available CLIs, asks about your integrations and projects, and writes ~/.claude/workshop.json. Trigger when the user says "configure workflows", "set up workflow config", "workshop:config", "add a new integration", or when any workflow skill reports config is missing.

Builds `~/.claude/workshop.json` by probing the system and consulting the user. All workshop skills read this config.

See `references/schema.md` for the full JSON schema.

## When to run

- First-time setup (config file doesn't exist)
- Adding a new tool or workspace
- A workflow skill reports "config missing" or "integration not found"

## Step 1 — Detect Available Tools

Probe silently. Do not ask the user anything yet.

```bash
for tool in agent-slack jira gh gws rg obsidian trcli; do
  command -v $tool &>/dev/null && echo "$tool: $(command -v $tool)" || echo "$tool: not found"
done
gh auth status 2>&1 | head -3 || echo "gh: not authenticated"
jira me 2>&1 | head -2 || echo "jira: not authenticated"
[ -f ~/.claude/workshop.json ] && cat ~/.claude/workshop.json
[ -f ~/.claude/office-pulse.json ] && echo "legacy office-pulse.json found"
```

## Step 2 — Configure Integrations

For each tool found, gather the details. Skip tools not present.

**Slack** (if `agent-slack` is available): Ask which workspaces the user uses; which is the default. Parse into `integrations.slack.workspaces[]`.

**Jira** (if `jira` is available): Auto-detect **every** configured server, not just the default.
jira-cli supports one server per config file, so a second Jira instance always means a second
config file. Probe the whole directory:
```bash
ls ~/.config/.jira/*.yml 2>/dev/null
for f in ~/.config/.jira/*.yml; do
  echo "--- $f"
  grep -E "^server:|^project:|^  key:" "$f" 2>/dev/null | head -5
done
```
`.config.yml` is the default server; any `.config-<name>.yml` is an additional one.

For each server found, record:
- `name` — from the file suffix (`.config-acu.yml` → `acu`), or `velir`-style from the URL host for the default
- `url` — the `server:` value
- `config_file` — `"default"` for `.config.yml`, otherwise the full path
- `projects` — ask the user which project keys they work in on that server; the config file's
  own `project.key` is only the CLI default, not the full list

Verify each server independently before writing it:
```bash
JIRA_CONFIG_FILE=<path> jira issue list -p<KEY> -q "assignee = currentUser()" --plain --no-headers 2>&1 | head -3
```
A server that fails here should still be written, with a note — the user needs to see it exists
and is broken rather than have it silently missing. Omitting `config_file` is the common cause of
a second server being invisible to `workshop:prioritize`.

**GitHub** (if `gh` is authenticated): No further questions — `gh` uses the authenticated account automatically. Set `integrations.github.available: true`.

**Google Workspace** (if `gws` is available): Ask if the user uses Google for email and calendar. Set `integrations.email` and `integrations.calendar` with `provider: "google"`.

**TestRail** (if `trcli` is available): Ask for the server URL. Set `integrations.testrail.url`.

**Obsidian** (check `~/Vaults/` or `~/.vaults/`): Ask for vault name and path. Set `integrations.obsidian`.

## Step 3 — Map Projects to Integrations

Skip if the user has only one Jira server and one Slack workspace.

If multiple servers or workspaces exist, ask whether to map directories to integrations. Format per block:
```
alias=schusterman
paths=/Users/you/Sites/SCHUSTERMAN
jira=schusterman
slack=client-co
```

Parse into `projects[]` entries with `alias`, `cwd_patterns[]`, `jira`, `slack_workspace`.

When a workflow skill runs, it checks whether the current working directory matches any `cwd_patterns` — if so, uses that project's integrations; otherwise uses the `default: true` entry.

## Step 4 — Configure Data Storage

If Obsidian was configured: suggest `<vault_path>/.claude/plugin-data/` for workflow data — survives plugin upgrades and is visible in Obsidian.

Ask: "Store workflow data in your Obsidian vault at `<vault_path>/.claude/plugin-data/`? (yes/no, or enter a custom path)"

If no vault or user declines: default to `~/.claude/plugin-data/`.

Write to config as `data_path`.

## Step 5 — Write Config

Assemble all gathered values into `~/.claude/workshop.json` per the schema in `references/schema.md`. Write with:

```bash
cat > ~/.claude/workshop.json <<'EOF'
{ ... assembled JSON ... }
EOF
```

If `~/.claude/office-pulse.json` exists, offer to migrate: extract channel/jira config into the new schema and remove the old file.

## After completing

Tell the user which integrations were configured and which were skipped (not installed).
