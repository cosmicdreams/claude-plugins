#!/usr/bin/env bash
# drover/scripts/suspect-commit.sh
# Given a raw Drupal error location, find the Git commit responsible for that line.
#
# Usage: suspect-commit.sh <location> <approot>
#   location — raw location from Drupal error (e.g. /var/www/html/modules/custom/foo/Bar.php:123)
#   approot  — absolute path to project root on the host filesystem
#
# Output (stdout): JSON {"commit":"...","author":"...","date":"...","subject":"...","file":"...","line":N}
# Errors (stderr): JSON {"error":"description"}  — exits 1

set -euo pipefail

RAW_LOCATION="${1:-}"
APPROOT="${2:-}"

json_error() {
  local msg="$1"
  python3 - <<PY
import json, sys
print(json.dumps({"error": "$msg"}), file=sys.stderr)
PY
  exit 1
}

json_success() {
  local commit="$1" author="$2" date="$3" subject="$4" file="$5" line="$6"
  python3 - <<PY
import json
print(json.dumps({
  "commit": "$commit",
  "author": "$author",
  "date": "$date",
  "subject": "$subject",
  "file": "$file",
  "line": int("$line"),
}))
PY
}

[[ -z "${APPROOT}" ]] && json_error "approot empty"
[[ -z "${RAW_LOCATION}" ]] && json_error "location empty"

# Require a line number suffix
if [[ ! "${RAW_LOCATION}" =~ :([0-9]+)$ ]]; then
  json_error "no line number in location"
fi

LINE="${BASH_REMATCH[1]}"
PATH_PART="${RAW_LOCATION%:*}"

REL_PATH=""

# 1) Find first (modules/|core/|themes/|profiles/) segment — works for DDEV container paths
STEP1=$(printf '%s' "$PATH_PART" | sed -n 's#.*\(/\(modules\|core\|themes\|profiles\)/.*\)#\1#p' | sed 's#^/##')
if [[ -n "$STEP1" ]] && [[ -e "$APPROOT/$STEP1" ]]; then
  REL_PATH="$STEP1"
fi

# 2) Strip /var/www/html/ or */docroot/ or */web/ prefix
if [[ -z "$REL_PATH" ]]; then
  STEP2="$PATH_PART"
  STEP2="${STEP2#/var/www/html/}"
  STEP2="$(printf '%s' "$STEP2" | sed 's#^.*\/docroot/##; s#^.*\/web/##')"
  if [[ "$STEP2" != "$PATH_PART" ]] && [[ -e "$APPROOT/$STEP2" ]]; then
    REL_PATH="$STEP2"
  fi
fi

# 3) Fallback: treat as already relative to approot
if [[ -z "$REL_PATH" ]]; then
  STEP3="${PATH_PART#/}"
  [[ -e "$APPROOT/$STEP3" ]] && REL_PATH="$STEP3"
fi

[[ -z "$REL_PATH" ]] && json_error "could not resolve path"

# Pre-blame check: file must be tracked in git index
if ! git -C "$APPROOT" ls-files --error-unmatch "$REL_PATH" >/dev/null 2>&1; then
  json_error "file not tracked"
fi

# Uncommitted-changes guard
if [[ -n "$(git -C "$APPROOT" status --porcelain -- "$REL_PATH")" ]]; then
  json_error "uncommitted file"
fi

# Blame the specific line
BLAME_OUT="$(git -C "$APPROOT" blame -L "${LINE},${LINE}" --porcelain -- "$REL_PATH" 2>/dev/null || true)"
[[ -z "$BLAME_OUT" ]] && json_error "blame failed"

COMMIT_HASH="$(printf '%s\n' "$BLAME_OUT" | head -n 1 | awk '{print $1}')"
[[ -z "$COMMIT_HASH" ]] && json_error "blame parse failed"

# All-zeros hash means the line is uncommitted
[[ "$COMMIT_HASH" == "0000000000000000000000000000000000000000" ]] && json_error "uncommitted file"

LOG_LINE="$(git -C "$APPROOT" log -1 --format="%H|%an|%ad|%s" --date=short "$COMMIT_HASH" 2>/dev/null || true)"
[[ -z "$LOG_LINE" ]] && json_error "log lookup failed"

IFS='|' read -r COMMIT AUTHOR DATE SUBJECT <<<"$LOG_LINE"

json_success "$COMMIT" "$AUTHOR" "$DATE" "$SUBJECT" "$REL_PATH" "$LINE"
