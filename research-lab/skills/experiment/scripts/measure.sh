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
FAILED=0

for PAGE in "${PAGES[@]}"; do
  FULL_URL="${URL%/}${PAGE}"

  # Measure Time to First Byte (TTFB) in seconds.
  #   --fail          : a 4xx/5xx is an error — never average an error page's TTFB
  #   --connect-timeout/--max-time : one slow or hung page can't block the whole run
  # Any failed page invalidates the sample, not just that page's contribution.
  # Accept only curl's nonnegative decimal format before passing data to bc.
  if TTFB=$(curl -fsS -o /dev/null --connect-timeout 5 --max-time 30 \
              -w '%{time_starttransfer}' "$FULL_URL" 2>/dev/null) &&
      [[ "$TTFB" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    >&2 echo "  $PAGE: ${TTFB}s"
    TOTAL=$(echo "$TOTAL + $TTFB" | bc)
    COUNT=$((COUNT + 1))
  else
    >&2 printf '  %q: request failed or invalid timing\n' "$PAGE"
    FAILED=$((FAILED + 1))
  fi
done

# Never emit a comparable metric for an incomplete sample.
if [ "$FAILED" -gt 0 ]; then
  >&2 echo "Error: invalid sample: $FAILED of ${#PAGES[@]} pages failed"
  exit 1
fi

# This is one complete page-sample mean, not an across-run median/noise check.
# bc can wrap oversized results; only one nonnegative decimal is a metric.
if AVG=$(echo "scale=3; $TOTAL / $COUNT" | bc) &&
    [[ "$AVG" =~ ^([0-9]+([.][0-9]+)?|[.][0-9]+)$ ]]; then
  echo "$AVG"
else
  >&2 echo "Error: invalid sample: average calculation failed or invalid result"
  exit 1
fi
