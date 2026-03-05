---
name: release-notes
description: Display sprint plugin release notes from CHANGELOG.md. Use when asked "what's new in sprint", "sprint release notes", "what changed in sprint", or "sprint changelog". Default (no args): outputs the full CHANGELOG exactly as written. Optional args: "--latest" shows only the most recent version; "--since X.Y.Z" shows all versions after X.Y.Z. Agents can use this to discover when a feature was introduced.
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

> `/sprint:release-notes --since 1.3.0`
