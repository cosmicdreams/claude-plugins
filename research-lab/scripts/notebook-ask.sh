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

# Pass remaining args through (--save-as-note, --note-title, --json, -s SOURCE_ID)
notebooklm ask "$QUESTION" -n "$NOTEBOOK_ID" "$@"
