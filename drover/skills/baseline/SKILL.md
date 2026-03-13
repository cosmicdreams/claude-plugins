---
name: baseline
description: >
  Runs a 24-hour Acquia log download and fingerprint velocity computation for all configured
  Acquia environments. Updates .claude/drover.baselines.json with rising/stable/falling velocity
  data. Run manually or via /loop 24h. Long-window only — short-window data comes from the
  triage loop.
triggers:
  - "drover:baseline"
  - "run baseline"
  - "compute baseline"
  - "update drover baseline"
allowed-tools: Bash, Read
---

# drover:baseline — 24h Acquia log baseline

Computes fingerprint velocity baselines from 24-hour Acquia log downloads.

## When to run

- Manually, on first setup for an Acquia project
- On a `/loop 24h /drover:baseline` schedule
- After major deployments (to reset baseline expectations)

## Step 1: Pre-flight

```bash
[ -f .claude/drover-config.json ] || { echo "No drover config. Run /drover:setup first."; exit 1; }

# Check for Acquia environments
python3 -c "
import json, sys
cfg = json.load(open('.claude/drover-config.json'))
acquia_envs = [e for e in cfg.get('environments', []) if e.get('type') == 'acquia']
if not acquia_envs:
    print('NO_ACQUIA')
else:
    print('OK')
"
```

If `NO_ACQUIA`: print `"No Acquia environments configured."` and exit 0.

```bash
# Verify acli is available
command -v acli >/dev/null 2>&1 || {
  echo "acli not found — required for Acquia baseline." >&2
  echo "Install: https://docs.acquia.com/acquia-cli/" >&2
  exit 1
}
```

## Step 2: Run acquia-baseline.sh

```bash
# Find the script path
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/local/drover/*/  2>/dev/null | tail -1)
SCRIPT="${PLUGIN_ROOT}scripts/acquia-baseline.sh"

[ -x "$SCRIPT" ] || { echo "acquia-baseline.sh not found or not executable at $SCRIPT"; exit 1; }

"$SCRIPT" ".claude/drover-config.json" "$@"
```

The script accepts an optional second argument for environment name filter:
```bash
/drover:baseline               # runs all Acquia environments
/drover:baseline production    # runs only the environment named "production"
```

## Step 3: Display results

After the script completes, display the summary:

```bash
python3 -c "
import json
try:
    data = json.load(open('.claude/drover.baselines.json'))
    print(f'Baseline updated: {data.get(\"ts\", \"unknown\")}')
    if data.get('partial'):
        print('WARNING: Partial results (some environments failed)')
    baselines = data.get('baselines', {})
    rising = sum(1 for v in baselines.values() if v.get('velocity') == 'rising')
    falling = sum(1 for v in baselines.values() if v.get('velocity') == 'falling')
    stable = sum(1 for v in baselines.values() if v.get('velocity') == 'stable')
    print(f'Fingerprints: {len(baselines)} total | {rising} rising | {stable} stable | {falling} falling')
    if rising:
        print()
        print('RISING fingerprints (potential escalating issues):')
        for fp, v in baselines.items():
            if v.get('velocity') == 'rising':
                print(f'  {fp[:12]} — {v.get(\"count_24h\", 0)}x today (prev: {v.get(\"count_prev\", 0)}x)')
except FileNotFoundError:
    print('No baseline file found.')
"
```

## Notes

- Baseline data is used by the triage agent (Step 4.5) to detect rising error velocity
- If baselines.json has `"partial": true`, the velocity boost in triage is skipped for that run
- The baseline only covers Acquia log sources; DDEV local errors are not baselined
