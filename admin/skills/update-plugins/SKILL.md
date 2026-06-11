---
name: update-plugins
description: Reinstalls all locally installed CLAUDE-PLUGINS plugins to their latest versions and updates any hardcoded version paths in the project CLAUDE.md. Use when the user says "update plugins", "update my plugins", "get latest plugins", "refresh plugins", "plugin update", or after a plugin version bump to propagate changes. NOT for updating npm/pip/composer packages or for bumping plugin versions (use admin:bump-version for that).
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

Update all installed local marketplace plugins and fix stale version paths in CLAUDE.md.

## Procedure

```bash
zsh "${CLAUDE_SKILL_DIR}/update-plugins.sh" "$PWD/CLAUDE.md"
```

## Report

- For each `PLUGIN_BEFORE:<name>:<v>` / `PLUGIN_AFTER:<name>:<v>` pair:
  - Versions differ: `<name>: <before> → <after>  ✓`
  - Same: `<name>: <version>  (already up to date)`
  - `not-installed`: skip
- If `CLAUDE_MD_UPDATED:<n>` > 0: show count of path references updated
- If `STATUS:unchanged`: `All plugins already up to date. No changes made.`

Always append: `Run /reload-plugins to apply updated plugin definitions (no restart required).`

## Notes

- **Clean cache wipe with assertions**: use `reinstall-plugin.sh all` outside a Claude session.
- **Scope**: user scope (`--scope user`) — applies to all projects on this machine.
- **Single-plugin reinstall**:
  ```bash
  env -u CLAUDECODE claude plugin uninstall <name>
  env -u CLAUDECODE claude plugin install <name>@local --scope user
  ```
