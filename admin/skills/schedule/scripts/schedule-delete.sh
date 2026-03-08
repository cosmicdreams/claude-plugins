#!/usr/bin/env bash
# Delete a com.chrisweber.* launchd task (bootout + remove plist)

set -euo pipefail

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
    echo "Usage: schedule-delete.sh <name>"
    exit 1
fi

NAMESPACE="com.chrisweber"
LABEL="$NAMESPACE.$NAME"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ ! -f "$PLIST" ]]; then
    echo "Error: No plist found at $PLIST"
    echo "Run '/admin:schedule list' to see available tasks."
    exit 1
fi

# Bootout if loaded
if launchctl list "$LABEL" &>/dev/null; then
    launchctl bootout "gui/$(id -u)" "$PLIST"
    echo "Unloaded: $LABEL"
fi

rm "$PLIST"
echo "Deleted: $PLIST"

# Offer to remove logs
LOG="$HOME/.claude/logs/schedule/$NAME.log"
ERR="$HOME/.claude/logs/schedule/$NAME.err"
if [[ -f "$LOG" || -f "$ERR" ]]; then
    echo ""
    echo "Logs remain at:"
    [[ -f "$LOG" ]] && echo "  $LOG"
    [[ -f "$ERR" ]] && echo "  $ERR"
    echo "Remove manually if no longer needed."
fi
