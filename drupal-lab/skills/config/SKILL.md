---
name: config
description: >
  Discover and configure drupal-lab integrations into ~/.claude/drupal-lab.json — probes
  DDEV and Acquia CLI, finds Drupal project roots, asks about naming conventions and
  Drupal.org credentials. Run on first setup or when a drupal-lab skill cannot find its
  project.
triggers:
  - "drupal-lab:config"
  - "configure drupal-lab"
  - "set up drupal project"
  - "add drupal project"
  - "drupal-lab setup"
allowed-tools: Bash, Read, Write, AskUserQuestion
---

# drupal-lab:config — Project Discovery & Configuration

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Discover and configure drupal-lab integrations. Run drupal-lab:config when setting up for the first time, after adding a new Drupal project, or when a drupal-lab skill cannot find its project context. Probes the system for DDEV and Acquia CLI, discovers Drupal project roots, asks about naming conventions and Drupal.org credentials, and writes ~/.claude/drupal-lab.json. Trigger when: "drupal-lab:config", "configure drupal-lab", "set up drupal project", "add drupal project", or when any drupal-lab skill reports config missing.

Builds `~/.claude/drupal-lab.json` by probing the system and consulting the user.
All drupal-lab skills read this config to resolve which project they are working in
and how to interact with DDEV and Drupal.org.

## When to run

- First-time setup (config file doesn't exist)
- Adding a new Drupal project
- A drupal-lab skill reports "project not found" or "config missing"
- User explicitly asks to reconfigure

## Steps

1. **Detect** — probe for DDEV, Acquia CLI, git
   → Read `steps/01-detect.md`

2. **Projects** — discover Drupal project roots and DDEV conventions
   → Read `steps/02-projects.md`

3. **Drupal.org** — username and git remote for MR submission
   → Read `steps/03-drupalorg.md`

4. **Write config** — assemble and save `~/.claude/drupal-lab.json`
   → See schema in `references/schema.md`

## After completing

Tell the user which projects were configured. If any drupal-lab skill is currently
waiting on config, the user can re-run it now.
