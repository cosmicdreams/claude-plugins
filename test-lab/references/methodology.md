# Playwright authoring standard

Derived from a Velir head of Quality Assurance review of a real Drupal suite,
May 2026. Everything here was either praised as worth keeping as a template, or
named as a defect in a suite that otherwise passed review.

Cite this when a reviewer asks why the suite is shaped the way it is.

## Page Object Model

The structure is not optional and not cosmetic — it is the first thing a
reviewer looks for.

- **Locators are `readonly` properties assigned in the constructor.** Not
  getters, not inline in the test body, not built on demand.
- **Components are composed inside pages.** A page object holds its components
  as properties; a spec reaches the component through the page, not
  independently.
- Site-wide chrome — header, footer — belongs on the base page, so a spec can
  assert on it without knowing which page object it holds.
- Behaviour that reads several properties at once belongs on the object as a
  method, not spread across the spec. A spec should read as intent.

```ts
export class GlobalFooterComponent {
  readonly root: Locator;
  readonly socialLinks: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('footer, .footer').first();
    this.socialLinks = page.locator('.footer__social a');
  }

  async socialLinkHrefs(): Promise<string[]> {
    return this.socialLinks.evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href));
  }
}
```

## Fixtures

A `base.fixture.ts` re-exports `test` and `expect`, and exposes page objects
already built. Specs import from it rather than from `@playwright/test`.

**Authenticated pages are exposed as fixtures.** A spec never logs in itself.
The fixture builds a context from a stored session, hands over a page object,
and closes the context afterwards so a session cannot leak into an anonymous
test.

## Factories

The strongest part of a mature suite, and the usual thing missing from a young
one. A spec that depends on content a person created is a spec that breaks when
that person edits it.

- Factories return a **typed handle with a `cleanup()` callback**, not a bare id.
- **Escape everything interpolated into a shell or a language you are
  generating.** A helper equivalent to `phpString()` is required wherever test
  data reaches PHP. Without it a title containing an apostrophe produces a
  silent error in the generated code instead of a test failure — the worst
  possible outcome, because the suite goes green.
- **Guard destructive commands.** A `drush()` wrapper must refuse no-argument
  invocations of destructive verbs. This was called out explicitly as good
  practice, not paranoia.
- A **global teardown sweeps orphans** — content whose test died before its
  cleanup ran.

## Discipline

- `test.step()` throughout. It is what makes a failure report readable.
- **Zero `waitForTimeout()`.** Use web-first assertions, `expect.poll` for
  values that settle, and explicit state assertions. A fixed sleep is a defect
  even when it passes.
- Watch for transitions. Reading a computed transform immediately after a click
  catches it mid-animation; poll until settled.

## Tags

Two documents, both required, and the second is the one that gets forgotten:

- `TAGS.md` defines every tag and **why it exists**.
- The tags are **actually applied**. Defining a tag and never using it was one
  of the two defects found in review: cloud-dependent specs failed on generic
  timeouts with no clean way to exclude them, because the tag that would have
  excluded them was documented and unused.

Tags worth having from the start:

| Tag | For |
|---|---|
| `@smoke` | structural health that should hold on every environment |
| `@regression` | guards a specific shipped fix, named in the test title |
| `@slow` | depends on a service that is slow or remote |
| `@local` | needs a local environment, typically for authentication |
| `@fixture-page` | depends on specific authored content existing |

Record **unlock signals**: the condition under which a tag stops being needed.
`@fixture-page` disappears when factories can create their own content.

## Coverage gaps

A `COVERAGE-GAPS.md` recording what is deliberately not covered and what would
have to change to cover it. A gap with a named unlock signal is a plan; a gap
with no note is an oversight nobody can distinguish from a decision.

## The two anti-patterns

Both were found in a suite that otherwise passed review. Both are easy to commit
while believing you are being helpful.

1. **A spec that rolls its own helpers** instead of using the shared factory
   layer. It bypasses the escaping, loses the type safety — typically by
   annotating a page as `any` — and drifts from every other spec. If a shared
   layer does not exist yet, write the shared layer.

2. **Tags defined but not applied.** See above. The cost is not cosmetic; it is
   a suite that cannot be run selectively, which means it stops being run.

## Locators, honestly

Prefer roles and accessible names. Where the markup gives nothing better, theme
class names are acceptable — but say so in a comment, and say what would improve
it. Generated hooks that change on rebuild, such as a component framework's
hashed instance classes, are worse than stable theme classes and should not be
chosen just because they look more specific.
