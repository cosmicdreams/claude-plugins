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
# Verify local system acli is available and authenticated
# Drover uses the LOCAL system acli — not the acli inside DDEV containers.
# Run `acli auth:login` once; credentials are stored in ~/.acquia/cloud_api.conf.
command -v acli >/dev/null 2>&1 || {
  echo "acli not found — required for Acquia baseline." >&2
  echo "Install from https://github.com/acquia/cli/releases" >&2
  exit 1
}
[ -f "$HOME/.acquia/cloud_api.conf" ] || {
  echo "acli not authenticated. Run: acli auth:login" >&2
  echo "Credentials are stored in ~/.acquia/cloud_api.conf — no DDEV env vars needed." >&2
  exit 1
}
```

## Step 2: Run acquia-baseline.sh for each Acquia environment

Load `acli_alias` for each Acquia environment from drover-config.json and run the script:

```bash
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/local/drover/*/  2>/dev/null | tail -1)
SCRIPT="${PLUGIN_ROOT}scripts/acquia-baseline.sh"

[ -x "$SCRIPT" ] || { echo "acquia-baseline.sh not found or not executable at $SCRIPT"; exit 1; }

# Get acli_alias values for all (or filtered) Acquia environments
ENV_FILTER="${1:-}"  # optional: environment name to run solo, e.g. "production"

python3 -c "
import json, sys
cfg = json.load(open('.claude/drover-config.json'))
envs = [e for e in cfg['environments'] if e.get('type') == 'acquia']
if sys.argv[1]:
    envs = [e for e in envs if e['name'] == sys.argv[1]]
for e in envs:
    alias = e.get('acli_alias', '')
    if alias:
        print(alias)
    else:
        print(f'SKIP:{e[\"name\"]}', file=sys.stderr)
" "$ENV_FILTER" | while read -r ACLI_ALIAS; do
  "$SCRIPT" "$ACLI_ALIAS"
done
```

The optional argument filters to a single environment:
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
- `acli_alias` in drover-config.json is required for each Acquia environment (e.g. `"ahridrupalhosting.prod"`). If missing, that environment is skipped with a warning.
- Drover uses the **local system acli**, not DDEV's acli. Authenticate once with `acli auth:login` — no API keys needed in DDEV config or environment variables.
