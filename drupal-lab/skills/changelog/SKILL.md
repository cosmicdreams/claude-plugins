---
name: changelog
description: Display drupal-lab plugin changelog from CHANGELOG.md. Use when the user mentions "drupal-lab" and wants to know what changed — e.g. "drupal-lab changelog", "what's new in drupal-lab", "what changed in drupal-lab", "drupal-lab release notes". Default (no args): full CHANGELOG. Optional args: "--latest" shows only the most recent version; "--since X.Y.Z" shows all versions after X.Y.Z.
allowed-tools: Bash
---

# drupal-lab Release Notes

Read and output the drupal-lab CHANGELOG.

## Procedure

```bash
bash "${CLAUDE_SKILL_DIR}/read-changelog.sh" "drupal-lab" "${CLAUDE_PLUGIN_ROOT}" "${ARGUMENTS:-}"
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

> `/drupal-lab:changelog --since 1.2.0`
