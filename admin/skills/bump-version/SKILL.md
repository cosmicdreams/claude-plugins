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

## SemVer Decision Rules

| Change type | Bump |
|-------------|------|
| Breaking change to skill/agent API, removed skills, changed hook contracts | **major** |
| New skill, new agent, new hook, backwards-compatible new feature | **minor** |
| Bug fix, documentation update, prompt improvement, script fix | **patch** |

When in doubt: "Was this a bug fix (patch), new feature (minor), or breaking change (major)?"

## Procedure

### 1. Determine scope and bump type

- Use `$ARGUMENTS` if it specifies a plugin name and/or bump type.
- Otherwise inspect what changed and apply the decision rules.
- If still unclear, ask before proceeding.

Valid plugin names: `sprint`, `retro`, `ideate`, `admin`, `drupal-lab`, `ideas-funnel`, `lib`, `workshop`, `drover`, `research-lab`, `improve`, `all`
Valid bump types: `major`, `minor`, `patch`

### 2. Run the bump script

```bash
admin/skills/bump-version/scripts/bump-version.sh <plugin> <bump-type>
```

The script prints the before/after version and every file it modifies.

### 3. Update CHANGELOG.md

Prepend to `<plugin>/CHANGELOG.md`:

```markdown
## <new-version>
- Summary of change one
- Summary of change two
```

One bullet per logical change. Plain English. No dates, no categories, no PR numbers.

### 4. Clean and reinstall

Must be run in a **separate terminal** — the Claude CLI cannot run inside an active Claude Code session.

```bash
admin/skills/bump-version/scripts/reinstall-plugin.sh <plugin|all>
```

After it completes, run `/reload-plugins` in the current session.

### 5. Confirm

```
Version bumped: <plugin> <old> → <new>
Files updated: <count>
CHANGELOG: <plugin>/CHANGELOG.md updated
Reinstall command: admin/skills/bump-version/scripts/reinstall-plugin.sh <plugin|all>
Then run /reload-plugins in this session.
```
