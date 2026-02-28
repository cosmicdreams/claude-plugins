---
name: browse-drupal-issues
description: Browse and list Drupal.org project issues via RSS feeds. Use when the user wants to explore issues for a Drupal project (core or contrib), see what issues are available, filter by status or priority, or discover issues before deep-diving into specific ones. Works with any Drupal project name (e.g., drupal, views, token, cloudflare). Complements the analyze-issue skill which provides deep analysis of individual issues.
---

# browse-drupal-issues

Browse Drupal.org project issue queues using RSS feeds for quick discovery and filtering.

## Usage

```bash
browse-drupal-issues <project-name> [options]
```

**Options:**
- `--status=<status>` - Filter by issue status (e.g., Open, Fixed, Closed, Active)
- `--priority=<priority>` - Filter by priority (e.g., Critical, Major, Normal, Minor)
- `--component=<component>` - Filter by component (e.g., settings_tray.module or just settings_tray)
- `--limit=<number>` - Limit number of results to display
- `--output=json` - Output as JSON instead of human-readable text

## Examples

```bash
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

## How It Works

Execute the bundled Python script that:
1. Fetches RSS feed from `https://www.drupal.org/project/issues/rss/{project}`
2. Applies filters via URL parameters
3. Parses XML and extracts issue metadata
4. Displays formatted results

```bash
python3 scripts/fetch_drupal_rss.py <project> [options]
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
