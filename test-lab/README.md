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

## Sources

The source is a plug point. `references/sources/` holds one adapter per tool;
`testrail.md` is the only one written so far. Adding a tool means adding an
adapter, not touching the methodology.

## Methodology

`references/methodology.md` is the authoring standard, derived from a Velir head
of Quality Assurance review of a real suite. It is the thing to cite when a
reviewer asks why the suite is shaped the way it is.
