# Scaffold

The minimum shape of a suite that meets `../methodology.md`. Copy the whole
directory to `tests/e2e/` and adapt; every import here is relative and resolves
as-is once it lands there, so the tree below is the tree you get rather than a
diagram of one.

Trimmed from a working Drupal suite, not invented for the document. The Drupal
parts — `factories/drush.ts`, the `.ddev.site` check in the fixture, the login
link in `global-setup.ts` — are the worked example. Replace those three; keep
everything around them.

```
tests/e2e/
  components/
    ExampleComponent.ts    one class per reusable region; locators readonly
  pages/
    ExamplePage.ts         one class per page kind; composes components
  fixtures/
    base.fixture.ts        the entry point specs import from
  factories/
    drush.ts               the environment adapter: escaping, destructive guard
    content.ts             typed handles with cleanup(); one per content type
  slices/
    C447371-example-navigation.spec.ts   specs, grouped by area
  support/
    check-tags.mjs         fails the build on a tag defined and never applied
  TAGS.md                  every tag in use, why, and its unlock signal
  COVERAGE-GAPS.md         what is deliberately uncovered, and what would change it
  global-setup.ts          captures sessions; a no-op against shared environments
  global-teardown.ts       sweeps orphaned test content
```

## Wire it up

In `playwright.config.ts`:

```ts
globalSetup: './tests/e2e/global-setup.ts',
globalTeardown: './tests/e2e/global-teardown.ts',
```

In whatever gate runs lint, alongside it rather than instead of it:

```bash
node tests/e2e/support/check-tags.mjs
```

That last line is not optional. A tag defined and never applied was one of the
two defects found in the review this standard came from, and it is the one that
prose cannot prevent — an author under deadline documents the tag and forgets
the specs. The script is three seconds and removes the failure mode.

## What each file is demonstrating

| File | The rule it exists to show |
|---|---|
| `components/ExampleComponent.ts` | `readonly` locators assigned in the constructor; role and accessible name first, an authored hook second, a theme class only as a commented compromise |
| `pages/ExamplePage.ts` | components composed inside pages; site-wide chrome on the base page |
| `fixtures/base.fixture.ts` | authenticated pages exposed as fixtures, never arranged by a spec; locality decided on a parsed hostname |
| `factories/drush.ts` | one central adapter; escaping for every interpolated value; a guard that refuses an unnarrowed destructive command |
| `factories/content.ts` | typed handles carrying their own `cleanup()`, not bare ids |
| `slices/C447371-*.spec.ts` | the case identifier in filename and title; `test.step()` throughout; tags actually applied; no `waitForTimeout()` |
| `global-teardown.ts` | the orphan sweep for content whose test died before its cleanup ran |
| `support/check-tags.mjs` | the tag rule, enforced rather than described |
