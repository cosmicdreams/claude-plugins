#!/usr/bin/env bash
# Preflight audit script for Drupal cache optimization engagements
# Checks for common cache misconfigurations and missing modules.
#
# Usage: preflight.sh <site-url> [pages...]
#
# Output: structured markdown to stdout (redirect to 01-preflight.md)
# Designed to run on the host — uses curl and drush via DDEV if available.

set -euo pipefail

URL="${1:?Usage: preflight.sh <site-url> [pages...]}"
shift
PAGES=("${@:-/}")

echo "# Preflight Audit: $URL"
echo ""
echo "Date: $(date +%Y-%m-%d)"
echo ""

# --- Section 1: HTTP Cache Headers ---
echo "## HTTP Cache Headers"
echo ""

for PAGE in "${PAGES[@]}"; do
  FULL_URL="${URL%/}${PAGE}"
  echo "### $PAGE"
  echo ""
  echo '```'

  HEADERS=$(curl -sI "$FULL_URL" 2>/dev/null || echo "FAILED TO FETCH")

  # Extract cache-relevant headers
  echo "$HEADERS" | grep -iE '^(cache-control|x-drupal-cache|x-drupal-dynamic-cache|age|vary|surrogate-control|x-varnish|x-cache|etag|expires):' || echo "No cache headers found"

  echo '```'
  echo ""
done

# --- Section 2: Drupal Module Status (if drush available) ---
echo "## Drupal Module Status"
echo ""

DRUSH_CMD=""
if command -v ddev &>/dev/null && ddev describe &>/dev/null 2>&1; then
  DRUSH_CMD="ddev drush"
elif command -v drush &>/dev/null; then
  DRUSH_CMD="drush"
fi

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
  echo "*Drush not available — skipping module and configuration checks.*"
  echo ""
fi

# --- Section 3: Page Load Baseline ---
echo "## Baseline Measurements"
echo ""
echo "| Page | TTFB (s) | Total (s) | Size (bytes) |"
echo "|------|----------|-----------|--------------|"

for PAGE in "${PAGES[@]}"; do
  FULL_URL="${URL%/}${PAGE}"
  METRICS=$(curl -o /dev/null -s -w '%{time_starttransfer}\t%{time_total}\t%{size_download}' "$FULL_URL" 2>/dev/null)
  TTFB=$(echo "$METRICS" | cut -f1)
  TOTAL_TIME=$(echo "$METRICS" | cut -f2)
  SIZE=$(echo "$METRICS" | cut -f3)
  echo "| $PAGE | $TTFB | $TOTAL_TIME | $SIZE |"
done

echo ""

# --- Section 4: Summary ---
echo "## Summary"
echo ""
echo "- **Pages audited:** ${#PAGES[@]}"
echo "- **Drush available:** $([ -n "$DRUSH_CMD" ] && echo "yes ($DRUSH_CMD)" || echo "no")"
echo "- **Findings:** Review cache headers and module status above for issues."
