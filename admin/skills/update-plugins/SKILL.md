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
allowed-tools: Bash, Read, Edit, Grep, Glob
---

# Update Plugins

Update all installed local marketplace plugins and fix any stale version paths in the project's CLAUDE.md.

## Procedure

### 1. Capture pre-update versions

Record the currently installed version of each local plugin before updating:

```bash
for plugin in sprint admin drupal-lab git-ops; do
    version=$(ls ~/.claude/plugins/cache/local/$plugin/ 2>/dev/null | sort -V | tail -1)
    if [ -n "$version" ]; then
        echo "$plugin: $version"
    else
        echo "$plugin: not installed"
    fi
done
```

Store these as `BEFORE` versions for comparison.

### 2. Reinstall plugins

For each plugin that showed a version in step 1 (i.e., is installed), reinstall it:

```bash
claude plugin install sprint@local --scope user 2>&1
claude plugin install admin@local --scope user 2>&1
claude plugin install drupal-lab@local --scope user 2>&1
claude plugin install git-ops@local --scope user 2>&1
```

`claude plugin update` does not reliably apply changes — reinstall is the only mechanism that works. Skip any plugin that showed "not installed" in step 1.

### 3. Capture post-reinstall versions

Re-read installed versions after reinstalling:

```bash
for plugin in sprint admin drupal-lab git-ops; do
    version=$(ls ~/.claude/plugins/cache/local/$plugin/ 2>/dev/null | sort -V | tail -1)
    if [ -n "$version" ]; then
        echo "$plugin: $version"
    fi
done
```

Compare against `BEFORE` to identify which plugins actually changed.

### 4. Update CLAUDE.md version paths

For each plugin where the version changed (BEFORE ≠ AFTER), replace the old cache path version in the project's `CLAUDE.md`. Use the actual before/after versions captured in steps 1 and 3:

```bash
# Example: sprint changed from 1.2.1 to 1.4.6
sed -i '' "s|plugins/cache/local/sprint/1.2.1/|plugins/cache/local/sprint/1.4.6/|g" "$PWD/CLAUDE.md"

# Example: admin changed from 1.1.1 to 1.1.1
sed -i '' "s|plugins/cache/local/admin/1.1.1/|plugins/cache/local/admin/1.1.1/|g" "$PWD/CLAUDE.md"

# Example: drupal-lab changed from 1.1.1 to 1.2.1
sed -i '' "s|plugins/cache/local/drupal-lab/1.1.1/|plugins/cache/local/drupal-lab/1.2.1/|g" "$PWD/CLAUDE.md"
```

Only update CLAUDE.md if it exists in the current directory and contains version references. Skip silently if neither condition is met. If no plugins changed version, skip this step entirely.

### 5. Report

Print a clear summary:

```
Plugin updates:
  sprint:       1.1.1 → 1.4.6  ✓
  drupal-lab:   1.1.1 → 1.4.6  ✓
  git-ops:      1.1.1           (already up to date)

CLAUDE.md: updated 6 path references
  sprint/1.1.1/ → sprint/1.4.6/
  drupal-lab/1.1.1/  → drupal-lab/1.4.6/

⚠ Restart Claude Code to apply updated plugin definitions.
```

If nothing changed:
```
All plugins already up to date. No changes made.
```

## Notes

- **Restart required**: Updated plugin agents, skills, and hooks only take effect after restarting the Claude Code session.
- **CLAUDE.md paths are reference links** agents follow mid-session to read protocols and skills. Stale paths point at old cached content even after a plugin update. This step keeps them current.
- **Scope**: Updates are applied at user scope (`--scope user`), which covers all projects on this machine. No per-project update is needed.
- **Old versions are kept in cache** alongside new ones. Stale CLAUDE.md paths don't break — they just reference old content.
