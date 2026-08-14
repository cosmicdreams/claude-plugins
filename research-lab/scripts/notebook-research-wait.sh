#!/usr/bin/env bash
# Wait for a deep-research task to finish, then import its sources.
#
# Usage: notebook-research-wait.sh NOTEBOOK_ID [--max-wait SECONDS] [--cited-only]
#
# Replaces the retired `notebooklm research wait --import-all -n <id>`, which
# was a single blocking call. `nlm` splits that into two steps:
#   1. `nlm research status <id> --max-wait N`  — polls until the task completes
#   2. `nlm research import <id>`               — commits the discovered sources
# The task id is optional on import (auto-detected), so callers never handle it.
#
# Deep research runs ~5 minutes for the deep mode but can stretch well past that
# on a large query, so the default wait is 15 minutes rather than the CLI's own
# 5-minute default. Run this as a BACKGROUND task from a skill.

set -uo pipefail

NB="${1:?Usage: notebook-research-wait.sh NOTEBOOK_ID [--max-wait SECONDS] [--cited-only]}"
shift

MAX_WAIT=900
CITED_ONLY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --max-wait)   MAX_WAIT="$2"; shift 2 ;;
    --cited-only) CITED_ONLY="--cited-only"; shift ;;
    *) >&2 echo "Unknown arg: $1"; exit 1 ;;
  esac
done

>&2 echo "[research-wait] polling notebook $NB (max ${MAX_WAIT}s)…"
if ! nlm research status "$NB" --max-wait "$MAX_WAIT" >&2; then
  >&2 echo "[research-wait] status check did not report completion within ${MAX_WAIT}s."
  >&2 echo "[research-wait] research may still be running — re-run this script, or import manually with: nlm research import $NB"
  exit 1
fi

>&2 echo "[research-wait] importing discovered sources…"
if nlm research import "$NB" ${CITED_ONLY:+$CITED_ONLY} >&2; then
  >&2 echo "[research-wait] import complete. Next: notebook-dedup.sh $NB --apply"
else
  >&2 echo "[research-wait] import FAILED — retry with: nlm research import $NB"
  exit 1
fi
