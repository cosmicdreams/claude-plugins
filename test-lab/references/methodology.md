# Playwright authoring standard

Cite this when a reviewer asks why the suite is shaped the way it is.

The criterion everything below serves, which is the one the source review closed
on:

> the documentation makes it maintainable by someone who wasn't there when it
> was built

A suite only its author can change is a suite that stops being changed.

## Where each rule comes from

Two provenances, kept apart on purpose. If you are going to cite this document
to the person who gave the review, you need to be able to say which half is
theirs.

- **From the review** — stated by a Velir head of Quality Assurance reviewing a
  real Drupal suite in May 2026, either praised as worth keeping as a template
  or named as a defect. Marked **[review]**.
- **Project guidance** — conventions added since, because they solved a problem
  in practice. Reasonable, unratified, and open to being overruled by anyone
  with better evidence. Marked **[project]**.

The distinction is not bureaucratic. A rule presented as someone's professional
judgement when it was in fact a local habit is the kind of thing that gets
noticed, and it costs the rest of the document its credibility.

## Page Object Model

The structure is the first thing a reviewer looks for.

- **[review] Locators are `readonly` properties assigned in the constructor.**
  Not getters, not inline in the test body, not built on demand.
- **[review] Components are composed inside pages.** A page object holds its
  components as properties; a spec reaches the component through the page, not
  independently.
- **[project]** Site-wide chrome — header, footer — belongs on the base page, so
  a spec can assert on it without knowing which page object it holds.
- **[project]** Behaviour that reads several properties at once belongs on the
  object as a method, not spread across the spec. A spec should read as intent.
- **[project] Component classes end in `Component`**, page classes in `Page`.
  The suffix is how a reader tells the two apart in an import list. The review
  named `MegaMenuComponent` in passing; it did not state the convention.

Reference: Playwright's own page object documentation at
<https://playwright.dev/docs/pom>, which the review pointed at directly.

```ts
export class GlobalFooterComponent {
  readonly root: Locator;
  readonly socialLinks: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByRole('contentinfo');
    this.socialLinks = this.root.getByRole('link');
  }

  async socialLinkHrefs(): Promise<string[]> {
    return this.socialLinks.evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).href));
  }
}
```

## Fixtures

**[review]** A `base.fixture.ts` re-exports `test` and `expect`, and exposes page
objects already built. Specs import from it rather than from `@playwright/test`.

**[review] Authenticated pages are exposed as fixtures.** A spec never logs in
itself. The fixture builds a context from a stored session, hands over a page
object, and closes the context afterwards so a session cannot leak into an
anonymous test.

**[project]** Decide whether an environment is local by parsing the hostname,
not by matching text anywhere in the URL. `https://example.com/?next=localhost`
passes a substring test, and the cost of that is a stored editor session used
against a shared environment.

## Factories

**[review]** The strongest part of a mature suite, and the usual thing missing
from a young one. A spec that depends on content a person created is a spec that
breaks when that person edits it.

The portable rules, in the form that survives leaving Drupal:

- **[review] One adapter, centrally located.** Shared helpers live in one place —
  `factories/` — with the environment wrapper alongside them. A spec importing
  from anywhere else is the first anti-pattern below.
- **[review] Factories return a typed handle with a `cleanup()` callback**, not a
  bare id. The handle carries its own disposal, so a caller can clean up in a
  `finally` without knowing what it holds.
- **[review] Escape every value interpolated into another language.** Whatever
  you are generating — PHP, SQL, a shell word, JSON — the escape happens in the
  adapter and nowhere else. Without it, a title containing an apostrophe produces
  a silent error in the generated code instead of a test failure. That is the
  worst available outcome, because the suite goes green having done nothing.
- **[review] Guard destructive commands.** The adapter refuses a destructive verb
  invoked with nothing narrowing it. Called out explicitly as good practice, not
  paranoia: a generated cleanup helper whose id came back undefined will happily
  ask to delete every entity of a type.
- **[review] A global teardown sweeps orphans** — content whose test died before
  its cleanup ran.

The Drupal instantiation of those rules is `phpString()` and a guarded `drush()`,
which is what the review actually saw and praised by name. It is in
`scaffold/factories/drush.ts` as the worked example. **Port the four rules above;
do not port `drush`.** On a project that is not Drupal, the adapter is whatever
reaches your environment — and the escaping, the typed handle, the guard and the
sweep are unchanged.

## Discipline

- **[review] `test.step()` throughout.** It is what makes a failure report
  readable to someone who did not write the test.
- **[review] Zero `waitForTimeout()`.** Use web-first assertions, `expect.poll`
  for values that settle, and explicit state assertions. A fixed sleep is a
  defect even when it passes.
- **[project]** Watch for transitions. Reading a computed transform immediately
  after a click catches it mid-animation; poll until settled.

## Traceability

**[project]** A spec converted from a manual case is worth nothing to the person
who owns that case unless they can find it. The review asked for the source
regression documents so automated coverage could be cross-referenced against the
original cases; the specific mechanism below is ours.

- The filename carries the case identifier: `C447371-footer-presence.spec.ts`.
  Grepping the repository for a case number has to find the spec.
- The test title carries it too, because the identifier has to survive into the
  run report, where filenames are easy to lose.
- Coverage with no upstream case gets a stable local prefix — `REG-` and a name —
  so the absence is visible rather than ambiguous.
- Commit the raw corpus payload beside the tests, so the coverage claim can be
  checked rather than taken on trust.

## Tags

**[review]** Two documents, both required, and the second is the one that gets
forgotten:

- `TAGS.md` defines every tag and **why it exists**.
- The tags are **actually applied**. Defining a tag and never using it was one of
  the two defects found in review: cloud-dependent specs failed on generic
  fifteen-second timeouts with no clean way to exclude them, because the tag that
  would have excluded them was documented and unused.

**[project]** Two consequences we have drawn from that. First, a tag enters
`TAGS.md` when the first spec applies it, and not before — a catalogue of tags
nobody has used yet is the defect in slow motion. Second, the rule is enforced
rather than described: `scaffold/support/check-tags.mjs` fails the build on a tag
defined and never applied, and on a tag applied and never defined. Prose telling
an author to apply their tags does not survive a deadline.

**[project]** Tags worth reaching for, once something needs them: `@smoke` for
structural health expected everywhere, `@regression` for a guard on a specific
shipped fix, `@slow` for a dependency on a slow or remote service, `@local` for
anything needing a local environment, `@fixture-page` for a dependency on
authored content. Only the pattern is from the review — the taxonomy is ours.

**[review]** Record **unlock signals**: the condition under which a tag stops
being needed. `@fixture-page` disappears when factories can create their own
content.

## Coverage gaps

**[review]** A `COVERAGE-GAPS.md` recording what is deliberately not covered and
what would have to change to cover it. A gap with a named unlock signal is a
plan; a gap with no note is an oversight nobody can distinguish from a decision.

**[review]** Deliver the run report with the code. A full-suite run written to
`playwright-report/` gives a reviewer the pass and fail snapshot, the execution
times and the skips — which is what lets them judge the suite without first
reproducing your environment.

## The two anti-patterns

**[review]** Both were found in a suite that otherwise passed review. Both are
easy to commit while believing you are being helpful.

1. **A spec that rolls its own helpers** instead of using the shared factory
   layer. It bypasses the escaping, loses the type safety — typically by
   annotating a page as `any` — and drifts from every other spec. If a shared
   layer does not exist yet, write the shared layer.

2. **Tags defined but not applied.** See above. The cost is not cosmetic; it is a
   suite that cannot be run selectively, which means it stops being run.

## Locators

**[review]** Prefer roles and accessible names. On a project where accessibility
is a requirement this is not a stylistic preference — a locator built on the
accessibility tree asserts what a person using a screen reader receives, so a
break in it is a real regression rather than test maintenance. Background:
<https://stevekinney.com/courses/self-testing-ai-agents/locators-and-the-accessibility-hierarchy>.

**[review]** Where the markup gives nothing better, theme class names are
acceptable — the review saw a mega menu whose locators fell back to block-element
-modifier class names and accepted them, because the markup offered nothing else.
Say so in a comment, and say what would improve it.

**[review]** What would improve it is usually a stable authored hook —
`data-component-id` or equivalent — which the review named as a quick upgrade
worth asking the front end team for. Ask before settling for a class.

**[project]** Generated hooks that change on rebuild, such as a component
framework's hashed instance classes, are worse than stable theme class names and
should not be chosen just because they look more specific.

So, in order: role and accessible name, then a stable authored hook, then a theme
class as a commented compromise. Never a generated hook.
