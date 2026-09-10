---
name: automate
description: >
  Convert one user story, workflow, or manual test case into a Playwright spec that
  meets the authoring standard — page objects, fixtures, tags, and a red check that
  proves the assertion can fail. The unit of work. Not for running a whole corpus
  (test-lab:ingest), and not for reading a test management tool (lib:testrail).
---

# Automate one story

Takes a single unit of intent — a user story, a workflow description, or a manual
test case — and produces a spec that a head of Quality Assurance would sign off.

Read `references/methodology.md` before writing anything. It is the standard this
skill enforces, and it is short.

## Step 1: establish what the story actually asserts

Restate the story as one sentence describing observable behaviour. If you cannot,
stop and say so — a story you cannot restate is a story you cannot test, and
guessing produces a spec that asserts the status quo.

For an imported case, read the steps **and** the expected results. The expected
results carry the assertion; the steps are usually navigation.

Sort the intent into one of these, because it decides everything downstream:

| Kind | Automate as |
|---|---|
| anonymous front end | a spec against a shared environment |
| authenticated behaviour | a spec tagged `@local`, using a pre-authenticated fixture |
| content authoring | same, plus a factory to create what it acts on |
| form submission with side effects | usually not, until the side effect is contained |
| visual or editorial judgement | not automatable; record it as a gap |

## Step 2: find the page and the components

Look at the real markup before choosing locators. Do not infer them from the case
text.

Ask whether the page object and components already exist. Extending an existing
component is almost always right; a second component covering the same region is
almost always wrong.

If a new component is needed, follow the shape in `references/scaffold/`:
locators as `readonly` properties assigned in the constructor, composed into a
page object, behaviour that reads several properties exposed as a method.

## Step 3: decide what the spec depends on

State the dependency out loud and tag it:

- depends on a slow or remote service → `@slow`
- needs a local environment → `@local`
- depends on specific authored content existing → `@fixture-page`, **and** note
  in `TAGS.md` what would retire the tag

A spec depending on content a person made is acceptable only as a stated
compromise. Prefer a factory. If you use the compromise, make the failure
message say so, rather than leaving a bare selector timeout.

## Step 4: write it

Import `test` and `expect` from the fixture, not from `@playwright/test`. Reach
components through the page object. Use `test.step()` for anything with more than
one phase. Never `waitForTimeout()`.

Name the test for what it guards. An imported case keeps its real identifier —
`C447371` — in **both the filename and the test title**, so grepping the
repository for a case number finds the spec and the identifier survives into the
run report. Coverage with no upstream case gets a stable local prefix instead,
so the absence is visible rather than ambiguous.

## Step 5: red check — do not skip this

**Prove the assertion can fail.** A test that has never failed is a test you have
no reason to trust.

Pick whichever is available:

- run it against an environment that predates the fix
- revert the fix locally, run, restore
- break the expected value and confirm the failure message is legible

Record the result. If a test passes against both the fixed and unfixed states, it
is asserting the status quo rather than detecting a regression — say so in the
spec rather than quietly leaving it in.

## Step 6: report

State plainly: what the spec asserts, what it depends on, what the red check
showed, and what you deliberately did not cover. A gap with a named unlock signal
is a plan. A gap with no note is indistinguishable from an oversight.
