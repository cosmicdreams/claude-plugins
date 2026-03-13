---
name: watch
description: >
  Drover's loop orchestrator. On each cycle: runs triage for all enabled environments,
  then runs the verification phase against awaiting-review and done tickets. Designed to
  run on a /loop 3m schedule. Reads config from .claude/drover-config.json and state
  from ~/.claude/drover.state.jsonl.
triggers:
  - "drover:watch"
  - "start watching"
  - "monitor errors"
  - "watch drupal errors"
allowed-tools: Bash, Read, Write, Agent, TeamCreate, TeamDelete, SendMessage
---

# drover:watch — Loop orchestrator

Each cycle: triage all environments → verify fixed tickets → update state.

Designed to run via `/loop 3m /drover:watch`. Cancel with `CronDelete`.

## Step 1: Pre-flight checks

```bash
# Run dependency check first
PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/local/drover/*/ 2>/dev/null | tail -1)
VERIFY_DEPS="${PLUGIN_ROOT}scripts/verify-deps.sh"
if [ -x "$VERIFY_DEPS" ]; then
  "$VERIFY_DEPS" || { echo "Dependency check failed. Resolve the above before running drover:watch."; exit 1; }
fi

# Config must exist
[ -f .claude/drover-config.json ] || { echo "drover not configured. Run /drover:setup first."; exit 1; }

# Check enabled flag
python3 -c "
import json
cfg = json.load(open('.claude/drover-config.json'))
if not cfg.get('enabled', True):
    print('DISABLED')
    exit(0)
print('OK')
"
```

If `DISABLED`, print "drover is disabled (enabled: false in config)." and stop.

```bash
# Board must exist
[ -f .beads/drover.db ] || { echo "Drover board not initialized. Run /drover:setup first."; exit 1; }
```

## Step 2: Triage phase — all environments

Load config and find all enabled environments:

```bash
python3 -c "
import json
cfg = json.load(open('.claude/drover-config.json'))
for env in cfg.get('environments', []):
    print(env['name'])
"
```

Load the latest checkpoint:
```bash
tail -1 ~/.claude/drover.state.jsonl 2>/dev/null || echo "{}"
```

**Create an agent team before spawning any triage agents** — this gives all agents a shared
communication channel and lets them report their summaries back to team-lead:

```
TeamCreate(
  team_name = "drover-watch-{YYYYMMDD-HHMM}",
  description = "Drover triage cycle — {N} environments"
)
```

For each environment, spawn a `drover:triage-agent` into the team. If multiple environments
are configured, spawn them all in parallel (multiple Agent calls in one message):

```
Agent(
  subagent_type = "drover:triage-agent",
  team_name     = "drover-watch-{YYYYMMDD-HHMM}",
  name          = "triage-{env_name}",
  prompt        = """
    Your name is triage-{env_name}. You are part of team "drover-watch-{YYYYMMDD-HHMM}".

    ENV_CONFIG: {full_env_config_json}
    CHECKPOINT: {per_env_checkpoint_json}
    FULL_CONFIG: {full_drover_config_json}

    Follow the drover:triage-agent protocol for this environment.

    When complete, send your summary to team-lead:
      SendMessage(type="message", recipient="team-lead", content="{json_summary}")
  """
)
```

Wait for all triage agents to send their completion messages. After all have reported,
send each a shutdown request:

```
SendMessage(type="shutdown_request", recipient="triage-{env_name}", content="Triage complete. Shut down.")
```

Then clean up the team:

```
TeamDelete()
```

Collect summary output from each agent's final SendMessage for the verification phase.

## Step 3: Verification phase

Check for tickets in `lane-awaiting-review` or `lane-done`:

```bash
export BD_DB=.beads/drover.db
bd list -l board-drover -l lane-awaiting-review --json 2>/dev/null
bd list -l board-drover -l lane-done --json 2>/dev/null
```

For each such ticket, extract the `fp` fingerprint hash from its body:

```python
import re
fp_match = re.search(r'\*\*Fingerprint:\*\*\s+`([a-f0-9]{12})`', ticket_body)
if fp_match:
    fp = fp_match.group(1)
```

Check whether this fingerprint appeared in ANY environment's delta during the triage phase.
The triage agents' summaries should indicate which fingerprints were seen.

**If fingerprint was seen in current cycle delta:**
- Reset the consecutive-absent counter in Verification History
- If ticket is in `lane-done` (was considered fixed): re-open to `lane-ready`
  ```bash
  bd update {id} --remove-label lane-done --add-label lane-ready \
    --append-notes "{ISO_NOW}: Fix ineffective — fingerprint reappeared. Re-opened."
  ```
- Send "fix ineffective" notification (subject to quiet mode)

**If fingerprint was NOT seen (absent this cycle):**
- Add an absent entry to Verification History section:
  ```bash
  bd update {id} --append-notes "{ISO_NOW}: Verification cycle {N} — fingerprint absent."
  ```
- Count the number of consecutive-absent entries in Verification History
- If count >= `verification.clear_after_cycles` (default 3): auto-close
  ```bash
  bd update {id} --remove-label lane-awaiting-review --add-label lane-closed \
    --append-notes "{ISO_NOW}: Auto-closed after {N} consecutive absent cycles. Fix confirmed effective."
  ```

## Step 4: Write consolidated state checkpoint

After all triage agents complete, merge their per-environment checkpoints and write one
consolidated state record to `~/.claude/drover.state.jsonl`:

```python
import json, datetime, os

state_path = os.path.expanduser("~/.claude/drover.state.jsonl")
config = json.load(open(".claude/drover-config.json"))

# Build merged environments dict from all agent summaries
merged_environments = {}
for env_name, summary in all_agent_summaries.items():
    merged_environments[env_name] = {
        "watchdog": {"last_wid": summary["max_wid"]},
        "php_error_log": {"byte_offset": summary["php_offset"]},
        "nginx_error_log": {"byte_offset": summary["nginx_offset"]},
        "apache_error_log": {"byte_offset": summary["apache_offset"]},
    }

total_new = sum(s["new_errors"] for s in all_agent_summaries.values())
total_promoted = sum(s["promoted"] for s in all_agent_summaries.values())
total_notifications = sum(s["notifications"] for s in all_agent_summaries.values())
total_boosts = sum(s["cross_env_boosts"] for s in all_agent_summaries.values())

new_state = {
    "ts": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "project": config["project"],
    "environments": merged_environments,
    "cycle_summary": {
        "new_errors": total_new,
        "augmented": sum(s["augmented"] for s in all_agent_summaries.values()),
        "promoted": total_promoted,
        "cross_env_boosts": total_boosts,
        "notifications_sent": total_notifications,
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
```

## Step 5: Output cycle summary

```
━━━ drover:watch — {HH:MM} ━━━━━━━━━━━━━━━━━━━━━━━━
  Environments: {env1}, {env2}

TRIAGE
  New errors:    {N}
  Augmented:     {N}
  Noise-skipped: {N}
  Promoted:      {N}
  Cross-boosts:  {N}

VERIFICATION
  Checked:   {N} fixed tickets
  Re-opened: {N} (fix ineffective)
  Closed:    {N} (confirmed fixed)

Notifications sent: {N}
Next run: /loop 3m /drover:watch
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If nothing happened: `✓ drover:watch {HH:MM} — no new errors, {N} verified`

## Running on a loop

```
/loop 3m /drover:watch
```

Cancel with `CronDelete` using the job ID returned by `/loop`.
