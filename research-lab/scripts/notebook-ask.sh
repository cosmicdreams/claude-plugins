#!/usr/bin/env bash
# Ask a NotebookLM notebook a question.
#
# Usage: notebook-ask.sh <notebook-id> <question> [--save-as-note <title>] [--json]
#
# Wraps notebooklm ask with correct CLI syntax.
# All notebooklm interactions should go through scripts in this directory
# to prevent syntax errors (key=value vs --key value).

set -euo pipefail

NOTEBOOK_ID="${1:?Usage: notebook-ask.sh <notebook-id> <question> [--save-as-note <title>] [--json]}"
QUESTION="${2:?Usage: notebook-ask.sh <notebook-id> <question> [--save-as-note <title>] [--json]}"
shift 2

# Pass remaining args through (--save-as-note, --note-title, --json, -s SOURCE_ID).
# Retry once on the known 0.6.0 degraded-answer failure, where the CLI warns
# "No marked answer found" and falls back to a short reasoning fragment instead of
# the real synthesis. Retry without --save-as-note/--note-title so a transient
# failure doesn't save a junk note (the second, good call saves it).
err=$(mktemp)
out=$(notebooklm ask "$QUESTION" -n "$NOTEBOOK_ID" "$@" 2>"$err") || true

if grep -q "No marked answer found" "$err"; then
  >&2 echo "[notebook-ask] degraded answer (No marked answer found); retrying once…"
  out=$(notebooklm ask "$QUESTION" -n "$NOTEBOOK_ID" "$@" 2>>"$err") || true
fi

cat "$err" >&2; rm -f "$err"
printf '%s\n' "$out"
