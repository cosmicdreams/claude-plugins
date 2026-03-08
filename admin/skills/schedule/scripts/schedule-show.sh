#!/usr/bin/env bash
# Show detail for a single com.chrisweber.* task

set -euo pipefail

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
    echo "Usage: schedule-show.sh <name>"
    echo "  <name> is the short label suffix, e.g. 'email-monitor'"
    exit 1
fi

NAMESPACE="com.chrisweber"
LABEL="$NAMESPACE.$NAME"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/.claude/logs/schedule/$NAME.log"
ERR="$HOME/.claude/logs/schedule/$NAME.err"

if [[ ! -f "$PLIST" ]]; then
    echo "Error: No task found with label '$LABEL'"
    echo "Run '/admin:schedule list' to see available tasks."
    exit 1
fi

echo "=== $LABEL ==="
echo ""
echo "Plist:    $PLIST"
echo "Log:      $LOG"
echo "Err:      $ERR"
echo ""

# launchctl detail
info=$(launchctl list "$LABEL" 2>/dev/null || true)
if [[ -n "$info" ]]; then
    pid=$(echo "$info" | awk '/"PID"/ {gsub(/[^0-9]/, "", $NF); print $NF}')
    last_exit=$(echo "$info" | awk '/"LastExitStatus"/ {gsub(/[^0-9-]/, "", $NF); print $NF}')
    echo "PID:      ${pid:--}"
    echo "Status:   ${last_exit:--}"
else
    echo "Status:   unloaded (not registered with launchd)"
fi

echo ""
echo "--- Plist contents ---"
cat "$PLIST"

echo ""
echo "--- Last 10 log lines ---"
if [[ -f "$LOG" ]]; then
    tail -10 "$LOG"
else
    echo "(no log yet)"
fi

if [[ -f "$ERR" ]] && [[ -s "$ERR" ]]; then
    echo ""
    echo "--- Last 5 error lines ---"
    tail -5 "$ERR"
fi
