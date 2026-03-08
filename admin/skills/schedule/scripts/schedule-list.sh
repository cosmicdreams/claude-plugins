#!/usr/bin/env bash
# List all com.chrisweber.* launchd tasks with status

set -euo pipefail

NAMESPACE="com.chrisweber"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"

printf "%-40s %-8s %-6s %s\n" "LABEL" "STATUS" "PID" "INTERVAL"
printf "%-40s %-8s %-6s %s\n" "-----" "------" "---" "--------"

found=0

for plist in "$LAUNCH_AGENTS"/$NAMESPACE.*.plist; do
    [[ -f "$plist" ]] || continue
    found=1

    label=$(basename "$plist" .plist)
    short="${label#$NAMESPACE.}"

    # Get PID and last exit status from launchctl
    pid="-"
    status="-"
    info=$(launchctl list "$label" 2>/dev/null || true)
    if [[ -n "$info" ]]; then
        pid=$(echo "$info" | awk '/"PID"/ {gsub(/[^0-9]/, "", $NF); print $NF}')
        last_exit=$(echo "$info" | awk '/"LastExitStatus"/ {gsub(/[^0-9-]/, "", $NF); print $NF}')
        [[ -z "$pid" ]] && pid="-"
        if [[ -n "$last_exit" && "$last_exit" != "0" && "$pid" == "-" ]]; then
            status="error($last_exit)"
        elif [[ "$pid" != "-" ]]; then
            status="running"
        else
            status="stopped"
        fi
    else
        status="unloaded"
    fi

    # Extract interval from plist
    interval=$(plutil -extract StartInterval raw "$plist" 2>/dev/null || echo "-")
    if [[ "$interval" != "-" ]]; then
        if (( interval >= 3600 )); then
            interval="$((interval / 3600))h"
        elif (( interval >= 60 )); then
            interval="$((interval / 60))m"
        else
            interval="${interval}s"
        fi
    fi

    printf "%-40s %-8s %-6s %s\n" "$label" "$status" "$pid" "$interval"
done

if [[ $found -eq 0 ]]; then
    echo "No tasks found under namespace: $NAMESPACE"
    echo "Create one with: /admin:schedule create"
fi
