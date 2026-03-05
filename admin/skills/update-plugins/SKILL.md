---
name: update-plugins
description: Update all locally installed plugins to their latest versions and refresh any hardcoded version paths in the project's CLAUDE.md. Use when asked to "update plugins", "update my plugins", "get the latest plugins", or when a plugin author has released new versions.
triggers:
  - "update plugins"
  - "update my plugins"
  - "update the plugins"
  - "get latest plugins"
  - "plugin update"
  - "refresh plugins"
allowed-tools: Bash
---

# Update Plugins

Update all installed local marketplace plugins and fix any stale version paths in the project's CLAUDE.md.

## Procedure

### 1. Run Update Script

```bash
bash "${CLAUDE_SKILL_DIR}/update-plugins.sh" "$PWD/CLAUDE.md"
```

### 2. Report

Parse the script output and present to the user:

- For each `PLUGIN_BEFORE:<name>:<v>` / `PLUGIN_AFTER:<name>:<v>` pair:
  - If versions differ: `<name>: <before> → <after>  ✓`
  - If same: `<name>: <version>  (already up to date)`
  - If `not-installed`: skip
- If `CLAUDE_MD_UPDATED:<n>` is > 0: show count of path references updated
- If `STATUS:unchanged`: print `All plugins already up to date. No changes made.`
- Always append: `Run /reload-plugins to apply updated plugin definitions (no restart required).`

## Notes

- **Clean cache wipe with assertions**: use `reinstall-plugin.sh all` outside a Claude session instead.
- **Scope**: updates apply at user scope (`--scope user`) — covers all projects on this machine.
