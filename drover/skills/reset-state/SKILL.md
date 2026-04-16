---
name: reset-state
audience: internal
description: >
  State recovery skill for drover. Resets log processing offsets in ~/.claude/drover.state.jsonl
  to prevent a "ticket storm" after state file corruption or deletion. Soft reset (default) sets
  offsets to the current log tail so only new entries are processed going forward. Hard reset
  rescans from the beginning with a dedup guard to prevent duplicate ticket creation.
triggers:
  - "drover:reset-state"
  - "reset drover state"
  - "drover state recovery"
  - "drover corrupted state"
allowed-tools: Bash, Read, Write
---

# drover:reset-state — State recovery

Safely resets drover's log processing offsets after state corruption or deletion.

## Usage

```
/drover:reset-state --env <name>          Soft reset one environment
/drover:reset-state --env <name> --hard   Hard reset (full rescan with dedup guard)
/drover:reset-state --all                 Soft reset all environments
```

## When to use

- `~/.claude/drover.state.jsonl` was deleted or corrupted
- The triage agent is creating duplicate tickets (state offset drifted)
- After restoring from backup and the state file is stale
- After a long drover outage where logs have grown past the recorded offset

## Step 1: Parse arguments

Parse `--env <name>`, `--all`, and `--hard` from the invocation arguments.

If neither `--env` nor `--all` is provided: print usage and exit 1.

## Step 2: Load current state

```bash
STATE_FILE=~/.claude/drover.state.jsonl
CHECKPOINT=$(tail -1 "$STATE_FILE" 2>/dev/null || echo "{}")
echo "Current checkpoint:"
echo "$CHECKPOINT" | python3 -m json.tool 2>/dev/null || echo "(none)"
```

## Step 3: Determine new offsets

### Soft reset (default)

Set offsets to the **current end of the log files** — drover will only see new entries going forward.

For DDEV environments:
```bash
ENV_NAME=<target_env>

# Get current max WID
CURRENT_MAX_WID=$(ddev exec -s web drush watchdog:show --format=json --count=1 2>/dev/null | \
  python3 -c "import json,sys; entries=json.load(sys.stdin); print(entries[0]['wid'] if entries else 0)" 2>/dev/null || echo 0)

# Get current PHP log offset
CURRENT_PHP_OFFSET=$(ddev exec -s web bash -c "stat -c %s /var/log/php/error.log 2>/dev/null || echo 0" 2>/dev/null || echo 0)
```

For Acquia environments:
```bash
# Get current max WID via Drush alias
DDEV_ALIAS=$(python3 -c "
import json
cfg = json.load(open('.claude/drover-config.json'))
env = next((e for e in cfg['environments'] if e['name']=='${ENV_NAME}'), {})
print(env.get('ddev_alias', ''))
")
CURRENT_MAX_WID=$(ddev drush "${DDEV_ALIAS}" watchdog:show --format=json --count=1 2>/dev/null | \
  python3 -c "import json,sys; entries=json.load(sys.stdin); print(entries[0]['wid'] if entries else 0)" 2>/dev/null || echo 0)
```

### Hard reset

Set all offsets to 0. Enable dedup guard by loading all existing fingerprints from the Beads board:

```bash
KNOWN_FPS=$(bd list -l board-drover --db .beads/drover.db --json --flat 2>/dev/null | python3 -c "
import json, sys, re
tickets = json.load(sys.stdin)
fps = []
for t in tickets:
    m = re.search(r'\*\*Fingerprint:\*\*\s+\`([a-f0-9]+)\`', t.get('body', ''))
    if m:
        fps.append(m.group(1))
print(json.dumps(fps))
" 2>/dev/null || echo "[]")

echo "Dedup guard: $(echo $KNOWN_FPS | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")" known fingerprints loaded
```

Write dedup guard file (triage agent checks this on hard-reset runs):
```bash
python3 -c "
import json
fps = ${KNOWN_FPS}
data = {'dedup_guard': True, 'known_fps': fps}
import pathlib
pathlib.Path('.claude/drover-dedup-guard.json').write_text(json.dumps(data, indent=2))
print(f'Dedup guard written: {len(fps)} known fingerprints')
"
```

## Step 4: Write new state record

```python
import json, datetime, os

state_path = os.path.expanduser("~/.claude/drover.state.jsonl")
config = json.load(open(".claude/drover-config.json"))

# Load previous state to preserve other envs
try:
    prev = json.loads(open(state_path).readlines()[-1].strip())
    prev_envs = prev.get("environments", {})
except:
    prev_envs = {}

if reset_all:
    envs_to_reset = [e["name"] for e in config.get("environments", [])]
else:
    envs_to_reset = [target_env_name]

for env_name in envs_to_reset:
    if hard_reset:
        prev_envs[env_name] = {
            "watchdog": {"last_wid": 0},
            "php_error_log": {"byte_offset": 0},
            "nginx_error_log": {"byte_offset": 0},
            "apache_error_log": {"byte_offset": 0},
        }
    else:
        prev_envs[env_name] = {
            "watchdog": {"last_wid": current_max_wid},
            "php_error_log": {"byte_offset": current_php_offset},
            "nginx_error_log": {"byte_offset": 0},
            "apache_error_log": {"byte_offset": 0},
        }

new_state = {
    "ts": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "project": config["project"],
    "environments": prev_envs,
    "reset": {"type": "hard" if hard_reset else "soft", "envs": envs_to_reset},
}

with open(state_path, "a") as f:
    f.write(json.dumps(new_state) + "\n")
```

## Step 5: Output summary

```
drover:reset-state — {soft|hard} reset
  Environments: {env_list}
  State file:   ~/.claude/drover.state.jsonl
  Previous WID: {old_wid}  →  New WID: {new_wid}
  Mode: {soft: "only new entries will be processed" | hard: "full rescan with dedup guard"}
  Dedup guard:  {N known fingerprints loaded | N/A for soft}

Next triage cycle will {pick up from current log tail | rescan from beginning with dedup}.
```

## Notes

- Soft reset is safe to run at any time with no data loss
- Hard reset with dedup guard: new occurrences of existing errors → occurrence count updated only (no new ticket)
- Hard reset without Beads DB: dedup guard is empty (no protection) — not recommended on active boards
- The dedup guard file (`.claude/drover-dedup-guard.json`) is deleted automatically after one successful triage cycle
