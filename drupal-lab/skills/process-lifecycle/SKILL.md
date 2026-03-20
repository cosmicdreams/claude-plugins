---
name: process-lifecycle
description: Manage the DDEV lifecycle for Drupal worktrees -- start, ready-check, completion, and shutdown. Use when setting up DDEV in a worktree, checking environment readiness, deciding whether to stop DDEV, or cleaning up after work -- e.g. "start DDEV for this worktree", "is my environment ready", "shut down DDEV", "clean up the worktree". Do NOT use for running dev tools inside DDEV -- use drupal-lab:ddev-drupal-dev instead.
---

# Process Lifecycle

Governs how DDEV-based development processes start, run, complete, and shut down in Drupal worktrees. Every agent working in a worktree follows this lifecycle.

```
INIT --> READY CHECK --> [WORK] --> COMPLETION CHECK --> SHUTDOWN
              |                          |
              v                          v
        ERROR RECOVERY            STUCK DETECTION
```

## Context Awareness
**Important**: All relative paths (e.g. `./worktrees/...`) assume you are executing from the **Project Root** (e.g. `~/OpenSource/SAME_PAGE_PREVIEW`).
- The Project Root is the folder that *contains* the `worktrees/` directory.
- If you are inside a worktree (e.g. `.../worktrees/1234`), you must `cd ../..` to return to the Project Root before running commands.

## Phase 1: INIT (Environment Bootstrap)

Start here when beginning work on any worktree. Prerequisite: worktree must exist (use `/create-worktree` if needed).

### 1.1 Verify Worktree

```bash
WORKTREE="./worktrees/{ISSUE}"

# Confirm worktree exists
test -d "$WORKTREE" || echo "ERROR: worktree does not exist. Use /create-worktree first."

# Confirm it's a git worktree
git -C "$WORKTREE" rev-parse --is-inside-work-tree
```

### 1.2 Set Up DDEV

Only needed if `.ddev/` doesn't exist yet.

```bash
# Check if DDEV is already configured
if [ ! -d "$WORKTREE/.ddev" ]; then
  # Copy from main
  cp -r ./worktrees/main/.ddev "$WORKTREE/"

  # CRITICAL: Create unique config.local.yaml
  cat > "$WORKTREE/.ddev/config.local.yaml" << EOF
name: drupal-{ISSUE}
EOF
fi
```

**Why unique names matter:** Without a unique `name` in `config.local.yaml`, DDEV instances share the same container namespace and conflict. Every worktree MUST have its own name matching the issue number.

### 1.3 Check DDEV Slot Availability

In sprint context, max 3 concurrent DDEV instances. Check before starting.

```bash
# Count running DDEV instances (JSON output for reliable parsing)
RUNNING=$(ddev list --json-output 2>/dev/null | jq '[.raw[] | select(.status == "running")] | length')
echo "DDEV slots: $RUNNING / 3"

if [ "$RUNNING" -ge 3 ]; then
  echo "WARNING: All DDEV slots occupied."
  echo "Options: (1) Do Phase 1 static work without DDEV"
  echo "         (2) Wait for a slot to free up"
  echo "         (3) Stop a finished instance: ddev stop in completed worktree"
fi
```

### 1.4 Start DDEV

```bash
cd "$WORKTREE"
ddev start 2>&1 | tee /tmp/ddev-{ISSUE}.log
```

Capture the log. If startup fails, go to Phase 5 (Error Recovery).

### 1.5 Install Dependencies

```bash
cd "$WORKTREE"
ddev composer install
```

## Phase 2: READY CHECK (Gate Before Work)

Verify environment is fully operational before starting work. Run all checks; any failure means the environment is not ready.

```bash
cd "$WORKTREE"

# 2.1 Containers running (JSON output for reliable parsing)
STATUS=$(ddev describe --json-output 2>/dev/null | jq -r '.raw.status')
[ "$STATUS" = "running" ] && echo "PASS: containers running" || echo "FAIL: containers not running (status: $STATUS)"

# 2.2 PHP version
ddev exec php -v | head -1
# Expected: PHP 8.5.x

# 2.3 Database accessible
ddev exec drush sql:query "SELECT 1" 2>/dev/null && echo "PASS: database" || echo "INFO: database not installed (OK for phpcs/phpstan-only work)"

# 2.4 Chrome webdriver (needed for FunctionalJavascript tests)
ddev exec curl -sf http://chrome:4444/status | grep -q '"ready":true' && echo "PASS: chrome" || echo "INFO: chrome not ready (OK for non-browser tests)"

# 2.5 Composer dependencies
ddev exec test -f vendor/autoload.php && echo "PASS: vendor" || echo "FAIL: run ddev composer install"
```

### Ready Check Summary

| Check | Required For | Pass Criteria |
|-------|-------------|---------------|
| Containers running | All work | `ddev describe` shows running |
| PHP 8.5 | All work | `php -v` shows 8.5.x |
| Database | Kernel/Functional tests | `drush sql:query` succeeds |
| Chrome webdriver | FunctionalJavascript tests | chrome:4444/status ready |
| Vendor dependencies | All work | vendor/autoload.php exists |

**Minimum for Phase 1 validation (static analysis only):** Containers + PHP + Vendor.
**Full readiness (runtime tests):** All five checks pass.

## Phase 3: COMPLETION CRITERIA

A process is complete when ALL applicable gates pass. Do not shut down until completion is confirmed or the process is explicitly abandoned.

### 3.1 Quality Gates

| Gate | Tool | Pass Criteria |
|------|------|---------------|
| Coding Standards | `ddev exec composer phpcs -- {files}` | Zero errors (warnings OK) |
| Static Analysis | `ddev exec vendor/bin/phpstan analyze --configuration=./core/phpstan.neon.dist {files}` | Zero errors |
| Unit Tests | `ddev phpunit --testsuite unit` | All pass |
| Module Tests | `ddev phpunit core/modules/{module}/tests/` | All pass |
| Coverage | Manual review | New code has tests |

See `/validate-patch` for detailed quality gate procedures.

### 3.2 Completion States

| State | Meaning | Next Action |
|-------|---------|-------------|
| **PASSED** | All quality gates green | Proceed to SHUTDOWN |
| **FAILED** | One or more gates failed | Report failures, iterate (fix_loop < 3) or escalate (fix_loop >= 3) |
| **PARTIAL** | Some gates passed, others not run | Run remaining gates before declaring complete |
| **ABANDONED** | Work stopped before completion | Document reason in narrative, proceed to SHUTDOWN |

### 3.3 Completion Checklist

Before moving to SHUTDOWN:

- [ ] All applicable quality gates passed (or failure documented)
- [ ] Results reported to team-lead (pass/fail with details)
- [ ] Card narrative updated with outcome
- [ ] No uncommitted changes left in worktree (commit or stash)

## Phase 4: SHUTDOWN (Resource Release)

Every DDEV instance that was started MUST be stopped when work is complete. DDEV instances consume memory, CPU, and disk even when idle.

### 4.1 Stop DDEV

```bash
cd "$WORKTREE"
ddev stop
```

This stops containers but preserves the database and configuration. The worktree can be restarted later with `ddev start`.

### 4.2 Verify Shutdown

```bash
# Confirm instance is stopped (JSON output for reliable parsing)
SHUTDOWN_STATUS=$(ddev list --json-output 2>/dev/null | jq -r '.raw[] | select(.name == "drupal-{ISSUE}") | .status')
[ "$SHUTDOWN_STATUS" = "stopped" ] && echo "PASS: stopped" || echo "WARNING: status is $SHUTDOWN_STATUS"
```

### 4.3 Release DDEV Slot

If in sprint context, update the bead:

```bash
bd update <id> --set-metadata ddev=false \
  --append-notes "YYYY-MM-DD: DDEV slot released. (by @<agent>)"
```

### 4.4 Full Cleanup (Optional)

Only when the worktree is no longer needed (issue merged, sprint complete):

```bash
# Remove DDEV project entirely (deletes containers + database)
cd "$WORKTREE"
ddev delete -Oy

# Remove worktree (if issue is fully resolved)
cd .
git worktree remove "worktrees/{ISSUE}"
```

**Do NOT run full cleanup autonomously.** Ask the user before deleting worktrees or DDEV projects. These are irreversible.

### 4.5 When to Shut Down

| Situation | Action |
|-----------|--------|
| Validation passed, card moved to done | `ddev stop` |
| Validation failed, developer will fix | `ddev stop` (developer restarts when ready) |
| Sprint ending, all cards done | `ddev stop` all instances |
| Idle for 30+ minutes with no planned work | `ddev stop` |
| Switching to different worktree and at slot limit | `ddev stop` the finished one first |

## Phase 5: ERROR RECOVERY

Common DDEV errors and how to fix them.

### 5.1 ddev-router Conflict

**Symptom:** `Error response from daemon: removal of container ddev-router is already in progress`

This happens when multiple DDEV instances start/stop simultaneously.

```bash
# Nuclear option: stop everything, then restart what you need
ddev poweroff

# Wait 5 seconds for containers to fully stop
sleep 5

# Restart the instance you need
cd "$WORKTREE"
ddev start
```

### 5.2 Port Conflict

**Symptom:** `port is already allocated` or `address already in use`

```bash
# Find what's using the port
lsof -i :80 2>/dev/null | head -5
lsof -i :443 2>/dev/null | head -5

# If it's another DDEV instance, stop it first
ddev stop --all

# If it's a non-DDEV process, the user needs to resolve it
```

### 5.3 Container Won't Start

**Symptom:** `ddev start` hangs or containers restart in a loop

```bash
# Check container logs
ddev logs

# Restart with fresh state
ddev restart

# If restart fails, delete and recreate
ddev delete -Oy
# Then re-run INIT phase (1.2 onward)
```

### 5.4 Mutagen Sync Issues

**Symptom:** File changes not reflected inside container, or sync stuck

```bash
# Check sync status
ddev mutagen st

# Force resync
ddev mutagen sync

# Nuclear option
ddev mutagen reset
ddev restart
```

### 5.5 Chrome/Webdriver Failures

**Symptom:** FunctionalJavascript tests fail with connection refused

```bash
# Check Chrome status
ddev exec curl -sf http://chrome:4444/status

# Restart just Chrome
ddev restart

# If persistent, check memory (Chrome is memory-hungry)
ddev exec free -m
```

## Phase 6: STUCK DETECTION

A process is stuck when it has been in the same state with no progress for an extended period.

### 6.1 Stuck Indicators

| Indicator | Threshold | Action |
|-----------|-----------|--------|
| DDEV running but no agent activity | 30 minutes | Check if agent crashed, reassign work |
| Card in `validating` with no progress | 20 minutes | Check test output, may be hung browser test |
| Card in `developing` with no commits | 45 minutes | Check if developer is stuck, offer help |
| fix_loop >= 3 | Any | Escalate to user -- fundamental issue |
| DDEV containers restarting in loop | 5 minutes | Run ERROR RECOVERY 5.3 |

### 6.2 Detecting Stuck DDEV Instances

```bash
# List all DDEV instances with status (JSON for reliable parsing)
ddev list --json-output 2>/dev/null | jq -r '.raw[] | "\(.name): \(.status) | \(.shortroot)"'

# Check running instances with details
ddev list --json-output 2>/dev/null | jq -r '.raw[] | select(.status == "running") | "\(.name): running since \(.approot)"'
```

### 6.3 Stuck Recovery

1. Check if the agent is still running (look at task list)
2. If agent crashed: reassign work to new agent, restart DDEV if needed
3. If agent is blocked: identify blocker, create fix task
4. If DDEV is hung: run ERROR RECOVERY, then reassign

## Quick Reference

| Phase | When | Key Command |
|-------|------|-------------|
| INIT | Starting work on a worktree | `ddev start` |
| READY CHECK | Before running any tools | `ddev describe` + checks |
| COMPLETION | After all work done | Check quality gates |
| SHUTDOWN | Work complete or abandoned | `ddev stop` |
| ERROR RECOVERY | Something broke | `ddev poweroff` then `ddev start` |
| STUCK DETECTION | No progress for 20-45 min | `ddev list` + agent check |

## Cross-References

- `/create-worktree` -- Creates the git worktree (prerequisite for INIT)
- `/ddev-drupal-dev` -- Full DDEV command reference for development tools
- `/validate-patch` -- Quality gate procedures (referenced by COMPLETION phase)
- `/sprint-run` -- Sprint coordination, DDEV slot management, board
