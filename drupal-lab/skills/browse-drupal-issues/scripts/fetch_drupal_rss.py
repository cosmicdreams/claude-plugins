#!/usr/bin/env python3
"""Fetch and parse Drupal.org project issue RSS feeds."""
import sys
import os
import argparse
import xml.etree.ElementTree as ET
from urllib.request import urlopen
from urllib.error import URLError, HTTPError
import json
import glob
import re


def detect_project_name():
    """Auto-detect Drupal project name from the current working directory.

    Resolution order:
    1. DRUPAL_MODULE_MACHINE_NAME environment variable (DDEV contrib projects)
    2. *.info.yml file with type: module or type: theme in CWD or parent
    3. composer.json with a drupal/* package name
    4. CLAUDE.md mentioning a module machine name
    """
    cwd = os.getcwd()
    search_dirs = [cwd, os.path.dirname(cwd)]

    # 1. DDEV contrib env var
    env_name = os.environ.get('DRUPAL_MODULE_MACHINE_NAME')
    if env_name:
        return env_name

    # 2. *.info.yml in CWD or parent (worktree layouts place module root one level up)
    for search_dir in search_dirs:
        for info_file in glob.glob(os.path.join(search_dir, '*.info.yml')):
            try:
                with open(info_file) as f:
                    content = f.read()
                if re.search(r'^type:\s+(module|theme)', content, re.MULTILINE):
                    return os.path.basename(info_file).replace('.info.yml', '')
            except OSError:
                continue

    # 3. composer.json with drupal/* package name
    for search_dir in search_dirs:
        composer_path = os.path.join(search_dir, 'composer.json')
        if os.path.isfile(composer_path):
            try:
                with open(composer_path) as f:
                    data = json.load(f)
                pkg_name = data.get('name', '')
                if pkg_name.startswith('drupal/'):
                    return pkg_name.split('/', 1)[1]
            except (OSError, json.JSONDecodeError):
                pass

    # 4. CLAUDE.md mentioning module machine name
    for search_dir in search_dirs:
        claude_md = os.path.join(search_dir, 'CLAUDE.md')
        if os.path.isfile(claude_md):
            try:
                with open(claude_md) as f:
                    content = f.read()
                m = re.search(r'\*\*Module\*\*:\s*`?(\w+)`?', content)
                if m:
                    return m.group(1)
                m = re.search(r'Module machine name[:\s]+`?(\w+)`?', content, re.IGNORECASE)
                if m:
                    return m.group(1)
            except OSError:
                pass

    return None


def fetch_rss(project, component=None, status=None, priority=None):
    """Fetch RSS feed from drupal.org with optional filters."""
    # Build URL with filter parameters
    params = []

    # When filtering by component, add categories=1 for proper filtering
    if component:
        # Add .module extension if not present
        if not component.endswith('.module') and not '.' in component:
            component = f"{component}.module"
        params.append(f"component={component}")
        params.append("categories=1")  # Required for component filtering

    if status:
        params.append(f"status={status}")
    if priority:
        params.append(f"priorities={priority}")

    # Default to showing all if no specific filters
    if not params:
        params.append("categories=All")

    param_string = "&".join(params)
    url = f"https://www.drupal.org/project/issues/rss/{project}?{param_string}"

    try:
        with urlopen(url, timeout=30) as response:
            return response.read()
    except HTTPError as e:
        print(f"HTTP Error {e.code}: {e.reason}", file=sys.stderr)
        print(f"Project '{project}' may not exist", file=sys.stderr)
        sys.exit(1)
    except URLError as e:
        print(f"URL Error: {e.reason}", file=sys.stderr)
        sys.exit(1)


def parse_rss(xml_content):
    """Parse RSS XML and extract issue data."""
    root = ET.fromstring(xml_content)
    issues = []

    for item in root.findall('.//item'):
        issue = {
            'title': item.findtext('title', '').strip(),
            'link': item.findtext('link', '').strip(),
            'description': item.findtext('description', '').strip(),
            'pubDate': item.findtext('pubDate', '').strip(),
            'categories': {}
        }

        # Extract issue ID from link
        if issue['link']:
            parts = issue['link'].rstrip('/').split('/')
            if parts and parts[-1].isdigit():
                issue['id'] = parts[-1]

        # Parse categories
        for category in item.findall('category'):
            text = category.text
            if text and ': ' in text:
                key, value = text.split(': ', 1)
                issue['categories'][key.lower().strip()] = value.strip()

        issues.append(issue)

    return issues




def format_output(issues, limit=None, output_format='text'):
    """Format issues for output."""
    if limit:
        issues = issues[:limit]

    if output_format == 'json':
        print(json.dumps(issues, indent=2))
        return

    if not issues:
        print("No issues found matching criteria.")
        return

    print(f"\nFound {len(issues)} issue(s):\n")
    print("=" * 80)

    for i, issue in enumerate(issues, 1):
        print(f"\n{i}. {issue.get('title', 'No title')}")
        print(f"   ID: {issue.get('id', 'Unknown')}")
        print(f"   Link: {issue.get('link', '')}")

        cats = issue.get('categories', {})
        if cats:
            print("   Details:")
            for key, value in cats.items():
                if value:
                    print(f"     - {key.title()}: {value}")

        if issue.get('pubDate'):
            print(f"   Published: {issue['pubDate']}")

        print("-" * 80)


def main():
    parser = argparse.ArgumentParser(
        description='Browse Drupal.org project issues via RSS',
        epilog="""Examples:
  %(prog)s drupal
  %(prog)s drupal --component=settings_tray.module --status=Open --limit=10
  %(prog)s drupal --component=settings_tray --status=Open
  %(prog)s cloudflare --status=Active
        """
    )

    parser.add_argument('project', nargs='?', default=None,
                        help='Project name (e.g., drupal, views). '
                             'Auto-detected from CWD if omitted.')
    parser.add_argument('--component', help='Filter by component (e.g., settings_tray.module or just settings_tray)')
    parser.add_argument('--status', help='Filter by status (e.g., Open, Active, Fixed). '
                                         'Defaults to Open when no arguments are given.')
    parser.add_argument('--priority', help='Filter by priority (e.g., Critical, Major)')
    parser.add_argument('--limit', type=int, help='Max issues to display')
    parser.add_argument('--output', choices=['text', 'json'], default='text')

    args = parser.parse_args()

    # Resolve project — auto-detect when not provided
    project = args.project
    if not project:
        project = detect_project_name()
        if project:
            print(f"Auto-detected project: {project}", file=sys.stderr)
        else:
            print("Error: could not auto-detect project name. "
                  "Pass it explicitly: fetch_drupal_rss.py <project>", file=sys.stderr)
            sys.exit(1)

    # Default status to Open when running with no explicit filters
    status = args.status
    if not status and not args.component and not args.priority and not args.project:
        status = 'Open'

    xml_content = fetch_rss(project, args.component, status, args.priority)
    issues = parse_rss(xml_content)
    format_output(issues, args.limit, args.output)


if __name__ == '__main__':
    main()
