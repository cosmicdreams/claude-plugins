#!/usr/bin/env bash
# Ask a NotebookLM notebook a question.
#
# Usage: notebook-ask.sh <notebook-id> <question> [--save-as-note --note-title <title>] [--json] [-s SOURCE_ID]
#
# Note: --save-as-note is a bare boolean; the title rides on a separate
# --note-title <title> flag (NOT `--save-as-note <title>`).
#
# Wraps notebooklm ask with correct CLI syntax.
# All notebooklm interactions should go through scripts in this directory
# to prevent syntax errors (key=value vs --key value).

set -euo pipefail

NOTEBOOK_ID="${1:?Usage: notebook-ask.sh <notebook-id> <question> [--save-as-note <title>] [--json]}"
QUESTION="${2:?Usage: notebook-ask.sh <notebook-id> <question> [--save-as-note <title>] [--json]}"
shift 2

# Remaining args fall into two groups: the note-saving flags
# (--save-as-note / --note-title <title>) and everything else (--json, -s SOURCE_ID).
# The retry below must drop the saving flags: a degraded first answer would already
# have attempted its save, and re-passing them on the retry would persist a SECOND
# (junk) note. So the first attempt may save; the retry only fetches a usable answer.
ALL_ARGS=("$@")
QUERY_ARGS=()
skip=0
for a in "$@"; do
  if [ "$skip" = 1 ]; then skip=0; continue; fi
  case "$a" in
    --save-as-note) ;;        # bare boolean — drop on retry
    --note-title)   skip=1 ;; # drop the flag and its following value
    *)              QUERY_ARGS+=("$a") ;;
  esac
done

# The ${arr[@]+"${arr[@]}"} form expands to nothing when the array is empty,
# instead of tripping `set -u` on bash 3.2 (macOS /bin/bash).
err=$(mktemp)
out=$(notebooklm ask "$QUESTION" -n "$NOTEBOOK_ID" ${ALL_ARGS[@]+"${ALL_ARGS[@]}"} 2>"$err") || true

if grep -q "No marked answer found" "$err"; then
  >&2 echo "[notebook-ask] degraded answer (No marked answer found); retrying once without re-saving…"
  out=$(notebooklm ask "$QUESTION" -n "$NOTEBOOK_ID" ${QUERY_ARGS[@]+"${QUERY_ARGS[@]}"} 2>>"$err") || true
fi

cat "$err" >&2; rm -f "$err"
printf '%s\n' "$out"
