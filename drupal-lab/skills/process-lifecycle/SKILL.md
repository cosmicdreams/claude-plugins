---
name: process-lifecycle
description: Manage the DDEV lifecycle for Drupal worktrees -- start, ready-check, completion, and shutdown. Use when setting up DDEV in a worktree, checking environment readiness, deciding whether to stop DDEV, or cleaning up after work -- e.g. "start DDEV for this worktree", "is my environment ready", "shut down DDEV", "clean up the worktree". Do NOT use for running dev tools inside DDEV -- use drupal-lab:ddev instead.
---

# Process Lifecycle

DDEV setup, readiness, and shutdown for Drupal worktrees. For general DDEV commands (start,
stop, restart, import-db, troubleshooting), see `lib:ddev`.

Resolve project root from `~/.claude/drupal-lab.json`. See `drupal-lab/references/project-context.md`.

## INIT — Environment Bootstrap

Prerequisite: worktree must exist (use `admin:create-worktree` if needed).

### Verify Worktree

```bash
WORKTREE="./worktrees/{ISSUE}"
test -d "$WORKTREE" || echo "ERROR: worktree does not exist."
git -C "$WORKTREE" rev-parse --is-inside-work-tree
```

### Set Up DDEV

```bash
if [ ! -d "$WORKTREE/.ddev" ]; then
  cp -r ./worktrees/main/.ddev "$WORKTREE/"
  printf 'name: drupal-{ISSUE}\n' > "$WORKTREE/.ddev/config.local.yaml"
fi
```

Each worktree needs a unique `name` in `config.local.yaml` or DDEV instances conflict. The
name drives the site URL (`drupal-{ISSUE}.ddev.site`).

### Check Slot Availability

Max 3 concurrent DDEV instances. Check beads for items with `ddev=true` metadata before
starting. If three slots are occupied, either wait or reclaim a stale slot (closed issue
or no recent activity).

```bash
RUNNING=$(ddev list --json-output 2>/dev/null | jq '[.raw[] | select(.status == "running")] | length')
echo "DDEV slots running: $RUNNING / 3"
```

### Start DDEV

```bash
cd "$WORKTREE"
ddev start 2>&1 | tee /tmp/ddev-{ISSUE}.log
ddev composer install
```

Record slot usage: `bd update <id> --set-metadata ddev=true`

### Post-Start Setup

```bash
test -f "$WORKTREE/.claude/ddev-setup.md" && cat "$WORKTREE/.claude/ddev-setup.md"
```

If the file exists, follow it — it specifies which environment to pull the database from,
which drush commands to run after import, and any settings overrides. If absent and a
database is required, ask the user for the post-start steps. A fresh worktree has no
database — skipping this causes 500 errors and misleading test failures.

## READY CHECK — Gate Before Work

```bash
cd "$WORKTREE"

# Containers running
STATUS=$(ddev describe --json-output 2>/dev/null | jq -r '.raw.status')
[ "$STATUS" = "running" ] && echo "PASS: containers" || echo "FAIL: status=$STATUS"

# PHP version
ddev exec php -v | head -1   # expect PHP 8.5.x

# Database accessible
ddev exec drush sql:query "SELECT 1" 2>/dev/null && echo "PASS: db" || echo "INFO: no db (ok for phpcs/phpstan-only)"

# Chrome webdriver
ddev exec curl -sf http://chrome:4444/status | grep -q '"ready":true' && echo "PASS: chrome" || echo "INFO: chrome not ready (ok for non-browser tests)"

# Vendor dependencies
ddev exec test -f vendor/autoload.php && echo "PASS: vendor" || echo "FAIL: run ddev composer install"
```

| Check | Required For |
|-------|-------------|
| Containers + PHP + Vendor | All work, static analysis |
| Database | Kernel/Functional tests |
| Chrome | FunctionalJavascript tests |

## SHUTDOWN — Resource Release

Stop DDEV when: all gates pass, validation failed (developer restarts when ready), sprint
ending, idle 30+ minutes, or switching worktrees at slot limit.

```bash
cd "$WORKTREE"
ddev stop
```

Release slot: `bd update <id> --set-metadata ddev=false`

Verify:
```bash
SHUTDOWN_STATUS=$(ddev list --json-output 2>/dev/null | jq -r '.raw[] | select(.name == "drupal-{ISSUE}") | .status')
[ "$SHUTDOWN_STATUS" = "stopped" ] && echo "PASS: stopped" || echo "WARNING: $SHUTDOWN_STATUS"
```

Full cleanup (only when worktree is no longer needed — irreversible):
```bash
cd "$WORKTREE" && ddev delete -Oy
git worktree remove "worktrees/{ISSUE}"
```

Ask the user before deleting worktrees or DDEV projects.

## Error Recovery

### ddev-router Conflict

```bash
ddev poweroff
# wait ~5 seconds
cd "$WORKTREE" && ddev start
```

### Port Conflict

```bash
lsof -i :80 2>/dev/null | head -5
ddev stop --all
```

### Container Won't Start

```bash
ddev logs
ddev restart
# If restart fails:
ddev delete -Oy  # then re-run INIT
```

### Mutagen Sync Issues

```bash
ddev mutagen st
ddev mutagen sync
# Nuclear: ddev mutagen reset && ddev restart
```

### Chrome/Webdriver Failures

```bash
ddev exec curl -sf http://chrome:4444/status
ddev restart
# If persistent — Chrome is memory-hungry; check: ddev exec free -m
```

## Cross-References

- `lib:ddev` — General DDEV knowledge
- `admin:create-worktree` — Creates the git worktree
- `drupal-lab:ddev` — Drupal-specific DDEV commands
- `drupal-lab:validate-patch` — Quality gate procedures
