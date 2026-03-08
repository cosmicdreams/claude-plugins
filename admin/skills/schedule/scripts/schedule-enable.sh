#!/usr/bin/env bash
# Enable (bootstrap) a com.chrisweber.* launchd task

set -euo pipefail

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
    echo "Usage: schedule-enable.sh <name>"
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

# Check if already loaded
if launchctl list "$LABEL" &>/dev/null; then
    echo "Task '$LABEL' is already enabled."
    exit 0
fi

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Enabled: $LABEL"
