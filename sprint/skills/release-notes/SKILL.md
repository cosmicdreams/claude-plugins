---
name: release-notes
description: Display sprint plugin release notes from CHANGELOG.md. Use when asked "what's new in sprint", "sprint release notes", "what changed in sprint", or "sprint changelog". Default (no args): outputs the full CHANGELOG exactly as written. Optional args: "--latest" shows only the most recent version; "--since X.Y.Z" shows all versions after X.Y.Z. Agents can use this to discover when a feature was introduced.
allowed-tools: Read, Bash
---

# sprint Release Notes

Read and output the sprint plugin CHANGELOG.

## Default behavior (no arguments)

Read the CHANGELOG and output it in full — exactly as written, no summarizing, no reformatting.
Prepend one line of context:

```
sprint <installed-version> — release notes

<full CHANGELOG content>
```

## Finding the CHANGELOG

```bash
PLUGIN_ROOT=$(ls -d /Users/Chris.Weber/.claude/plugins/cache/local/sprint/*/ 2>/dev/null | sort -V | tail -1)
CHANGELOG="$PLUGIN_ROOT/CHANGELOG.md"
INSTALLED=$(python3 -c "import json; print(json.load(open('$PLUGIN_ROOT/.claude-plugin/plugin.json'))['version'])" 2>/dev/null)
```

If the cache path is empty, fall back:
```bash
CHANGELOG="$(git rev-parse --show-toplevel 2>/dev/null)/sprint/CHANGELOG.md"
```

## Optional filtering (when $ARGUMENTS is provided)

| Argument | Behavior |
|----------|----------|
| `--latest` | Show only the most recent `## X.Y.Z` section |
| `--since X.Y.Z` | Show all sections with version > X.Y.Z (exclusive) |
| `X.Y.Z` | Show only that specific version's section |

When filtering, still prepend the context line and note what filter is active.

## Usage by agents

Agents querying this skill should use `--since <their-known-version>` to find
what changed since they last encountered the plugin. Example:

> `/sprint:release-notes --since 1.3.0`
