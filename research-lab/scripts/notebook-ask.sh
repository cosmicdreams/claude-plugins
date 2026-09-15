#!/usr/bin/env bash
# Ask a NotebookLM notebook a question.
#
# Usage: notebook-ask.sh <notebook-id> <question> [--save-as-note --note-title <title>] [--json] [-s SOURCE_ID]...
#
# Note: --save-as-note is a bare boolean; the title rides on a separate
# --note-title <title> flag (NOT `--save-as-note <title>`).
#
# Wraps `nlm notebook query` with correct CLI syntax. All NotebookLM
# interactions should go through scripts in this directory to prevent syntax
# errors (positional vs flag, comma-joined vs repeated).
#
# INTERFACE IS DELIBERATELY UNCHANGED from the retired `notebooklm` era so that
# callers (skills, agents, gather-facets.js) did not have to be rewritten. What
# changed underneath:
#   * `notebooklm ask "$Q" -n "$NB"`  ->  `nlm notebook query "$NB" "$Q"`
#   * `-s SID` (repeatable)           ->  `--source-ids sid1,sid2` (comma-joined)
#   * `--save-as-note` is GONE as a query flag. Saving is now a separate
#     `nlm note create` call, which this script makes on the caller's behalf.

set -euo pipefail

NOTEBOOK_ID="${1:?Usage: notebook-ask.sh <notebook-id> <question> [--save-as-note --note-title <title>] [--json]}"
QUESTION="${2:?Usage: notebook-ask.sh <notebook-id> <question> [--save-as-note --note-title <title>] [--json]}"
shift 2

SAVE_NOTE=0
NOTE_TITLE=""
WANT_JSON=0
SOURCE_IDS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --save-as-note) SAVE_NOTE=1; shift ;;
    --note-title)   NOTE_TITLE="${2:-}"; shift 2 ;;
    --json|-j)      WANT_JSON=1; shift ;;
    -s|--source-ids)
      if [ -n "$SOURCE_IDS" ]; then SOURCE_IDS="$SOURCE_IDS,${2:-}"; else SOURCE_IDS="${2:-}"; fi
      shift 2 ;;
    *) >&2 echo "[notebook-ask] ignoring unknown arg: $1"; shift ;;
  esac
done

QUERY_ARGS=()
[ "$WANT_JSON" = 1 ] && QUERY_ARGS+=(--json)
[ -n "$SOURCE_IDS" ] && QUERY_ARGS+=(--source-ids "$SOURCE_IDS")

# The ${arr[@]+"${arr[@]}"} form expands to nothing when the array is empty,
# instead of tripping `set -u` on bash 3.2 (macOS /bin/bash).
err=$(mktemp)
trap 'rm -f "$err"' EXIT
for attempt in 1 2; do
  # Failed calls (including auth/quota failures) are never retry candidates.
  if out=$(nlm notebook query "$NOTEBOOK_ID" "$QUESTION" ${QUERY_ARGS[@]+"${QUERY_ARGS[@]}"} 2>"$err"); then
    cat "$err" >&2
  else
    status=$?
    cat "$err" >&2
    # nlm writes some auth/JSON errors to stdout; keep them as diagnostics, not answers.
    [ -z "$out" ] || printf '%s\n' "$out" >&2
    exit "$status"
  fi
  if [ -n "${out//[[:space:]]/}" ] && ! grep -qiE "no marked answer|no answer found" "$err"; then
    break
  fi
  if [ "$attempt" = 2 ]; then
    >&2 echo "[notebook-ask] empty or degraded answer after retry; no answer returned."
    exit 1
  fi
  >&2 echo "[notebook-ask] degraded answer; retrying once…"
done

# Save the answer as a note when asked. Done AFTER the retry so the note always
# holds the answer the caller actually received.
if [ "$SAVE_NOTE" = 1 ] && [ -n "${out//[[:space:]]/}" ]; then
  note_body="$out"
  if [ "$WANT_JSON" = 1 ]; then
    # Pull the prose out of the JSON envelope so the saved note is readable.
    note_body=$(printf '%s' "$out" | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception:
    print(raw); sys.exit(0)
for k in ("answer", "text", "response", "content", "message"):
    v = d.get(k) if isinstance(d, dict) else None
    if isinstance(v, str) and v.strip():
        print(v); sys.exit(0)
print(raw)
' 2>/dev/null) || note_body="$out"
  fi
  if nlm note create "$NOTEBOOK_ID" --content "$note_body" --title "${NOTE_TITLE:-Research Note}" >/dev/null 2>&1; then
    >&2 echo "[notebook-ask] saved note: ${NOTE_TITLE:-Research Note}"
  else
    >&2 echo "[notebook-ask] WARNING: could not save note '${NOTE_TITLE:-Research Note}' (answer still returned)"
  fi
fi

printf '%s\n' "$out"
