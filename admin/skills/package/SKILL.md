---
name: admin:package
description: >
  Build Desktop-distributable .zip archives for one or all plugins into dist/. Run after
  admin:bump-version when preparing a release.
triggers:
  - "package plugin"
  - "build plugin"
  - "package for desktop"
  - "create plugin zip"
  - "distribute plugin"
allowed-tools: Bash
---

# admin:package — Build Desktop Archives

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Build Desktop-distributable .zip archives for one or all plugins. Use when the user says "package plugin", "build plugin for desktop", "create plugin zip", "package for Claude Desktop", or "distribute plugin". Output lands in dist/ at the repo root. Run after admin:bump-version before distributing a new release.

Produces `.zip` archives distributable via Claude Desktop Personal Plugins upload.

## Usage

```bash
# One plugin
zsh "${CLAUDE_PLUGIN_ROOT}/admin/scripts/package-plugin.sh" <plugin-name>

# All plugins
zsh "${CLAUDE_PLUGIN_ROOT}/admin/scripts/package-plugin.sh" all
```

Output: `dist/<plugin-name>.zip` at the repo root. Each archive has `.claude-plugin/` at its root — the structure Claude Desktop expects.

## Install via Claude Desktop

1. Run `admin:package <plugin-name>` to produce the zip.
2. In Claude Desktop: **Customize → Personal Plugins → Upload Plugin**.
3. Upload `dist/<plugin-name>.zip`. The `.plugin` extension is equivalent to `.zip` — upload as `.zip`.

## When to run

- After `admin:bump-version` when preparing a release for Desktop users
- Before sharing a plugin with another person
- After any rewrite that changes skill or agent behavior

## Notes

- `dist/` is gitignored — archives are build artifacts, not source.
- To update plugins in the local CLI environment, use `admin:update-plugins` instead.
