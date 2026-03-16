#!/usr/bin/env bash
# Append an iteration record to results.jsonl.
#
# Usage: log-iteration.sh <results-path> <iteration> <change> <gate> <metric_before> <metric_after> <ratchet> <decision> <reason>
#
# All 9 arguments are required. Use "null" for metric_after on skips.

set -euo pipefail

RESULTS_PATH="${1:?Usage: log-iteration.sh <results-path> <iteration> <change> <gate> <metric_before> <metric_after> <ratchet> <decision> <reason>}"
ITERATION="$2"
CHANGE="$3"
GATE="$4"
METRIC_BEFORE="$5"
METRIC_AFTER="$6"
RATCHET="$7"
DECISION="$8"
REASON="$9"

python3 -c "
import json, datetime

metric_after = None if '$METRIC_AFTER' == 'null' else float('$METRIC_AFTER')

record = {
    'iteration': int('$ITERATION'),
    'timestamp': datetime.datetime.now().isoformat(),
    'change': '''$CHANGE''',
    'gate': '$GATE',
    'metric_before': float('$METRIC_BEFORE'),
    'metric_after': metric_after,
    'ratchet': float('$RATCHET'),
    'decision': '$DECISION',
    'reason': '''$REASON'''
}

with open('$RESULTS_PATH', 'a') as f:
    f.write(json.dumps(record) + '\n')

print(f\"Logged iteration $ITERATION: {record['decision']} (ratchet={record['ratchet']})\")
"
