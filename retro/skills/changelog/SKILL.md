---
name: changelog
description: Display retro plugin changelog from CHANGELOG.md. Use when the user mentions "retro" and wants to know what changed — e.g. "retro changelog", "what's new in retro", "what changed in retro", "retro release notes". Default (no args): full CHANGELOG. Optional args: "--latest" shows only the most recent version; "--since X.Y.Z" shows all versions after X.Y.Z.
allowed-tools: Bash
---

# retro Release Notes

Read and output the retro CHANGELOG.

## Procedure

```bash
bash "${CLAUDE_SKILL_DIR}/read-changelog.sh" "retro" "${CLAUDE_PLUGIN_ROOT}" "${ARGUMENTS:-}"
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

> `/retro:changelog --since 1.0.0`
