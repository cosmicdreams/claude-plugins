---
name: changelog
description: Display the sprint plugin version changelog from CHANGELOG.md. Use when the user wants to see plugin version history -- "sprint changelog", "what's new in sprint", "what changed in sprint", "sprint release notes", "show sprint versions", "what version is sprint". Default (no args) shows the full changelog. Supports --latest for the most recent version, --since X.Y.Z for versions after a specific release, or X.Y.Z for a specific version section. Do NOT confuse with sprint:project-notes which documents project-level sprint outcomes -- this skill reads the plugin's own CHANGELOG.md version history.
allowed-tools: Bash
---

# sprint Release Notes

Read and output the sprint plugin CHANGELOG.

## Procedure

```bash
bash "${CLAUDE_SKILL_DIR}/read-changelog.sh" "sprint" "${CLAUDE_PLUGIN_ROOT}" "${ARGUMENTS:-}"
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

> `/sprint:changelog --since 1.3.0`
