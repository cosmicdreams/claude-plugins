---
name: browse-drupal-issues
description: >
  Browse or list issues for any Drupal.org project (core or contrib) via RSS. Not for deep
  analysis of a single issue — use drupal-lab:analyze-issue.
---

# browse-drupal-issues

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Browse and list Drupal.org project issues via RSS feeds. Use when the user wants to explore, list, or discover issues for a Drupal project -- e.g. "show me open Drupal core issues", "what issues exist for settings_tray", "browse drupal.org issues", "find critical Drupal bugs". Works with any project (core or contrib). Do NOT use for deep analysis of a single issue -- use drupal-lab:analyze-issue instead.

Browse Drupal.org project issue queues using RSS feeds for quick discovery and filtering.

## Usage

```bash
browse-drupal-issues [project-name] [options]
```

`project-name` is optional — when omitted, the project is auto-detected from the current working directory and the status defaults to `Open`.

**Options:**
- `--status=<status>` - Filter by issue status (e.g., Open, Fixed, Closed, Active)
- `--priority=<priority>` - Filter by priority (e.g., Critical, Major, Normal, Minor)
- `--component=<component>` - Filter by component (e.g., settings_tray.module or just settings_tray)
- `--limit=<number>` - Limit number of results to display
- `--output=json` - Output as JSON instead of human-readable text

## Examples

```bash
# No arguments — auto-detect project from CWD, show open issues
browse-drupal-issues

# Browse all open Drupal core issues
browse-drupal-issues drupal --status=Open

# Filter by specific component (settings_tray)
browse-drupal-issues drupal --component=settings_tray.module --status=Open
browse-drupal-issues drupal --component=settings_tray --status=Open  # .module extension optional

# Find critical priority issues
browse-drupal-issues drupal --priority=Critical --limit=5

# Combine filters for precise results
browse-drupal-issues drupal --component=block.module --status=Open --priority=Major

# Browse issues for a contrib module
browse-drupal-issues views --status=Active

# Get JSON output for processing
browse-drupal-issues cloudflare --output=json
```

## Auto-Detection

When `project-name` is omitted, the script resolves it in this order:

1. `DRUPAL_MODULE_MACHINE_NAME` env var (set automatically in DDEV contrib projects)
2. `*.info.yml` file with `type: module` or `type: theme` in CWD or parent directory
3. `composer.json` with a `drupal/*` package name
4. `CLAUDE.md` containing a `**Module**: <name>` line

The detected name is printed to stderr so you can confirm it.

## How It Works

Execute the bundled Python script that:
1. Resolves the project name (from args or auto-detection)
2. Fetches RSS feed from `https://www.drupal.org/project/issues/rss/{project}`
3. Applies filters via URL parameters
4. Parses XML and extracts issue metadata
5. Displays formatted results

```bash
python3 scripts/fetch_drupal_rss.py [project] [options]
```

## Integration with analyze-issue

This skill pairs with the `/analyze-issue` skill:

1. **browse-drupal-issues** - Discover and filter issues across a project
2. **analyze-issue** - Deep-dive into a specific issue with full context

**Workflow:** Browse to find issues, then analyze specific ones for implementation.

## Notes

- **Component filtering works!** Use full module names (e.g., `settings_tray.module`) or short names (extension added automatically)
- Component filtering requires `categories=1` parameter (automatically added by the script)
- RSS feeds show issues in reverse chronological order (most recently updated first)
- Available for all public Drupal.org projects (core and contrib)
- Respect Drupal.org's rate limits when making multiple requests

## RSS URL Format

The script constructs URLs like:
```
https://www.drupal.org/project/issues/rss/drupal?status=Open&categories=1&component=settings_tray.module
```

Key parameters:
- `status` - Issue status filter
- `categories=1` - Required for component filtering
- `component` - Full module name (e.g., `settings_tray.module`)
