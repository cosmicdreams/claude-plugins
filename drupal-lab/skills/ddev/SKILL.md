---
name: ddev
description: Run Drupal development tools (phpcs, phpstan, phpunit, drush, composer) inside DDEV containers. Use when you need to run PHP commands, coding standards checks, static analysis, tests, or drush against a Drupal worktree. Host-side PHP commands will fail -- DDEV provides PHP 8.5, database, Chrome webdriver, and test env vars. Do NOT use for DDEV lifecycle management (start/stop/setup) -- use drupal-lab:process-lifecycle instead.
---

# DDEV for Drupal Core Development

Run all development tools inside DDEV containers where PHP 8.5, MariaDB, Chrome webdriver, and test environment variables are properly configured.

## Why DDEV Instead of Host Commands

Host-side commands (`composer phpcs`, `./vendor/bin/phpunit`) will fail or produce wrong results because:
- Host may not have PHP 8.5
- Kernel/Functional/FunctionalJavaScript tests need database + webserver + Chrome
- Test env vars (SIMPLETEST_DB, MINK_DRIVER_ARGS, etc.) are only configured inside the container
- The `.ddev/core-dev/.env` file configures SQLite test DB and Chrome webdriver

## Prerequisites

DDEV must be started before running any commands.

## Context Awareness
**Important**: Resolve the active project root from `~/.claude/drupal-lab.json` before running any commands. See `drupal-lab/references/project-context.md` for the resolution steps. All relative paths (`./worktrees/...`) are relative to that root. If inside a worktree (`..../worktrees/1234`), `cd ../..` to return to the project root.

### Setting Up DDEV in a Worktree

Follow `/process-lifecycle` skill Phase 1 (INIT) for the full setup procedure. That skill is the single source of truth for:
- Copying `.ddev/` configuration from main
- Creating unique `config.local.yaml` (prevents container conflicts)
- Checking DDEV slot availability (max 3 concurrent)
- Starting DDEV and verifying readiness
- Shutting down when done (Phase 4: SHUTDOWN)

Each worktree runs as an independent DDEV project. Multiple worktrees can run simultaneously with different project names.

### Using an Existing DDEV Instance

To run commands against a different worktree's code from an already-running DDEV (e.g., main):
```bash
cd ./worktrees/main
ddev exec composer phpcs -- --report-full /var/www/html/path/to/file.php
```
Note: this only works for files inside the running DDEV's mounted directory.

## Starting DDEV

```bash
cd ./worktrees/{issue}
ddev start
```

Wait for all containers (web, db, chrome) to report healthy. This takes ~30 seconds.

## Coding Standards (PHPCS)

### Lint all core (slow)
```bash
ddev drupal lint:phpcs
```

### Lint specific files (fast, preferred)
```bash
ddev exec composer phpcs -- path/to/file.php path/to/other.php
```

### Auto-fix coding standard issues
```bash
ddev exec composer phpcbf -- path/to/file.php
```

### Run all linters (phpcs + phpstan + css + js + cspell)
```bash
ddev drupal lint
ddev drupal lint --stop-on-failure
```

## Static Analysis (PHPStan)

PHPStan catches type errors, undefined methods, incorrect return types, and other issues that phpcs does not.

### Analyze all core (slow)
```bash
ddev drupal lint:phpstan
```

### Analyze specific files (fast, preferred)
```bash
ddev exec vendor/bin/phpstan analyze --configuration=./core/phpstan.neon.dist path/to/file.php
```

### Analyze a directory
```bash
ddev exec vendor/bin/phpstan analyze --configuration=./core/phpstan.neon.dist core/modules/settings_tray/src/
```

## PHPUnit Tests

The custom `ddev phpunit` command sources env vars from `core/.env` and clears stale Chrome sessions automatically.

### Run tests for a specific module
```bash
ddev phpunit core/modules/settings_tray/tests
```

### Run tests for a specific file
```bash
ddev phpunit core/modules/settings_tray/tests/src/FunctionalJavascript/SettingsTrayBlockFormTest.php
```

### Run tests by group
```bash
ddev phpunit --group settings_tray
```

### Run only unit tests (fastest)
```bash
ddev phpunit --testsuite unit
```

### Run with filter
```bash
ddev phpunit --filter testMethodName core/modules/settings_tray/tests
```

## Browser Tests

### Switch browser (default: Chrome)
```bash
ddev drupal test:browser chrome
ddev drupal test:browser firefox
```

Watch tests live at:
- Chrome: https://drupal-test.ddev.site:7900 (password: secret)
- Firefox: https://drupal-test.ddev.site:7901 (password: secret)

### Enable test extensions
```bash
ddev drupal test:extensions-enable
```

## Other Commands

### Drush
```bash
ddev drush status
ddev drush cache:rebuild
ddev drush sql:sanitize
```

### Composer
```bash
ddev composer install
ddev composer update
```

### Arbitrary commands
```bash
ddev exec php -v
ddev exec php core/scripts/db-tools.php
```

### Site management
```bash
ddev drupal install demo_umami
ddev drupal cache
ddev drupal admin-login
```

## Troubleshooting

### First step: check container logs

When any command fails unexpectedly, check container logs before debugging further. PHP-FPM segfaults, OOM kills, and Apache errors show up here but not in tool output.

```bash
# Web container logs (PHP-FPM + Apache) — last 50 lines
ddev logs | tail -50

# Database container logs
ddev logs -s db | tail -30

# Follow logs in real-time (useful during long test runs)
ddev logs -f
```

### Common errors

**Error: "Container not running"**
```bash
ddev start
```

**Error: "phpunit is not in PATH"**
```bash
ddev composer install
```

**Stale Chrome sessions causing test failures**
The `ddev phpunit` command auto-clears these, but manually:
```bash
ddev exec curl -f -s http://chrome:4444/status
```

**Tests fail with "connection refused"**
Ensure Chrome container is running:
```bash
ddev describe --json-output 2>/dev/null | jq '.raw.status'
```
If not running, restart:
```bash
ddev restart
```

**Cryptic test failure (blank output, segfault, timeout)**
Check container logs first — the root cause is usually visible there:
```bash
ddev logs | tail -50
```

| Log Pattern | Meaning | Action |
|------------|---------|--------|
| `Killed` or `oom-kill` | Container out of memory | Reduce test scope, run sequentially |
| `Segmentation fault` | PHP crash | `ddev restart`, retry |
| `No space left on device` | Docker disk full | `docker system prune`, retry |

## Environment Details

| Component | Value |
|-----------|-------|
| PHP | 8.5 |
| Database | MariaDB 10.11 |
| Test DB | SQLite (sites/default/files/db.sqlite) |
| Webdriver | Chrome at chrome:4444 |
| Base URL | http://web (internal) |
| Site URL | https://drupal-test.ddev.site |
| Perf mode | Mutagen |
| Node.js | 24 |

## Profiling

For PHP performance profiling (xhprof, slow query log), see `drupal-lab:perf-measure`.
For frontend performance (Lighthouse, Core Web Vitals), see `improve:perf-measure`.
