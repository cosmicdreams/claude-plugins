---
id: lint-010
name: agent-name-prefix
tier: auto-fix
applies-to: agent
pattern: A plugin agent's frontmatter name already contains the plugin prefix or a colon
created: 2026-09-29
source: drover's report-writer was named drover:report-writer, registered as drover:drover:report-writer, and never matched its caller's dispatch of drover:report-writer.
---

## Problem

Claude Code prefixes plugin agents with the plugin name. A frontmatter `name` that already includes `<plugin>:` registers twice-prefixed, so every caller using the documented `<plugin>:<agent>` name silently fails to find it.

## Detection

```bash
grep -l '^name: .*:' */agents/*.md
```

## Fix

Set `name` to the bare agent name. Callers keep using `<plugin>:<agent>`; check that they do.
