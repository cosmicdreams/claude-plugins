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

# Create notebook.
# NOTE: capture stdout ONLY — merging stderr (2>&1) corrupts the JSON when the
# CLI emits warnings. The 0.6.0 envelope is nested: {"notebook":{"id":...}};
# older builds returned a top-level {"id":...}. Handle both.
RESULT=$(notebooklm create "$TITLE" --json 2>/dev/null)
NOTEBOOK_ID=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or d.get('notebook',{}).get('id',''))" 2>/dev/null || echo "")

if [ -z "$NOTEBOOK_ID" ]; then
  >&2 echo "Failed to create notebook (could not parse an id). Raw output:"
  >&2 echo "$RESULT"
  exit 1
fi

>&2 echo "Created notebook: $NOTEBOOK_ID"

# Add seed URLs. Always pass an explicit, non-empty -n: an empty notebook id makes
# the CLI silently fall back to the "current context" notebook and pollute it.
# Guard the count: on bash 3.2 (macOS /bin/bash) expanding an empty array under
# `set -u` is an "unbound variable" error, which would abort the research-only path.
if [ "${#SEED_URLS[@]}" -gt 0 ]; then
  for url in "${SEED_URLS[@]}"; do
    >&2 echo "Adding seed: $url"
    notebooklm source add "$url" -n "$NOTEBOOK_ID" --type url --json >/dev/null 2>&1 \
      || >&2 echo "  Warning: failed to add $url (continuing)"
  done
fi

# Fire research if requested.
# 0.6.0 RULE: --import-all CANNOT combine with --no-wait. On the non-blocking path
# we fire without importing; the caller commits sources later via
# `notebooklm research wait --import-all -n <id>`. On the blocking path, import now.
# Research progress goes to stderr (>&2): stdout must carry ONLY the notebook id
# (line below) so callers can safely do `id=$(notebook-setup.sh ...)`.
if [ -n "$RESEARCH_QUERY" ]; then
  >&2 echo "Starting deep research: $RESEARCH_QUERY"
  if [ -n "$NO_WAIT" ]; then
    notebooklm source add-research "$RESEARCH_QUERY" -n "$NOTEBOOK_ID" --mode deep --no-wait >&2
  else
    notebooklm source add-research "$RESEARCH_QUERY" -n "$NOTEBOOK_ID" --mode deep --import-all >&2
  fi
fi

# Output the notebook ID
echo "$NOTEBOOK_ID"
