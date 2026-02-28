---
name: release-notes
description: Display admin release notes from CHANGELOG.md. Use when asked "what's new in admin", "admin release notes", "what changed in admin", or "admin changelog". Default (no args): outputs the full CHANGELOG exactly as written. Optional args: "--latest" shows only the most recent version; "--since X.Y.Z" shows all versions after X.Y.Z. Agents can use this to discover when a feature was introduced and whether their installed version includes it.
allowed-tools: Read, Bash
---

# admin Release Notes

Read and output the admin CHANGELOG.

## Default behavior (no arguments)

Read the CHANGELOG and output it in full — exactly as written, no summarizing, no reformatting.
Prepend one line of context:

```
admin <installed-version> — release notes

<full CHANGELOG content>
```

This mirrors how `/release-notes` works in Claude Code: the content is shown as-is so
the reader (human or agent) can scan it directly.

## Finding the CHANGELOG

```bash
PLUGIN_ROOT=$(ls -d /Users/Chris.Weber/.claude/plugins/cache/local/admin/*/ 2>/dev/null | sort -V | tail -1)
CHANGELOG="$PLUGIN_ROOT/CHANGELOG.md"
INSTALLED=$(python3 -c "import json; print(json.load(open('$PLUGIN_ROOT/.claude-plugin/plugin.json'))['version'])" 2>/dev/null)
```

If the cache path is empty, fall back:
```bash
CHANGELOG="$(git rev-parse --show-toplevel 2>/dev/null)/admin/CHANGELOG.md"
```

## Optional filtering (when $ARGUMENTS is provided)

| Argument | Behavior |
|----------|----------|
| `--latest` | Show only the most recent `## X.Y.Z` section |
| `--since X.Y.Z` | Show all sections with version > X.Y.Z (exclusive) |
| `X.Y.Z` | Show only that specific version's section |

When filtering, still prepend the context line and note what filter is active:

```
admin <installed-version> — release notes (since X.Y.Z)

<filtered content>
```

## Usage by agents

Agents querying this skill should use `--since <their-known-version>` to find
what changed since they last encountered the plugin. Example:

> `/admin:release-notes --since 1.4.6`

Each version section maps features to the version that introduced them, so an agent
can reason: "Version 1.5.0 added hook-driven process-improvement — my installed
version is 1.6.3, so I have this feature."
