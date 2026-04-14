#!/usr/bin/env bash
# acquia-download.sh <alias> <log-type>
#
# Downloads one Acquia log type for one environment to stdout. Thin
# wrapper around `acli api:environments:log-download`.
#
# Arguments:
#   alias     drush/acli alias form, e.g. "pncb.prod"
#   log-type  one of: php-error, apache-error, apache-access, drupal-watchdog
#
# Environment:
#   DROVER_ACLI  override acli binary (tests)
#
# Exits 0 on success, 1 on auth or arg errors, 2 on download failure.

set -uo pipefail

ACLI="${DROVER_ACLI:-acli}"
ALIAS="${1:-}"
LOG_TYPE="${2:-}"

if [ -z "$ALIAS" ] || [ -z "$LOG_TYPE" ]; then
  echo "Usage: acquia-download.sh <alias> <log-type>" >&2
  exit 1
fi

if ! command -v "$ACLI" >/dev/null 2>&1; then
  echo "ERROR: acli not found (tried '$ACLI')" >&2
  exit 1
fi

"$ACLI" api:environments:log-download "$ALIAS" "$LOG_TYPE" 2>/dev/null || {
  echo "ERROR: failed to download $LOG_TYPE for $ALIAS" >&2
  exit 2
}
