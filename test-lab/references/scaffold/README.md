# Scaffold

The minimum shape of a suite that meets `../methodology.md`. Copy and adapt;
these are trimmed from a working Drupal suite, not invented for the document.

```
tests/e2e/
  components/          one class per reusable region
  pages/               one class per page kind; composes components
  fixtures/
    base.fixture.ts    the entry point specs import from
  support/
    auth.ts            session capture, if authenticated coverage exists
  slices/              specs, grouped by area
  TAGS.md              every tag, why it exists, and its unlock signal
  COVERAGE-GAPS.md     what is deliberately uncovered, and what would change it
  global-setup.ts      captures sessions; a no-op against shared environments
  global-teardown.ts   sweeps orphaned test content
```
