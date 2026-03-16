#!/usr/bin/env bash
# Preflight audit script for Drupal cache optimization engagements
# Checks for common cache misconfigurations and missing modules.
#
# Usage: preflight.sh <site-url> [pages...]
#
# If no pages given AND drush is available, auto-discovers content types
# and samples one published page per type.
#
# Output: structured markdown to stdout (redirect to 01-preflight.md)
# Must be run from inside the DDEV project directory (so ddev drush works).

set -euo pipefail

URL="${1:?Usage: preflight.sh <site-url> [pages...]}"
shift

# --- Guard: don't run in worktrees/main/ ---
CWD=$(pwd)
if [[ "$CWD" == */worktrees/main || "$CWD" == */worktrees/main/* ]]; then
  echo "ERROR: Running in worktrees/main/ is not allowed. Use a dedicated worktree." >&2
  exit 1
fi

# --- Detect DDEV/drush ---
DRUSH_CMD=""
if command -v ddev &>/dev/null && ddev describe &>/dev/null 2>&1; then
  DRUSH_CMD="ddev drush"
elif command -v drush &>/dev/null; then
  DRUSH_CMD="drush"
fi

# --- Auto-discover pages if none provided ---
if [ $# -eq 0 ] && [ -n "$DRUSH_CMD" ]; then
  >&2 echo "No pages specified. Auto-discovering content types..."
  DISCOVERED=$($DRUSH_CMD sql:query "SELECT nfd.type, MIN(pa.alias) as alias FROM node_field_data nfd INNER JOIN path_alias pa ON CONCAT('/node/', nfd.nid) = pa.path WHERE nfd.status = 1 GROUP BY nfd.type ORDER BY nfd.type" 2>/dev/null || true)
  PAGES=(/)
  while IFS=$'\t' read -r type alias; do
    [ -n "$alias" ] && PAGES+=("$alias")
  done <<< "$DISCOVERED"
  >&2 echo "  Discovered ${#PAGES[@]} pages (1 per content type + homepage)"
else
  PAGES=("${@:-/}")
fi

echo "# Preflight Audit: $URL"
echo ""
echo "Date: $(date +%Y-%m-%d)"
echo ""

# --- Section 1: HTTP Cache Headers + Status ---
echo "## HTTP Cache Headers"
echo ""
echo "| Page | Status | Dynamic Cache | Max-Age | Session Cookie |"
echo "|------|--------|--------------|---------|----------------|"

for PAGE in "${PAGES[@]}"; do
  FULL_URL="${URL%/}${PAGE}"

  # Follow redirects, capture final response
  HEADERS=$(curl -sI -L "$FULL_URL" 2>/dev/null || echo "FAILED")
  STATUS=$(echo "$HEADERS" | grep '^HTTP/' | tail -1 | awk '{print $2}')
  DYN_CACHE=$(echo "$HEADERS" | grep -i 'x-drupal-dynamic-cache' | tail -1 | awk '{print $2}' | tr -d '\r')
  MAX_AGE=$(echo "$HEADERS" | grep -i 'x-drupal-cache-max-age' | tail -1 | awk '{print $2}' | tr -d '\r')
  COOKIE=$(echo "$HEADERS" | grep -ci 'Set-Cookie:.*SESS' || true)

  # Flag issues
  STATUS_FLAG=""
  [ "$STATUS" = "404" ] && STATUS_FLAG=" (NOT FOUND)"
  [ "$STATUS" = "500" ] && STATUS_FLAG=" (ERROR)"

  echo "| $PAGE | ${STATUS}${STATUS_FLAG} | ${DYN_CACHE:-n/a} | ${MAX_AGE:-n/a} | ${COOKIE} |"
done

echo ""

# --- Section 2: Drupal Module Status ---
echo "## Drupal Module Status"
echo ""

if [ -n "$DRUSH_CMD" ]; then
  echo "### Cache-Related Modules"
  echo ""
  echo '```'
  $DRUSH_CMD pm:list --status=enabled --filter=cache 2>/dev/null || echo "Could not list modules"
  echo '```'
  echo ""

  echo "### BigPipe Status"
  echo ""
  echo '```'
  $DRUSH_CMD pm:list --filter=big_pipe 2>/dev/null || echo "Could not check BigPipe"
  echo '```'
  echo ""

  echo "### Performance Configuration"
  echo ""
  echo '```'
  $DRUSH_CMD config:get system.performance 2>/dev/null || echo "Could not read performance config"
  echo '```'
  echo ""
else
  echo "*Drush not available — run this script from inside the DDEV project directory.*"
  echo ""
fi

# --- Section 3: Page Load Baseline ---
echo "## Baseline Measurements"
echo ""
echo "| Page | Status | TTFB (s) | Total (s) | Size (bytes) |"
echo "|------|--------|----------|-----------|--------------|"

for PAGE in "${PAGES[@]}"; do
  FULL_URL="${URL%/}${PAGE}"
  STATUS=$(curl -sI -L "$FULL_URL" -o /dev/null -w '%{http_code}' 2>/dev/null)
  METRICS=$(curl -L -o /dev/null -s -w '%{time_starttransfer}\t%{time_total}\t%{size_download}' "$FULL_URL" 2>/dev/null)
  TTFB=$(echo "$METRICS" | cut -f1)
  TOTAL_TIME=$(echo "$METRICS" | cut -f2)
  SIZE=$(echo "$METRICS" | cut -f3)
  echo "| $PAGE | $STATUS | $TTFB | $TOTAL_TIME | $SIZE |"
done

echo ""

# --- Section 4: Summary ---
echo "## Summary"
echo ""
echo "- **Pages audited:** ${#PAGES[@]}"
echo "- **Auto-discovered:** $([ $# -eq 0 ] && echo "yes (one per content type)" || echo "no (manually specified)")"
echo "- **Drush available:** $([ -n "$DRUSH_CMD" ] && echo "yes ($DRUSH_CMD)" || echo "no")"
echo "- **Findings:** Review cache headers table for max-age=0, session cookies, and non-200 status codes."
