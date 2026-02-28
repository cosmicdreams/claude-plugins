---
name: ddev-drupal-dev
description: Run Drupal core development tools via DDEV containers. Use when running phpcs, phpunit, drush, or any PHP/testing commands against a Drupal worktree. Provides the correct PHP 8.5 environment, database, Chrome webdriver, and test configuration that host-side commands lack.
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
**Important**: All relative paths (e.g. `./worktrees/...`) assume you are executing from the **Project Root** (e.g. `~/OpenSource/SAME_PAGE_PREVIEW`).
- The Project Root is the folder that *contains* the `worktrees/` and `kanban/` directories.
- If you are inside a worktree (e.g. `.../worktrees/1234`), you must `cd ../..` to return to the Project Root before running commands.

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
ddev describe
```
If chrome shows "stopped", restart:
```bash
ddev restart
```

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
