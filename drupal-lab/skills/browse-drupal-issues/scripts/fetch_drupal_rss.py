#!/usr/bin/env python3
"""Fetch and parse Drupal.org project issue RSS feeds."""
import sys
import argparse
import xml.etree.ElementTree as ET
from urllib.request import urlopen
from urllib.error import URLError, HTTPError
import json


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

    parser.add_argument('project', help='Project name (e.g., drupal, views)')
    parser.add_argument('--component', help='Filter by component (e.g., settings_tray.module or just settings_tray)')
    parser.add_argument('--status', help='Filter by status (e.g., Open, Active, Fixed)')
    parser.add_argument('--priority', help='Filter by priority (e.g., Critical, Major)')
    parser.add_argument('--limit', type=int, help='Max issues to display')
    parser.add_argument('--output', choices=['text', 'json'], default='text')

    args = parser.parse_args()

    xml_content = fetch_rss(args.project, args.component, args.status, args.priority)
    issues = parse_rss(xml_content)
    format_output(issues, args.limit, args.output)


if __name__ == '__main__':
    main()
