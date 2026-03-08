#!/usr/bin/env bash
# Disable (bootout) a com.chrisweber.* launchd task

set -euo pipefail

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
    echo "Usage: schedule-disable.sh <name>"
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

# Check if already unloaded
if ! launchctl list "$LABEL" &>/dev/null; then
    echo "Task '$LABEL' is already disabled."
    exit 0
fi

launchctl bootout "gui/$(id -u)" "$PLIST"
echo "Disabled: $LABEL"
