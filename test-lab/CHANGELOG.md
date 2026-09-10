# Changelog

## 0.1.1

Closes four fidelity gaps against the source review.

- The success criterion the review closed on - maintainable by someone who was
  not there when it was built - now opens the methodology, so the rules below
  it read as means rather than preferences.
- Traceability section: the case identifier belongs in the filename as well as
  the test title. Grepping for a case number has to find the spec.
- Component and Page class suffixes stated rather than implied.
- Shared helpers live in `factories/`, with the environment wrapper alongside
  them, which is what makes the first anti-pattern legible.

## 0.1.0

Initial release.

- `test-lab:automate` — convert one user story, workflow, or manual test case
  into a Playwright spec, including a required red check that proves the
  assertion can fail.
- `test-lab:ingest` — pull a corpus out of a test management tool, triage what
  is automatable, and drive `automate` across it.
- `references/methodology.md` — the authoring standard, derived from a Velir
  head of Quality Assurance review of a real Drupal suite in May 2026.
- `references/sources/testrail.md` — the TestRail adapter, including the
  project-membership and credential-shape traps that cost a day to find.
- `references/scaffold/` — a working Page Object Model skeleton, fixture, and
  tag catalogue.
