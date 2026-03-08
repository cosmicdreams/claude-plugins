---
name: changelog
description: Displays the admin plugin changelog, showing what changed across versions. Use when the user says "admin changelog", "what's new in admin", "what changed in admin", "admin release notes", "show admin changes", or asks about recent admin plugin updates. Supports filters: --latest for most recent version, --since X.Y.Z for changes after a specific version. NOT for viewing changelogs of other plugins or for bumping versions.
allowed-tools: Bash
---

# admin Release Notes

Read and output the admin CHANGELOG.

## Procedure

```bash
bash "${CLAUDE_SKILL_DIR}/read-changelog.sh" "admin" "${CLAUDE_PLUGIN_ROOT}" "${ARGUMENTS:-}"
```

Print the script output exactly as-is — no summarizing, no reformatting.

## Filters (passed via $ARGUMENTS)

| Argument | Behavior |
|----------|----------|
| *(none)* | Full CHANGELOG |
| `--latest` | Most recent version section only |
| `--since X.Y.Z` | All versions after X.Y.Z (exclusive) |
| `X.Y.Z` | That specific version's section |

## Usage by agents

Use `--since <known-version>` to find what changed since a prior encounter:

> `/admin:changelog --since 1.4.6`
