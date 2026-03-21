---
id: lint-006
name: stale-plugin-list
tier: warn
applies-to: skill
pattern: Hardcoded list of plugin names that doesn't include all installed plugins
created: 2026-03-20
source: Process-engineer skill sweep found 4 files with plugin lists missing lib, workflow, drover, research-lab, and improve. New plugins get added to the marketplace but hardcoded lists in skills and scripts don't update automatically.
---

## Problem

Skills and scripts that enumerate plugin names use hardcoded arrays or inline lists. When a new plugin is added, these lists become stale — the new plugin is silently excluded from version bumps, changelog queries, reinstalls, etc.

## Detection

Search for hardcoded plugin name patterns in skills and scripts:

```bash
# Find hardcoded PLUGINS arrays in scripts
grep -rn 'PLUGINS=(' */skills/*/scripts/ */skills/*/SKILL.md

# Find inline plugin lists in SKILL.md files
grep -rn 'sprint.*retro.*ideate' */skills/*/SKILL.md
```

Compare found lists against the canonical source: `.claude-plugin/marketplace.json` plugins array.

## Fix

Update the hardcoded list to include all plugins from `marketplace.json`. When possible, prefer dynamic discovery over hardcoded lists:

```bash
# Dynamic discovery from marketplace
python3 -c "import json; [print(p['name']) for p in json.load(open('.claude-plugin/marketplace.json'))['plugins']]"
```

If dynamic discovery isn't practical (e.g. in a SKILL.md description), update the list and note that it must be maintained when plugins are added.
