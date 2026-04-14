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

Update all installed local marketplace plugins and fix any stale version paths in the project's CLAUDE.md.

## Procedure

### 1. Run Update Script

```bash
zsh "${CLAUDE_SKILL_DIR}/update-plugins.sh" "$PWD/CLAUDE.md"
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
- **Single-plugin reinstall** (e.g. after a one-off merge): there is no `reinstall` command and no `--local` flag. Paths do not work. The only correct form is:
  ```bash
  env -u CLAUDECODE claude plugin uninstall <name>
  env -u CLAUDECODE claude plugin install <name>@local --scope user
  ```
