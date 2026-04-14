#!/usr/bin/env bash
# acquia-baseline.sh <env-alias> [<output-dir>]
#
# Thin wrapper around backfill.sh that additionally computes per-
# fingerprint hourly rates used for velocity tier classification
# (rising / stable / falling).
#
# The heavy lifting (download + fingerprint + state update) is done
# by backfill.sh. This script requests a JSONL side-stream, then
# aggregates it into the legacy baseline JSON format for callers
# that already consume it (drover-config.baselines).
#
# Usage: acquia-baseline.sh <env-alias> [<output-dir>]
# Output: JSON on stdout with generated_at, env_slug, and top_errors[].

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALIAS="${1:-}"
OUTPUT_DIR="${2:-/tmp/drover-baseline}"

if [ -z "$ALIAS" ]; then
  echo "Usage: acquia-baseline.sh <env-alias> [<output-dir>]" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
JSONL="$OUTPUT_DIR/${ALIAS}-events.jsonl"
: > "$JSONL"  # truncate

BACKFILL="${DROVER_BACKFILL_SCRIPT:-${SCRIPT_DIR}/backfill.sh}"

DROVER_JSONL_OUT="$JSONL" \
  "$BACKFILL" "$ALIAS" "php-error,apache-error" > "$OUTPUT_DIR/${ALIAS}-emit.log" 2>&1 \
  || echo "WARN: backfill exited non-zero for $ALIAS" >&2

# Aggregate JSONL into the baseline shape.
JSONL="$JSONL" ALIAS="$ALIAS" python3 <<'PY'
import collections, datetime, json, os

jsonl_path = os.environ["JSONL"]
alias = os.environ["ALIAS"]

hourly = collections.defaultdict(lambda: collections.defaultdict(int))
samples = {}
totals = collections.Counter()

def to_hour_bucket(ts):
    if not ts:
        return "unknown"
    # PHP: "14-Apr-2026 20:22:40"
    for fmt in ("%d-%b-%Y %H:%M:%S",):
        try:
            dt = datetime.datetime.strptime(ts, fmt)
            return dt.strftime("%Y-%m-%dT%H:00:00Z")
        except ValueError:
            pass
    return "unknown"

try:
    with open(jsonl_path) as f:
        for line in f:
            try:
                ev = json.loads(line)
            except Exception:
                continue
            fp = ev.get("fingerprint")
            if not fp:
                continue
            bucket = to_hour_bucket(ev.get("ts"))
            hourly[fp][bucket] += 1
            totals[fp] += 1
            samples.setdefault(fp, (ev.get("message") or "")[:120])
except FileNotFoundError:
    pass

results = []
for fp, hours in hourly.items():
    counts = list(hours.values())
    mean = round(sum(counts) / len(counts), 2) if counts else 0
    results.append({
        "fp": fp,
        "sample": samples.get(fp, ""),
        "total_24h": totals[fp],
        "mean_hourly": mean,
        "hours_seen": len(counts),
        "hourly": dict(hours),
    })
results.sort(key=lambda x: x["total_24h"], reverse=True)

print(json.dumps({
    "generated_at": datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00","Z"),
    "env_slug": alias.split(".")[-1],
    "top_errors": results[:50],
}, indent=2))
PY
