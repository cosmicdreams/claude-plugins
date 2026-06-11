---
name: validate-patch
description: Validate a Drupal patch or merge request against all quality gates. Use when asked to validate, test, review, or check a patch before submission -- e.g. "validate my patch", "run the quality gates", "check this MR", "is this patch ready to submit". Runs phpcs, phpstan, phpunit, and coverage review via DDEV. Do NOT use for browsing issues or analyzing issue context -- use drupal-lab:analyze-issue instead.
---

# Validate Patch

Run all quality gates on a Drupal implementation in a worktree using DDEV.

All phpcs/phpstan/phpunit commands run inside DDEV containers. See `drupal-lab:ddev` for the
full command reference.

## Input

- Worktree path (e.g., `worktrees/2901667`)
- Optional: specific files to validate (defaults to all changed files)

Resolve project root from `~/.claude/drupal-lab.json`. See `drupal-lab/references/project-context.md`.

## Prerequisites

DDEV must be running. Follow `drupal-lab:process-lifecycle` to bootstrap and verify the
environment. Check readiness:

```bash
cd ./worktrees/{issue_number}
STATUS=$(ddev describe --json-output 2>/dev/null | jq -r '.raw.status')
[ "$STATUS" = "running" ] && echo "READY" || echo "Run: ddev start (status: $STATUS)"
```

---

## Phase 0: Test Design Review (BEFORE DDEV)

**Purpose**: Catch test design issues statically before spinning up DDEV. This phase runs
without infrastructure and prevents the most common validation failures (50% of failures in
session 2026-02-16 were test design, not code regression).

**Time**: 5–10 minutes. No DDEV required.

### 0.1 Identify Changed Test Files

```bash
cd ./worktrees/{issue_number}
git diff --name-only main -- '*.php' | grep -i test
```

If no test files changed, skip to Phase 0.5 then proceed to the workflow.

### 0.2 Test Class Inheritance Check

Review the base class of each changed test. Common pitfalls:

| Base Class | Risk | What to Check |
|-----------|------|---------------|
| `OffCanvasTestBase` | Auto-asserts contextual links module is loaded and functional | Ensure contextual links are not removed/broken by the patch |
| `BrowserTestBase` | Full Drupal bootstrap, may assume modules enabled | Check `$modules` property matches patch expectations |
| `WebDriverTestBase` | JavaScript execution, async timing | Check `waitForAjaxToFinish()` and `assertSession()` calls |
| `KernelTestBase` | Service container assumptions | Verify services referenced in test still exist after patch |
| `UnitTestCase` | No Drupal bootstrap | Ensure no `\Drupal::` calls in test or tested code |

Read each test file, then use LSP to trace the inheritance chain:

```
LSP(operation: "goToDefinition", filePath: "path/to/TestFile.php", line: <extends-line>, character: <class-name-col>)
LSP(operation: "documentSymbol", filePath: "path/to/BaseClass.php", line: 1, character: 1)
LSP(operation: "hover", filePath: "path/to/BaseClass.php", line: <method-line>, character: <method-col>)
```

Fall back to grep if LSP is unavailable:
```bash
grep -n 'extends\s' path/to/TestFile.php
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

Flag any assertions matching these patterns. Propose fixes before running tests.

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
- [ ] No new public methods without test coverage — use `LSP documentSymbol` on changed files to list all public methods, then `LSP findReferences` to check if tests call them
- [ ] Changed module `.info.yml` dependencies match test `$modules` arrays
- [ ] If JS/CSS changed, FunctionalJavascript tests exist for the module
- [ ] Use `LSP findReferences` on changed methods to identify downstream code that may need additional test coverage

### Phase 0 Result

**Pass (proceed to DDEV validation):**
- No inheritance conflicts found
- No brittle assertions detected
- Test setup matches patch expectations
- Report: `phase0 pass | inheritance: ok | assertions: ok | setup: ok`

**Fail (fix before DDEV):**
- Document each issue found
- Propose specific fixes
- Send fixes to developer before spinning up DDEV
- Report: `phase0 fail | [issue list] | fixes proposed`

**Expected Impact**: Catching these issues saves 20–30 min of DDEV spin-up, test execution,
debugging, and re-testing per failure. Target: 80%+ first-pass validation rate (baseline: 56%).

---

## Workflow

### 1. Identify Changed Files

```bash
cd ./worktrees/{issue_number}
git diff --name-only main
```

### 2. Coding Standards (PHPCS)

```bash
ddev exec composer phpcs -- path/to/changed/file1.php path/to/changed/file2.php
```

Pass criteria: zero errors. Warnings are acceptable.

Auto-fix:
```bash
ddev exec composer phpcbf -- path/to/file.php
```

For verbose output, rtk proxying is optional:
```bash
command -v rtk >/dev/null && rtk ddev exec composer phpcs -- <files> || ddev exec composer phpcs -- <files>
```

### 3. Static Analysis (PHPStan)

```bash
ddev exec vendor/bin/phpstan analyze --configuration=./core/phpstan.neon.dist path/to/changed/file1.php path/to/changed/file2.php
```

Pass criteria: zero errors.

### 3.5 Snapshot Before Tests

```bash
ddev snapshot --name=pre-test
```

Restore before a retry: `ddev snapshot restore pre-test`

### 4. PHPUnit Tests

```bash
ddev phpunit core/modules/{module}/tests/
```

By group: `ddev phpunit --group settings_tray`

Functional and FunctionalJavascript tests:
```bash
ddev exec -d /var/www/html env \
  SIMPLETEST_BASE_URL="http://drupal-{ISSUE}.ddev.site" \
  SIMPLETEST_DB="sqlite://localhost/sites/default/files/.ht.sqlite" \
  vendor/bin/phpunit core/modules/{module}/tests/src/FunctionalJavascript/
```

### 4.5 On Test Failure: Check Container Logs

```bash
ddev logs | tail -50
ddev logs -s db | tail -30
```

Common container-level failures:

| Log Pattern | Meaning | Action |
|------------|---------|--------|
| `Killed` or `oom-kill` | Container ran out of memory | Reduce test scope, run suites sequentially |
| `Segmentation fault` | PHP crash (often opcache or extension) | `ddev restart`, retry |
| `Connection refused` on :4444 | Chrome webdriver died | `ddev restart`, retry |
| `No space left on device` | Docker disk full | `docker system prune`, then retry |

After diagnosing, restore the snapshot before retrying: `ddev snapshot restore pre-test`

### 5. Test Coverage Check

Verify new code has corresponding test coverage and existing tests still pass.

### 6. Report Results

Pass: `val pass | phpcs: ok | phpstan: ok | phpunit: ok | cov: ok`

Fail: `val fail | phpcs: 3 errors (file.php:45,67,89) | needs fix`

## Quality Gates Summary

| Gate | Tool | Pass Criteria |
|------|------|---------------|
| Coding Standards | `ddev exec composer phpcs` | Zero errors |
| Static Analysis | `ddev exec vendor/bin/phpstan analyze` | Zero errors |
| Unit Tests | `ddev phpunit --testsuite unit` | All pass |
| Module Tests | `ddev phpunit core/modules/{module}/tests/` | All pass |
| Coverage | Manual review | New code covered |
