#!/usr/bin/env bash
# drover/scripts/acquia-baseline.sh
# Downloads 24h of Acquia logs and computes per-fingerprint error baseline.
#
# Uses the local system acli (NOT the acli inside DDEV containers).
# Requires: `acli auth:login` to have been run once on this machine.
# Credentials are stored by acli in ~/.acquia/cloud_api.conf.
#
# Usage: acquia-baseline.sh <acli_env_id> [output_dir]
#   acli_env_id — Acquia environment alias from drover-config.json "acli_alias"
#                 e.g. "mysitehosting.prod" or "mysitehosting.test"
# Output: JSON to stdout with top error fingerprints and their hourly rates

set -euo pipefail

ACLI_ENV_ID="${1:-}"
OUTPUT_DIR="${2:-/tmp/drover-baseline}"

if [ -z "$ACLI_ENV_ID" ]; then
  echo "Usage: acquia-baseline.sh <acli_env_id> [output_dir]" >&2
  echo "  acli_env_id — e.g. mysitehosting.prod" >&2
  exit 1
fi

# Verify local system acli is available and authenticated
if ! command -v acli >/dev/null 2>&1; then
  echo "ERROR: acli not found. Install from https://github.com/acquia/cli/releases" >&2
  exit 1
fi

if [ ! -f "$HOME/.acquia/cloud_api.conf" ]; then
  echo "ERROR: acli not authenticated. Run: acli auth:login" >&2
  exit 1
fi

ENV_SLUG="${ACLI_ENV_ID##*.}"
mkdir -p "$OUTPUT_DIR"

PHP_LOG="${OUTPUT_DIR}/${ENV_SLUG}-php-24h.log"
APACHE_LOG="${OUTPUT_DIR}/${ENV_SLUG}-apache-24h.log"

# Download 24h PHP error log via local system acli
echo "Downloading PHP error log for ${ACLI_ENV_ID}..." >&2
acli api:environments:log-download "${ACLI_ENV_ID}" php-error > "$PHP_LOG" 2>/dev/null || {
  echo "WARNING: Failed to download PHP error log for ${ACLI_ENV_ID}" >&2
  touch "$PHP_LOG"
}

# Download 24h Apache error log via local system acli
echo "Downloading Apache error log for ${ACLI_ENV_ID}..." >&2
acli api:environments:log-download "${ACLI_ENV_ID}" apache-error > "$APACHE_LOG" 2>/dev/null || {
  echo "WARNING: Failed to download Apache error log for ${ACLI_ENV_ID}" >&2
  touch "$APACHE_LOG"
}

# Compute baseline statistics
python3 - "$PHP_LOG" "$APACHE_LOG" "$ENV_SLUG" <<'PYEOF'
import sys, re, json, collections, hashlib
from datetime import datetime, timezone

php_log  = sys.argv[1]
apache_log = sys.argv[2]
env_slug  = sys.argv[3] if len(sys.argv) > 3 else ''

PHP_RE = re.compile(
    r'\[(\d{2}-\w{3}-\d{4} \d{2}:\d{2}:\d{2}) UTC\] PHP \w+: (.+?) in .+ on line \d+'
)
APACHE_RE = re.compile(
    r'\[\w{3} \w{3} \s?\d{1,2} \d{2}:\d{2}:\d{2}[^\]]*\d{4}\] \[\w+\] .+?: (.+)'
)

def make_fp(msg):
    normalized = re.sub(r'\b\d+\b', 'N', msg)
    normalized = re.sub(r'(?:/[^\s,]+)', 'PATH', normalized)
    normalized = re.sub(r"'[^']{0,60}'", 'STR', normalized)
    return hashlib.md5(normalized.encode()).hexdigest()[:12]

hourly  = collections.defaultdict(lambda: collections.defaultdict(int))
samples = collections.defaultdict(str)
total   = collections.Counter()

for log_file, pattern, group_idx in [
    (php_log,    PHP_RE,    (1, 2)),
    (apache_log, APACHE_RE, (None, 1)),
]:
    date_grp, msg_grp = group_idx
    try:
        with open(log_file) as f:
            for line in f:
                m = pattern.match(line.strip())
                if not m:
                    continue
                msg = m.group(msg_grp).strip()
                fp = make_fp(msg)
                hour_key = ''
                if date_grp:
                    try:
                        dt = datetime.strptime(m.group(date_grp), '%d-%b-%Y %H:%M:%S')
                        hour_key = dt.strftime('%Y-%m-%dT%H:00:00Z')
                    except ValueError:
                        hour_key = 'unknown'
                else:
                    hour_key = 'unknown'
                hourly[fp][hour_key] += 1
                total[fp] += 1
                if fp not in samples:
                    samples[fp] = msg[:120]
    except FileNotFoundError:
        continue

results = []
for fp, hours in hourly.items():
    counts = list(hours.values())
    mean = sum(counts) / len(counts) if counts else 0
    results.append({
        'fp': fp,
        'sample': samples.get(fp, ''),
        'total_24h': total[fp],
        'mean_hourly': round(mean, 2),
        'hours_seen': len(counts),
        'hourly': dict(hours),
    })

results.sort(key=lambda x: x['total_24h'], reverse=True)

print(json.dumps({
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'env_slug': env_slug,
    'top_errors': results[:50],
}, indent=2))
PYEOF
