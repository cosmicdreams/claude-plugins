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
#
# Backed by the `nlm` CLI (package notebooklm-mcp-cli). The retired `notebooklm`
# CLI was verb-first with a -n flag for the notebook; `nlm` is noun-first and
# takes the notebook id POSITIONALLY. The one exception is `research start`,
# which still uses -n/--notebook-id because its positional slot holds the query.

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
    --no-wait) NO_WAIT=1; shift ;;
    *) >&2 echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Create notebook.
# NOTE: capture stdout ONLY — merging stderr (2>&1) corrupts the JSON when the
# CLI emits warnings. The id key has moved between releases ({"id":...} vs
# {"notebook":{"id":...}}), so search recursively for the first plausible id
# rather than pinning one shape.
RESULT=$(nlm notebook create "$TITLE" --json 2>/dev/null)
NOTEBOOK_ID=$(printf '%s' "$RESULT" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

def find(node):
    if isinstance(node, dict):
        for k in ("id", "notebook_id", "notebookId"):
            v = node.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        for k in ("notebook", "data", "result"):
            if k in node:
                got = find(node[k])
                if got:
                    return got
        for v in node.values():
            got = find(v)
            if got:
                return got
    elif isinstance(node, list):
        for v in node:
            got = find(v)
            if got:
                return got
    return ""

print(find(d))
' 2>/dev/null || echo "")

if [ -z "$NOTEBOOK_ID" ]; then
  >&2 echo "Failed to create notebook (could not parse an id). Raw output:"
  >&2 echo "$RESULT"
  exit 1
fi

>&2 echo "Created notebook: $NOTEBOOK_ID"

# Add seed URLs. Guard the count: on bash 3.2 (macOS /bin/bash) expanding an
# empty array under `set -u` is an "unbound variable" error, which would abort
# the research-only path.
if [ "${#SEED_URLS[@]}" -gt 0 ]; then
  for url in "${SEED_URLS[@]}"; do
    >&2 echo "Adding seed: $url"
    nlm source add "$NOTEBOOK_ID" --url "$url" --json >/dev/null 2>&1 \
      || >&2 echo "  Warning: failed to add $url (continuing)"
  done
fi

# Fire research if requested.
# `nlm research start --auto-import` waits for completion and imports in one
# call, replacing the old two-step (--no-wait now, `research wait --import-all`
# later). On the non-blocking path we fire and return; the caller commits
# sources afterwards with notebook-research-wait.sh.
# Research progress goes to stderr (>&2): stdout must carry ONLY the notebook id
# (line below) so callers can safely do `id=$(notebook-setup.sh ...)`.
if [ -n "$RESEARCH_QUERY" ]; then
  >&2 echo "Starting deep research: $RESEARCH_QUERY"
  if [ -n "$NO_WAIT" ]; then
    nlm research start "$RESEARCH_QUERY" -n "$NOTEBOOK_ID" --mode deep >&2
  else
    nlm research start "$RESEARCH_QUERY" -n "$NOTEBOOK_ID" --mode deep --auto-import >&2
  fi
fi

# Output the notebook ID
echo "$NOTEBOOK_ID"
