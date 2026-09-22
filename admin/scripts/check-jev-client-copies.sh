#!/usr/bin/env zsh
# check-jev-client-copies.sh — fail when the per-plugin copies of jev_client.py diverge.
#
# Usage:
#   check-jev-client-copies.sh [repo-root]
#
# The Jev client is copied verbatim into each plugin that uses it because
# plugins install and cache separately. Edit one copy, copy it over the
# others, then run this. Exit 1 lists every copy whose hash differs from
# the first one found.

set -euo pipefail

REPO_ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"

COPIES=(
  "$REPO_ROOT/drover/scripts/jev_client.py"
  "$REPO_ROOT/ideas-funnel/scripts/jev_client.py"
  "$REPO_ROOT/test-lab/scripts/jev_client.py"
  "$REPO_ROOT/workshop/scripts/jev_client.py"
)

rc=0
reference=""
reference_hash=""
for copy in "${COPIES[@]}"; do
  if [[ ! -f "$copy" ]]; then
    echo "missing: ${copy#$REPO_ROOT/}"
    rc=1
    continue
  fi
  hash=$(shasum -a 256 "$copy" | cut -d' ' -f1)
  if [[ -z "$reference" ]]; then
    reference="$copy"
    reference_hash="$hash"
    continue
  fi
  if [[ "$hash" != "$reference_hash" ]]; then
    echo "diverged: ${copy#$REPO_ROOT/} != ${reference#$REPO_ROOT/}"
    rc=1
  fi
done

if [[ $rc -eq 0 ]]; then
  echo "jev_client.py: ${#COPIES[@]} copies identical (${reference_hash:0:12})"
fi
exit $rc
