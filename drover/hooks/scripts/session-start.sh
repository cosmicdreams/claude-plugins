#!/usr/bin/env bash
# Drover session-start hook: inject ambient error status if drover is configured in this project.
# Silent-fail on any error — must never block session start.

set -euo pipefail

CONFIG_FILE="${PWD}/.claude/drover-config.json"
STATE_FILE="${HOME}/.claude/drover.state.jsonl"

# Only run if this project has drover configured
[ -f "$CONFIG_FILE" ] || exit 0

# Check if drover is enabled
ENABLED=$(python3 -c "import json,sys; d=json.load(open('$CONFIG_FILE')); print(d.get('enabled','true'))" 2>/dev/null) || exit 0
[ "$ENABLED" = "True" ] || [ "$ENABLED" = "true" ] || exit 0

# Get the Beads DB path
DB_PATH="${PWD}/.beads/drover.db"
[ -d "$DB_PATH" ] || exit 0

# Count open errors by lane
LANE_COUNTS=$(bd list -l board-drover --db "$DB_PATH" --json --flat 2>/dev/null | python3 -c "
import json, sys, collections
try:
    items = json.load(sys.stdin)
    lanes = collections.Counter()
    for item in items:
        labels = item.get('labels', [])
        for label in labels:
            if label.startswith('lane-') and label not in ('lane-done', 'lane-closed'):
                lanes[label] += 1
    total = sum(lanes.values())
    lane_parts = []
    lane_map = {
        'lane-triage': 'triage',
        'lane-ready': 'ready',
        'lane-implementing': 'implementing',
        'lane-awaiting-review': 'awaiting-review',
    }
    for lane_key, lane_label in lane_map.items():
        if lanes.get(lane_key, 0) > 0:
            lane_parts.append(f'{lanes[lane_key]} {lane_label}')
    print(f'{total}|{chr(44).join(lane_parts)}')
except Exception:
    print('0|')
" 2>/dev/null) || exit 0

TOTAL=$(echo "$LANE_COUNTS" | cut -d'|' -f1)
PARTS=$(echo "$LANE_COUNTS" | cut -d'|' -f2)

# Get time since last triage
LAST_TRIAGE="unknown"
if [ -f "$STATE_FILE" ]; then
    LAST_TS=$(tail -1 "$STATE_FILE" 2>/dev/null | python3 -c "
import json, sys, datetime
try:
    line = sys.stdin.read().strip()
    if line:
        d = json.loads(line)
        ts = d.get('ts', '')
        if ts:
            dt = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))
            now = datetime.datetime.now(datetime.timezone.utc)
            diff = now - dt
            mins = int(diff.total_seconds() / 60)
            if mins < 60:
                print(f'{mins} min ago')
            else:
                print(f'{int(mins/60)}h ago')
        else:
            print('unknown')
except Exception:
    print('unknown')
" 2>/dev/null) || true
    [ -n "$LAST_TS" ] && LAST_TRIAGE="$LAST_TS"
fi

# Output status line (only if there are open errors or we have state)
if [ "$TOTAL" -gt 0 ] 2>/dev/null || [ "$LAST_TRIAGE" != "unknown" ]; then
    if [ -n "$PARTS" ]; then
        echo "[drover] ${TOTAL} open errors (${PARTS}) | last triage: ${LAST_TRIAGE}"
    else
        echo "[drover] no open errors | last triage: ${LAST_TRIAGE}"
    fi
fi

exit 0
