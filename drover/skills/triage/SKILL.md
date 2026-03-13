---
name: triage
description: >
  Called by drover:watch to run one triage cycle for a specific environment. Reads the
  config and checkpoint, gathers new log entries, fingerprints and deduplicates, creates
  or augments Beads tickets, applies promotion rules, and sends notifications. This skill
  is the protocol reference for triage-agent — it is also callable directly for debugging
  a single environment's triage pass.
triggers:
  - "drover:triage"
  - "run triage"
  - "triage errors"
allowed-tools: Bash, Read, Write, Agent
---

# drover:triage — Single-environment triage cycle

Runs one complete triage pass for a named environment: gather → fingerprint → deduplicate → promote → notify.

Normally called by `drover:watch`. Call directly to debug a single environment.

## Usage

```
/drover:triage [environment_name]
```

If no environment name is given, prompt the user to choose from the configured environments.

## Step 1: Load config and checkpoint

```bash
cat .claude/drover-config.json
tail -1 ~/.claude/drover.state.jsonl 2>/dev/null || echo "{}"
```

Locate the environment config by name. If the environment is not found, print the available
environment names and stop.

## Step 2: Spawn triage-agent

Build a prompt for the triage agent including:
- `ENV_NAME`: environment name
- `ENV_CONFIG`: the full environment config JSON block
- `CHECKPOINT`: the per-environment checkpoint from state (or `{}` if first run)

Spawn `drover:triage-agent` with this context. The agent handles all log gathering,
fingerprinting, deduplication, promotion, and notification per its agent definition.

Wait for the agent to complete and capture its summary output.

## Step 3: Update state checkpoint

Take the summary output from the agent and update the state:

```python
import json, datetime, os

state_path = os.path.expanduser("~/.claude/drover.state.jsonl")
config = json.load(open(".claude/drover-config.json"))
project = config["project"]

# Load previous state
prev = {}
try:
    with open(state_path) as f:
        lines = [l.strip() for l in f if l.strip()]
        if lines:
            prev = json.loads(lines[-1])
except FileNotFoundError:
    pass

# Update checkpoint for this environment
# Triage only tracks watchdog WIDs. Log file analysis is handled by drover:baseline.
env_name = "ENV_NAME"  # substitute
new_checkpoint = {
    "watchdog": {"last_wid": AGENT_REPORTED_MAX_WID},
}

environments = prev.get("environments", {})
environments[env_name] = new_checkpoint

new_state = {
    "ts": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "project": project,
    "environments": environments,
    "cycle_summary": {
        "new_errors": AGENT_NEW,
        "augmented": AGENT_AUGMENTED,
        "promoted": AGENT_PROMOTED,
        "cross_env_boosts": AGENT_BOOSTS,
        "notifications_sent": AGENT_NOTIFICATIONS,
    }
}

with open(state_path, "a") as f:
    f.write(json.dumps(new_state) + "\n")

# Trim to last 30 days
cutoff = (datetime.datetime.utcnow() - datetime.timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
with open(state_path) as f:
    lines = [l.strip() for l in f if l.strip()]
kept = [l for l in lines if json.loads(l).get("ts", "") >= cutoff]
with open(state_path, "w") as f:
    f.write("\n".join(kept) + ("\n" if kept else ""))

print(f"State checkpoint updated for {env_name}")
```

## Output

```
drover:triage — {env_name}
  New:       {N} errors
  Augmented: {N} tickets
  Promoted:  {N} to lane-ready
  State:     ~/.claude/drover.state.jsonl updated
```
