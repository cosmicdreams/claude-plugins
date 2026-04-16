#!/usr/bin/env bash
# Runs every scenario in scenarios/, merges their JSON-per-line outputs
# into one blob, and writes it to results/baseline-<ts>.json.
set -u
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HARNESS_DIR"

ts=$(date -u +%Y%m%dT%H%M%SZ)
out="results/baseline-${ts}.json"
mkdir -p results

chmod +x shims/ddev scenarios/*.sh 2>/dev/null || true

tmp="$(mktemp)"
echo "{" > "$tmp"
echo "  \"timestamp\": \"$ts\"," >> "$tmp"
echo "  \"metrics\": [" >> "$tmp"

first=1
fail=0
for s in scenarios/*.sh; do
  name=$(basename "$s" .sh)
  echo ">>> $name" >&2
  if output=$("$s" 2>/tmp/ux-harness-stderr); then
    :
  else
    echo "    FAILED: see /tmp/ux-harness-stderr" >&2
    fail=$((fail+1))
    continue
  fi
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [ "$first" -eq 0 ]; then echo "    ," >> "$tmp"; fi
    echo "    $line" >> "$tmp"
    first=0
  done <<< "$output"
done

echo "  ]" >> "$tmp"
echo "}" >> "$tmp"

# Pretty-print and validate.
python3 -c "
import json, sys
try:
    d = json.load(open('$tmp'))
    json.dump(d, open('$out','w'), indent=2)
    print('wrote', '$out')
    for m in d['metrics']:
        print(f\"  {m['metric']:40s} = {m['value']}\")
except Exception as e:
    print('INVALID JSON:', e); sys.exit(2)
"
rm -f "$tmp"

if [ "$fail" -gt 0 ]; then
  echo "WARNING: $fail scenario(s) failed." >&2
  exit 1
fi
