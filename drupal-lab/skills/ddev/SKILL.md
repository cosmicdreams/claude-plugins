---
name: ddev
description: Run Drupal development tools (phpcs, phpstan, phpunit, drush, composer) inside DDEV containers. Use when you need to run PHP commands, coding standards checks, static analysis, tests, or drush against a Drupal worktree. Host-side PHP commands will fail -- DDEV provides PHP 8.5, database, Chrome webdriver, and test env vars. Do NOT use for DDEV lifecycle management (start/stop/setup) -- use drupal-lab:process-lifecycle instead.
---

# DDEV for Drupal Core Development

Run all development tools inside DDEV containers where PHP 8.5, MariaDB, Chrome webdriver,
and test environment variables are properly configured.

For general DDEV knowledge (lifecycle, database operations, troubleshooting, worktree isolation,
providers), see `lib:ddev`. This skill covers Drupal-specific commands only.

## Why DDEV Instead of Host Commands

Host-side commands (`composer phpcs`, `./vendor/bin/phpunit`) will fail or produce wrong results:
- Host may not have PHP 8.5
- Kernel/Functional/FunctionalJavaScript tests need database, webserver, and Chrome
- Test env vars (`SIMPLETEST_DB`, `MINK_DRIVER_ARGS`, etc.) are only configured inside the container
- The `.ddev/core-dev/.env` file configures SQLite test DB and Chrome webdriver

## Environment Details

| Component | Value |
|-----------|-------|
| PHP | 8.5 |
| Database | MariaDB 10.11 |
| Test DB | SQLite (`sites/default/files/db.sqlite`) |
| Webdriver | Chrome at `chrome:4444` |
| Base URL | `http://web` (internal) |
| Site URL | `https://drupal-test.ddev.site` |
| Perf mode | Mutagen |
| Node.js | 24 |

## Environment Variables (Container)

These are set automatically inside the DDEV container and required for functional tests:

| Variable | Value |
|----------|-------|
| `SIMPLETEST_DB` | `sqlite://localhost/sites/default/files/.ht.sqlite` |
| `SIMPLETEST_BASE_URL` | `http://drupal-{ISSUE}.ddev.site` |
| `MINK_DRIVER_ARGS` | `["chrome", {"browserName":"chrome","goog:chromeOptions":{"args":["--disable-gpu","--headless","--no-sandbox","--disable-dev-shm-usage"]}},"http://chrome:4444/wd/hub"]` |
| `MINK_DRIVER_CLASS` | `Drupal\FunctionalJavascriptTests\DrupalSelenium2Driver` |

The `ddev phpunit` command sources these from `core/.env` automatically. Use `ddev exec -d
/var/www/html env SIMPLETEST_BASE_URL=... SIMPLETEST_DB=... vendor/bin/phpunit ...` only when
running phpunit directly (outside the `ddev phpunit` wrapper).

## Per-Worktree Naming

Each worktree requires a unique DDEV project name in `.ddev/config.local.yaml`:

```yaml
name: drupal-{ISSUE}
```

This prevents container namespace conflicts across parallel worktrees. The DDEV project name
determines the site URL (`drupal-3274086.ddev.site`). Never skip this file.

## DDEV Slot Management

Max 3 concurrent DDEV instances per sprint. Track slot usage via beads metadata:

- When starting DDEV for an issue: `bd update <id> --set-metadata ddev=true`
- When stopping DDEV: `bd update <id> --set-metadata ddev=false`

Stale-slot reclaim: check for beads with `ddev=true` metadata; if the issue is closed or
the bead is stale (no activity in the last session), the slot can be reclaimed — stop DDEV
in that worktree and clear the metadata flag.

```bash
# Check running DDEV instances
ddev list --json-output 2>/dev/null | jq -r '.raw[] | select(.status == "running") | .name'
```

## Coding Standards (PHPCS)

```bash
# All core (slow)
ddev drupal lint:phpcs

# Specific files (fast, preferred)
ddev exec composer phpcs -- path/to/file.php path/to/other.php

# Auto-fix
ddev exec composer phpcbf -- path/to/file.php

# All linters (phpcs + phpstan + css + js + cspell)
ddev drupal lint
ddev drupal lint --stop-on-failure
```

Optional rtk proxying for verbose output inside scripts or worker agents:
```bash
command -v rtk >/dev/null && rtk ddev exec composer phpcs -- <files> || ddev exec composer phpcs -- <files>
```

## Static Analysis (PHPStan)

```bash
# All core (slow)
ddev drupal lint:phpstan

# Specific files (fast, preferred)
ddev exec vendor/bin/phpstan analyze --configuration=./core/phpstan.neon.dist path/to/file.php

# A directory
ddev exec vendor/bin/phpstan analyze --configuration=./core/phpstan.neon.dist core/modules/settings_tray/src/
```

## PHPUnit Tests

The custom `ddev phpunit` command sources env vars from `core/.env` and clears stale Chrome
sessions automatically.

```bash
# Module tests
ddev phpunit core/modules/settings_tray/tests

# Specific file
ddev phpunit core/modules/settings_tray/tests/src/FunctionalJavascript/SettingsTrayBlockFormTest.php

# By group
ddev phpunit --group settings_tray

# Unit tests only (fastest)
ddev phpunit --testsuite unit

# With filter
ddev phpunit --filter testMethodName core/modules/settings_tray/tests
```

## Browser Tests

```bash
# Switch browser (default: Chrome)
ddev drupal test:browser chrome
ddev drupal test:browser firefox
```

Watch tests live at:
- Chrome: `https://drupal-test.ddev.site:7900` (password: secret)
- Firefox: `https://drupal-test.ddev.site:7901` (password: secret)

```bash
# Enable test extensions
ddev drupal test:extensions-enable
```

## Other Commands

```bash
ddev drush status
ddev drush cache:rebuild
ddev drush sql:sanitize
ddev composer install
ddev composer update
ddev exec php -v
ddev drupal install demo_umami
ddev drupal cache
ddev drupal admin-login
```

## Troubleshooting

For general DDEV troubleshooting (container logs, Mutagen, port conflicts), see `lib:ddev`.

**`phpunit not in PATH`**: `ddev composer install`

**Stale Chrome sessions causing test failures**: `ddev phpunit` auto-clears these. Manual check:
```bash
ddev exec curl -f -s http://chrome:4444/status
```

**Tests fail with connection refused**: Chrome container check:
```bash
ddev describe --json-output 2>/dev/null | jq '.raw.status'
```

**Cryptic failure (blank output, segfault, timeout)**: Check container logs first:
```bash
ddev logs | tail -50
```

## Profiling

For PHP performance profiling (xhprof, slow query log), see `drupal-lab:perf-measure`.
For frontend performance (Lighthouse, Core Web Vitals), see `improve:perf-measure`.
