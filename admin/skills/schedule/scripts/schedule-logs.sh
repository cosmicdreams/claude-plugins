#!/usr/bin/env bash
# Tail logs for a com.chrisweber.* launchd task

set -euo pipefail

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
    echo "Usage: schedule-logs.sh <name>"
    exit 1
fi

LOG="$HOME/.claude/logs/schedule/$NAME.log"
ERR="$HOME/.claude/logs/schedule/$NAME.err"

if [[ ! -f "$LOG" && ! -f "$ERR" ]]; then
    echo "No logs found for '$NAME'."
    echo "Expected: $LOG"
    echo "The task may not have run yet."
    exit 0
fi

if [[ -f "$LOG" ]]; then
    echo "=== stdout: $LOG ==="
    tail -50 "$LOG"
fi

if [[ -f "$ERR" ]] && [[ -s "$ERR" ]]; then
    echo ""
    echo "=== stderr: $ERR ==="
    tail -20 "$ERR"
fi
