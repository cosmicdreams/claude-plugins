---
name: config
description: >
  Discover and configure workflow integrations. Run workflow:config when setting up
  for the first time, after adding a new tool, or when a workflow skill reports that
  config is missing or incomplete. Probes the system for available CLIs, asks about
  your integrations and projects, and writes ~/.claude/workflow.json.

  Trigger when the user says "configure workflows", "set up workflow config",
  "workflow:config", "add a new integration", or when any workflow skill reports
  config is missing.
triggers:
  - "workflow:config"
  - "configure workflows"
  - "set up workflow config"
  - "add integration"
  - "add jira server"
  - "add slack workspace"
  - "update workflow config"
  - "workflow setup"
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# workflow:config — Integration Discovery & Configuration

Builds `~/.claude/workflow.json` by probing the system and consulting the user.
All workflow skills read this config to know what's available and which integration
to use for a given context.

## When to run

- First-time setup (config file doesn't exist)
- Adding a new tool or workspace
- A workflow skill reports "config missing" or "integration not found"
- User explicitly asks to reconfigure

## Steps

Work through these in order. Read each step file as you need it.

1. **Detect** — probe the system for available CLIs
   → Read `steps/01-detect.md`

2. **Integrations** — configure each available integration
   → Read `steps/02-integrations.md`

3. **Projects** — map working directories to integrations
   → Read `steps/03-projects.md`

4. **Storage** — configure where workflow data is persisted
   → Read `steps/04-storage.md`

5. **Write config** — assemble and save `~/.claude/workflow.json`
   → See schema in `references/schema.md`

## After completing

Tell the user which integrations were configured and which were skipped (not installed).
If `~/.claude/office-pulse.json` exists, offer to migrate it: extract channel/jira config
into the new schema and remove the old file.
