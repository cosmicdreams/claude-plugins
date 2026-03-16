#!/usr/bin/env bash
# Create a NotebookLM notebook, add seed URLs, and optionally fire deep research.
#
# Usage: notebook-setup.sh <title> [--seed-url <url>]... [--research <query>] [--no-wait]
#
# Output: notebook ID to stdout
#
# Examples:
#   notebook-setup.sh "Research: Drupal Caching"
#   notebook-setup.sh "Research: Drupal Caching" --seed-url https://example.com --research "Drupal cache optimization" --no-wait

set -euo pipefail

TITLE="${1:?Usage: notebook-setup.sh <title> [--seed-url <url>]... [--research <query>] [--no-wait]}"
shift

SEED_URLS=()
RESEARCH_QUERY=""
NO_WAIT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --seed-url) SEED_URLS+=("$2"); shift 2 ;;
    --research) RESEARCH_QUERY="$2"; shift 2 ;;
    --no-wait) NO_WAIT="--no-wait"; shift ;;
    *) >&2 echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Create notebook
RESULT=$(notebooklm create "$TITLE" --json 2>&1)
NOTEBOOK_ID=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")

if [ -z "$NOTEBOOK_ID" ]; then
  >&2 echo "Failed to create notebook: $RESULT"
  exit 1
fi

>&2 echo "Created notebook: $NOTEBOOK_ID"

# Add seed URLs
for url in "${SEED_URLS[@]}"; do
  >&2 echo "Adding seed: $url"
  notebooklm source add "$url" -n "$NOTEBOOK_ID" --json 2>&1 || >&2 echo "  Warning: failed to add $url (continuing)"
done

# Fire research if requested
if [ -n "$RESEARCH_QUERY" ]; then
  >&2 echo "Starting deep research: $RESEARCH_QUERY"
  notebooklm source add-research "$RESEARCH_QUERY" -n "$NOTEBOOK_ID" --mode deep --import-all $NO_WAIT 2>&1
fi

# Output the notebook ID
echo "$NOTEBOOK_ID"
