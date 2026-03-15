#!/usr/bin/env bash
# Generic measurement harness template
# Customize per engagement — the experimentalist or PI copies and adapts this.
#
# Usage: measure.sh <url> [pages...]
#
# Output: a single numeric value (the metric) to stdout
# All other output goes to stderr

set -euo pipefail

URL="${1:?Usage: measure.sh <url> [pages...]}"
shift
PAGES=("${@:-/}")

TOTAL=0
COUNT=0

for PAGE in "${PAGES[@]}"; do
  FULL_URL="${URL%/}${PAGE}"

  # Measure Time to First Byte (TTFB) in seconds
  TTFB=$(curl -o /dev/null -s -w '%{time_starttransfer}' "$FULL_URL" 2>/dev/null)

  >&2 echo "  $PAGE: ${TTFB}s"

  TOTAL=$(echo "$TOTAL + $TTFB" | bc)
  COUNT=$((COUNT + 1))
done

# Output average TTFB across all pages
if [ "$COUNT" -gt 0 ]; then
  AVG=$(echo "scale=3; $TOTAL / $COUNT" | bc)
  echo "$AVG"
else
  >&2 echo "Error: no pages measured"
  exit 1
fi
