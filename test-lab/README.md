# test-lab

Turn a manual test corpus into an automated Playwright suite.

Two skills, split by unit of work:

| Skill | Unit | Use when |
|---|---|---|
| `test-lab:automate` | one user story, workflow, or test case | you are writing or reviewing a single spec |
| `test-lab:ingest` | the whole corpus | you are standing up or refreshing coverage across a test management tool |

`ingest` pulls and triages, then drives `automate` once per case. `automate`
stands alone and knows nothing about where the case came from — that separation
is the point, because the source changes and the authoring standard does not.

## Why two skills and not one

The obvious packaging is one skill, and it would be simpler to hand over. It
would also be wrong, because the two halves have different lifetimes. `ingest`
is coupled to whichever test management tool you are on this year; `automate` is
coupled to the authoring standard, which outlives it. Fusing them means the
authoring standard gets rewritten every time the source changes, and the part
worth keeping is the part that would churn.

Start at `test-lab:automate`. It is the whole standard and it needs no corpus, no
credentials and no adapter — a user story typed into the prompt is enough. Reach
for `ingest` only when there is a corpus to pull.

## Sources

The source is a plug point. `references/sources/` holds one adapter per tool;
`testrail.md` is the only one written so far. Adding a tool means adding an
adapter, not touching the methodology.

## Methodology

`references/methodology.md` is the authoring standard, derived from a Velir head
of Quality Assurance review of a real suite. It is the thing to cite when a
reviewer asks why the suite is shaped the way it is.

Every rule in it is marked **[review]** or **[project]** — stated by that
reviewer, or added by us since. Check the marking before citing a rule back to
them.

## Scaffold

`references/scaffold/` is a copyable `tests/e2e/` tree that satisfies the
standard: page objects, components, fixtures, test data factories built on
Playwright's own request context, a global teardown that sweeps orphans, a worked
spec, and `support/check-tags.mjs`, which fails the build on a tag that is
defined and never applied. It typechecks under `strict` with no `any`.

A factory here manufactures the *content a spec acts on*, not tests. It runs over
`APIRequestContext` rather than the browser or a shell, which keeps it portable,
puts setup failures in the Playwright trace, and means no value is ever
interpolated into another language — so the escaping bug that silently greens a
suite cannot occur. `factories/drush.ts` remains as the documented escape hatch
for operations no interface exposes.

The Drupal-specific surface is narrow and marked: the JSON:API paths, the
escape hatch, the local-hostname check, and the login link in `global-setup.ts`.
