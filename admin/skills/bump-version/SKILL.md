---
name: bump-version
description: Bumps the semantic version (major/minor/patch) of one or all CLAUDE-PLUGINS plugins, updates all version references, writes CHANGELOG entries, and provides a reinstall command. Use when the user says "bump version", "increment version", "release a new version", "version bump", "update plugin version to X.Y.Z", or after completing plugin changes that warrant a version update. NOT for checking which version is installed or updating npm/composer packages.
triggers:
  - "bump version"
  - "increment version"
  - "release new version"
  - "version bump"
  - "bump the version"
  - "semver"
  - "update plugin version"
allowed-tools: Read, Write, Edit, Bash
---

# Bump Plugin Version (SemVer)

Bump one or all CLAUDE-PLUGINS plugin versions following Semantic Versioning rules, then reinstall.

## SemVer Decision Rules

| Change type | Bump |
|-------------|------|
| Breaking change to skill/agent API, removed skills, changed hook contracts | **major** |
| New skill, new agent, new hook, backwards-compatible new feature | **minor** |
| Bug fix, documentation update, prompt improvement, script fix | **patch** |

When in doubt, ask the user: "Was this a bug fix (patch), new feature (minor), or breaking change (major)?"

## Procedure

### 1. Determine scope and bump type

- If `$ARGUMENTS` specifies a plugin name and/or bump type, use them.
- Otherwise inspect what changed (`git diff` or context from the conversation) and apply the decision rules above.
- If still unclear, ask the user before proceeding.

Valid plugin names: `sprint`, `retro`, `ideate`, `admin`, `drupal-lab`, `all`
Valid bump types: `major`, `minor`, `patch`

### 2. Run the bump script

```zsh
zsh admin/skills/bump-version/scripts/bump-version.sh <plugin> <bump-type>
```

The script prints the before/after version and every file it modifies.

### 3. Update CHANGELOG.md

Prepend a new section to `<plugin>/CHANGELOG.md` mirroring Claude Code's release notes format:

```markdown
## <new-version>
- Summary of change one
- Summary of change two
```

Rules:
- One bullet per logical change (not per file edited)
- Plain English — written for a plugin user reading release notes
- No dates, no categories (Added/Fixed), no PR numbers
- Derive entries from the git diff or conversation context; ask the user if unclear

### 4. Clean and reinstall

Old cached versions accumulate on every reinstall. One script handles both: it wipes all cached versions first, then reinstalls clean.

```zsh
zsh admin/skills/bump-version/scripts/reinstall-plugin.sh <plugin|all>
```

**Must be run in a separate terminal** — the Claude CLI cannot run inside an active Claude Code session (`CLAUDECODE` env var blocks it). Provide this command to the user.

Why clean-then-reinstall: wiping first removes all stale versions before the fresh install. Since reinstall follows immediately, there is no risk of an empty cache.

### 5. Confirm to the user

```
Version bumped: <plugin> <old> → <new>
Files updated: <count>
CHANGELOG: <plugin>/CHANGELOG.md updated
Reinstall command: zsh admin/skills/bump-version/scripts/reinstall-plugin.sh <plugin|all>
```

## Notes

- The cache path `~/.claude/plugins/cache/local/<plugin>/<version>/` changes with every version bump. The bump script handles updating hardcoded references to these paths.
- `reinstall-plugin.sh` reads the target version from `plugin.json` to confirm what was installed.
- CHANGELOG.md lives at `<plugin>/CHANGELOG.md` in the plugin root (e.g. `admin/CHANGELOG.md`).
