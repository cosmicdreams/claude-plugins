---
name: release-notes
description: Display drupal-lab release notes from CHANGELOG.md. Use when asked "what's new in drupal-lab", "drupal-lab release notes", "what changed in drupal-lab", or "drupal-lab changelog". Default (no args): outputs the full CHANGELOG exactly as written. Optional args: "--latest" shows only the most recent version; "--since X.Y.Z" shows all versions after X.Y.Z. Agents can use this to discover when a feature was introduced and whether their installed version includes it.
allowed-tools: Bash
---

# drupal-lab Release Notes

Read and output the drupal-lab CHANGELOG.

## Procedure

```bash
SKILL_DIR="${CLAUDE_PLUGIN_ROOT}/skills/release-notes"
bash "$SKILL_DIR/read-changelog.sh" "drupal-lab" "${CLAUDE_PLUGIN_ROOT}" "${ARGUMENTS:-}"
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

> `/drupal-lab:release-notes --since 1.2.0`
