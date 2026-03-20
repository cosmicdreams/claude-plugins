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

Derive the acli env ID for each Acquia environment from `drush/sites/<group>.site.yml`
(`ac-site` + `ac-env` fields), using the `ddev_alias` already in drover-config.json.
No `acli_alias` field is needed in drover-config.json.

```bash
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/local/drover/*/  2>/dev/null | tail -1)
SCRIPT="${PLUGIN_ROOT}scripts/acquia-baseline.sh"

[ -x "$SCRIPT" ] || { echo "acquia-baseline.sh not found or not executable at $SCRIPT"; exit 1; }

# Derive acli env IDs from drush site YAML for all (or filtered) Acquia environments
ENV_FILTER="${1:-}"  # optional: environment name to run solo, e.g. "production"

python3 -c "
import json, os, re, sys

def drush_alias_to_acli(ddev_alias):
    if not ddev_alias.startswith('@'):
        return ''
    parts = ddev_alias.lstrip('@').split('.')
    if len(parts) < 2:
        return ''
    group, env_key = parts[0], parts[1]
    yaml_path = os.path.join('drush', 'sites', f'{group}.site.yml')
    if not os.path.exists(yaml_path):
        return ''
    with open(yaml_path) as f:
        content = f.read()
    blocks = re.split(r'^(\w[\w-]*):\s*$', content, flags=re.MULTILINE)
    for i in range(1, len(blocks), 2):
        if blocks[i] == env_key and i + 1 < len(blocks):
            block = blocks[i + 1]
            m_site = re.search(r'ac-site:\s*(\S+)', block)
            m_env  = re.search(r'ac-env:\s*(\S+)', block)
            if m_site and m_env:
                return f'{m_site.group(1)}.{m_env.group(1)}'
    return ''

cfg = json.load(open('.claude/drover-config.json'))
envs = [e for e in cfg['environments'] if e.get('type') == 'acquia']
env_filter = sys.argv[1] if len(sys.argv) > 1 else ''
if env_filter:
    envs = [e for e in envs if e['name'] == env_filter]
for e in envs:
    alias = drush_alias_to_acli(e.get('ddev_alias', ''))
    if alias:
        print(alias)
    else:
        print(f'SKIP:{e[\"name\"]} (no drush alias found)', file=sys.stderr)
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
- The acli env ID is derived from `drush/sites/<group>.site.yml` (`ac-site` + `ac-env`) — no `acli_alias` field needed in drover-config.json. The `ddev_alias` field (e.g. `@mysite.prod`) is used to locate the right YAML file and env block.
- Drover uses the **local system acli**, not DDEV's acli. Authenticate once with `acli auth:login` — no API keys needed in DDEV config or environment variables.
