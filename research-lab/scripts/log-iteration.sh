#!/usr/bin/env bash
# Append an iteration record to results.jsonl.
#
# Usage: log-iteration.sh <results-path> <iteration> <change> <gate> <metric_before> <metric_after> <ratchet> <decision> <reason> [extras-json]
#
# The optional extras JSON must be an object with no reserved keys.
# All 9 arguments are required. Use "null" for metric_before (baseline) or
# metric_after (skips) when there is no numeric value.

set -euo pipefail

RESULTS_PATH="${1:?Usage: log-iteration.sh <results-path> <iteration> <change> <gate> <metric_before> <metric_after> <ratchet> <decision> <reason>}"
: "${9:?Usage: log-iteration.sh ... <reason> — all 9 arguments are required}"

# Values are passed as argv and read from sys.argv — NOT interpolated into the
# Python source. A change/reason/gate containing a quote, $, backtick, or
# apostrophe therefore cannot break the parse or inject a command.
python3 - "$@" <<'PY'
import json, datetime, sys

(_, results_path, iteration, change, gate,
 metric_before, metric_after, ratchet, decision, reason) = sys.argv[:10]


def num_or_none(v):
    return None if v == "null" else float(v)


record = {
    "iteration": int(iteration),
    "timestamp": datetime.datetime.now().astimezone().isoformat(),
    "change": change,
    "gate": gate,
    "metric_before": num_or_none(metric_before),
    "metric_after": num_or_none(metric_after),
    "ratchet": num_or_none(ratchet),
    "decision": decision,
    "reason": reason,
}

if len(sys.argv) > 10:
    extras = json.loads(sys.argv[10])
    if not isinstance(extras, dict) or record.keys() & extras.keys():
        raise ValueError("extras must be an object without reserved keys")
    record.update(extras)

with open(results_path, "a") as f:
    f.write(json.dumps(record) + "\n")

print(f"Logged iteration {iteration}: {decision} (ratchet={ratchet})")
PY
