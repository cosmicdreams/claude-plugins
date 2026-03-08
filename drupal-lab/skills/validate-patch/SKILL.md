---
name: validate-patch
description: Validate a Drupal patch or merge request against all quality gates. Use when asked to validate, test, review, or check a patch before submission -- e.g. "validate my patch", "run the quality gates", "check this MR", "is this patch ready to submit". Runs phpcs, phpstan, phpunit, and coverage review via DDEV. Do NOT use for browsing issues or analyzing issue context -- use drupal-lab:analyze-issue instead.
---

# Validate Patch

Run all quality gates on a Drupal implementation in a worktree using DDEV.

**Important**: All phpcs/phpstan/phpunit commands must run inside DDEV containers. See `/ddev-drupal-dev` skill for full DDEV reference.

## Input

- Worktree path (e.g., `worktrees/2901667`)
- Optional: specific files to validate (defaults to all changed files)

## Context Awareness
**Important**: All relative paths (e.g. `./worktrees/...`) assume you are executing from the **Project Root** (e.g. `~/OpenSource/SAME_PAGE_PREVIEW`).
- The Project Root is the folder that *contains* the `worktrees/` and `kanban/` directories.
- If you are inside a worktree (e.g. `.../worktrees/1234`), you must `cd ../..` to return to the Project Root before running commands.

## Prerequisites

DDEV must be set up and running in the worktree. Follow `/process-lifecycle` skill Phase 1 (INIT) and Phase 2 (READY CHECK) to bootstrap the environment. That skill handles DDEV setup, unique naming, slot management, and health verification.

If DDEV is already running, verify readiness:
```bash
cd ./worktrees/{issue_number}
ddev describe | grep -q "running" && echo "READY" || echo "Run: ddev start"
```

When validation is complete, follow `/process-lifecycle` Phase 4 (SHUTDOWN) to release the DDEV slot.

## Phase 0: Test Design Review (BEFORE DDEV)

**Purpose**: Catch test design issues statically before spinning up DDEV. This phase runs without infrastructure and prevents the most common validation failures (50% of failures in session 2026-02-16 were test design, not code regression).

**Time**: 5-10 minutes. **No DDEV required.**

### 0.1 Identify Changed Test Files

```bash
cd ./worktrees/{issue_number}
git diff --name-only main -- '*.php' | grep -i test
```

If no test files changed, skip to Phase 0.5 (quick sanity check on non-test changes) then proceed to Workflow step 1.

### 0.2 Test Class Inheritance Check

Review the base class of each changed test. Common pitfalls:

| Base Class | Risk | What to Check |
|-----------|------|---------------|
| `OffCanvasTestBase` | Auto-asserts contextual links module is loaded and functional | Ensure contextual links are not removed/broken by the patch |
| `BrowserTestBase` | Full Drupal bootstrap, may assume modules enabled | Check `$modules` property matches patch expectations |
| `WebDriverTestBase` | JavaScript execution, async timing | Check `waitForAjaxToFinish()` and `assertSession()` calls |
| `KernelTestBase` | Service container assumptions | Verify services referenced in test still exist after patch |
| `UnitTestCase` | No Drupal bootstrap | Ensure no `\Drupal::` calls in test or tested code |

**Action**: Read each test's parent class. Search for inherited `setUp()`, `tearDown()`, and assertion methods that may conflict with the patch.

```bash
# Find the base class
grep -n 'extends\s' path/to/TestFile.php

# Check what the base class setUp does
grep -n 'function setUp\|function tearDown\|function assert' path/to/BaseClass.php
```

### 0.3 Assertion Brittleness Check

Review all assertions in changed tests for patterns that break under normal Drupal behavior:

| Pattern | Problem | Fix |
|---------|---------|-----|
| `assertEquals('/user', $url)` | Drupal redirects `/user` to `/user/{uid}` | Use `assertStringContainsString('/user')` or `assertMatchesRegularExpression` |
| `assertEquals('http://...', $url)` | Hardcoded base URL breaks across environments | Assert path component only |
| `assertCount(N, $elements)` | Exact count brittle if other modules add elements | Assert `>= N` or use more specific selectors |
| `assertText('exact string')` | Text may change with locale or markup updates | Use partial match or CSS selector |
| `$this->drupalGet('/admin/...')` then assert 200 | Assumes admin user has permission | Verify test user has required permissions |
| `waitForElement('.class', 5000)` | Hardcoded timeout too short for CI | Use `$this->assertSession()->waitForElementVisible()` with reasonable timeout |

**Action**: Flag any assertions matching these patterns. Propose fixes BEFORE running tests.

### 0.4 Test Setup Dependencies Check

Verify tests don't assume state that the patch may alter:

- [ ] **Module dependencies**: Does `$modules` array include everything the test needs?
- [ ] **Configuration assumptions**: Does `setUp()` load config that the patch modifies?
- [ ] **Database fixtures**: Are test fixtures compatible with schema changes in the patch?
- [ ] **JavaScript library assumptions**: If patch changes JS libraries (e.g., removing jQuery), do tests still load required libraries?
- [ ] **Permission assumptions**: Do test users have permissions for the functionality being tested?

### 0.5 Quick Sanity Check (Non-Test Changes)

Even if no test files changed, verify:

- [ ] Changed PHP files have corresponding test coverage (check `tests/` sibling directory)
- [ ] No new public methods without test coverage
- [ ] Changed module `.info.yml` dependencies match test `$modules` arrays
- [ ] If JS/CSS changed, FunctionalJavascript tests exist for the module

### Phase 0 Result

**Pass (proceed to DDEV validation):**
- No inheritance conflicts found
- No brittle assertions detected
- Test setup matches patch expectations
- Report: `phase0 pass | inheritance: ok | assertions: ok | setup: ok`

**Fail (fix before DDEV):**
- Document each issue found
- Propose specific fixes
- Send fixes to developer BEFORE spinning up DDEV
- Report: `phase0 fail | [issue list] | fixes proposed`

**Expected Impact**: Catching these issues saves 20-30 min of DDEV spin-up, test execution, debugging, and re-testing per failure. Target: 80%+ first-pass validation rate (baseline: 56%).

---

## Workflow

### 1. Identify Changed Files

```bash
cd ./worktrees/{issue_number}
git diff --name-only main
```

### 2. Coding Standards (PHPCS)

From the worktree with DDEV running:
```bash
cd ./worktrees/{issue_number}
ddev exec composer phpcs -- path/to/changed/file1.php path/to/changed/file2.php
```

**Pass criteria**: Zero errors. Warnings are acceptable.

To auto-fix:
```bash
ddev exec composer phpcbf -- path/to/file.php
```

### 3. Static Analysis (PHPStan)

Run phpstan on changed files to catch type errors and incorrect API usage:
```bash
cd ./worktrees/{issue_number}
ddev exec vendor/bin/phpstan analyze --configuration=./core/phpstan.neon.dist path/to/changed/file1.php path/to/changed/file2.php
```

**Pass criteria**: Zero errors.

### 4. PHPUnit Tests

Unit and Kernel tests (no browser required):
```bash
cd ./worktrees/main
ddev phpunit core/modules/{module}/tests/
```

By group:
```bash
ddev phpunit --group settings_tray
```

Functional and FunctionalJavascript tests require `SIMPLETEST_BASE_URL` and `SIMPLETEST_DB`. Use `ddev exec` to set them:
```bash
ddev exec -d /var/www/html env \
  SIMPLETEST_BASE_URL="http://drupal-{ISSUE}.ddev.site" \
  SIMPLETEST_DB="sqlite://localhost/sites/default/files/.ht.sqlite" \
  vendor/bin/phpunit core/modules/{module}/tests/src/FunctionalJavascript/
```

Replace `{ISSUE}` with the worktree DDEV instance name (e.g. `drupal-3274086`).

By specific test file:
```bash
ddev exec -d /var/www/html env \
  SIMPLETEST_BASE_URL="http://drupal-{ISSUE}.ddev.site" \
  SIMPLETEST_DB="sqlite://localhost/sites/default/files/.ht.sqlite" \
  vendor/bin/phpunit core/modules/settings_tray/tests/src/FunctionalJavascript/SettingsTrayBlockFormTest.php
```

### 5. Test Coverage Check

Verify that:
- New code has corresponding test coverage
- Existing tests still pass
- No regressions introduced

### 6. Report Results

Use team-comms-protocol format:

**Pass:**
```
val pass | phpcs: ok | phpstan: ok | phpunit: ok | cov: ok
```

**Fail:**
```
val fail | phpcs: 3 errors (file.php:45,67,89) | needs fix
```

## Quality Gates Summary

| Gate | Tool | Pass Criteria |
|------|------|---------------|
| Coding Standards | `ddev exec composer phpcs` | Zero errors |
| Static Analysis | `ddev exec vendor/bin/phpstan analyze` | Zero errors |
| Unit Tests | `ddev phpunit --testsuite unit` | All pass |
| Module Tests | `ddev phpunit core/modules/{module}/tests/` | All pass |
| Coverage | Manual review | New code covered |

## Common Issues

- **PHPCS line length**: Max 80 chars for comments, exceptions for code
- **Missing use statements**: PHPCS will flag unused or missing imports
- **Test method naming**: Must start with `test` prefix
- **Namespace issues**: PSR-4 autoloading must match directory structure
- **Container not running**: Run `ddev start` from a worktree with `.ddev/`
- **phpunit not found**: Run `ddev composer install` first
