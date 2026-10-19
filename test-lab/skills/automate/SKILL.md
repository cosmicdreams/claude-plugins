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

Read `${CLAUDE_PLUGIN_ROOT}/references/methodology.md` before writing anything.
It is the standard this skill enforces, and it is short. Anchor it to the plugin
root — a bare `references/` path resolves against the consumer project, where it
is not, and the standard then silently never loads.

## Step 1: establish what the story actually asserts

Restate the story as one sentence describing observable behaviour. If you cannot,
stop and say so — a story you cannot restate is a story you cannot test, and
guessing produces a spec that asserts the status quo.

For an imported case, read the steps **and** the expected results. The expected
results carry the assertion; the steps are usually navigation.

Read each expected result into obligations, and mark any obligation you read
*into* the case rather than out of it (an ordering rule the case implies, an
"only these options" the linked ticket implies) as an addition that waits for
the case owner. Additions are often worth asserting; they are never silently
the case's own words.

**When the case and the live product disagree,** follow the suite owner's
standard. A QA standard that says "stale documentation, not a bug" means:
automate against live behaviour, comment the divergence inline where the
assertion is, log it as stale documentation in the coverage-gaps file, and
raise a follow-up for whoever owns the case text. Do not park the case for
want of an answer; tag the follow-up blocking only if the answer would change
the next test you write. Cite code references to the base branch revision,
never a feature branch.

Sort the intent into one of these, because it decides everything downstream:

| Kind | Automate as |
|---|---|
| anonymous front end | a spec against a shared environment |
| authenticated behaviour | a spec tagged `@local`, using a pre-authenticated fixture |
| content authoring | same, plus a factory to create the content it acts on |
| form submission with side effects | usually not, until the side effect is contained |
| visual or editorial judgement | not automatable; record it as a gap |

## Step 2: find the page and the components

Look at the real markup before choosing locators. Do not infer them from the case
text. If no page can be served yet (empty database, broken layouts, missing
files), stop: a reading without a served page is a reading pilot, not a test,
and nothing about it can be red-checked.

Before running anything that renders search results or API-backed listings on a
local site, check where the application itself sends those requests. A local
site can still query a remote search service server-side; browser-side origin
blocking does not stop that. Point the service at a local instance and confirm
the effective configuration before any index operation.

Choose in this order, and stop at the first that works:

1. **Role and accessible name** — `getByRole`, `getByLabel`, `getByText`. This
   asserts what a person using a screen reader receives, so a break is usually a
   real accessibility regression rather than test maintenance. On a project
   where accessibility is a requirement this is not a preference, it is coverage.
2. **A stable authored hook** — `data-component-id`, `data-test`. Cheap for a
   front end team to add. If the markup gives you nothing and you are about to
   reach for a class name, ask for one of these first; it is a small request and
   it retires the compromise permanently.
3. **A theme class name, as a stated compromise.** Comment it, and say what
   would improve it.

Never a generated hook that changes on rebuild. A component framework hashed
instance class looks more specific and is strictly worse.

Ask whether the page object and components already exist. Extending an existing
component is almost always right; a second component covering the same region is
almost always wrong.

If a new component is needed, follow the shape in
`${CLAUDE_PLUGIN_ROOT}/references/scaffold/`:
locators as `readonly` properties assigned in the constructor, composed into a
page object, behaviour that reads several properties exposed as a method.

## Step 3: decide what the spec depends on

State the dependency out loud and tag it:

- depends on a slow or remote service → `@slow`
- needs a local environment → `@local`
- depends on specific authored content existing → `@fixture-page`, **and** note
  in `TAGS.md` what would retire the tag
- renders from a search index or an API → the suite standard's infrastructure
  tag for that service (for example `@solr`). Decide this for every listing,
  including ones that share a page object with a tagged one: find out what the
  listing actually calls. An endpoint inside the application that does not
  touch the index does not get the index's tag; give it a suite-defined tag
  and say in `TAGS.md` what it depends on.

**Apply the tag in the same edit that defines it.** A tag documented in
`TAGS.md` and applied to no spec is not a smaller version of the right thing; it
is the defect that leaves cloud-dependent specs failing on generic timeouts with
no clean way to exclude them. Run `node tests/e2e/support/check-tags.mjs` before
you call the spec done — it fails on a tag defined and never applied, and on a
tag applied and never defined.

A spec depending on content a person made is acceptable only as a stated
compromise. Prefer a factory. If you use the compromise, make the failure
message say so, rather than leaving a bare selector timeout.

## Step 4: write it

Import `test` and `expect` from the fixture, not from `@playwright/test`. Reach
components through the page object. Use `test.step()` throughout — every phase of
every spec, including the ones that look like a single phase, because a step is
what makes the failure report legible to someone who did not write the test.
Never `waitForTimeout()`.

Take content from the shared `factories/` layer, received as a fixture, and
never build it in the spec. A factory here manufactures the content the spec
acts on — it does not generate tests. Build it on Playwright's `APIRequestContext`
against whatever write interface the system exposes: portable across stacks,
visible in the trace when setup fails, and sending structured data rather than
generating source, so no value is interpolated into another language and there is
nothing to escape. Shell out only for what no interface exposes.

A spec that declares its own helper carries its own credentials, drifts from
every other spec, and typically annotates a page as `any` on the way past. If the
shared layer does not exist yet, write the shared layer — that is the work, not a
detour around it.

Make every assertion able to fail for the reason it names:

- **Universal claims** ("every X precedes every Y", "empty values come last")
  pass vacuously when a bucket is missing. Assert that each bucket is present,
  and check the whole set, not the first page: walk the pagination or assert
  the exact expected sequence of known fixture items at the boundaries. Do not
  rebuild the application's own sort key or filter in the test; an oracle
  copied from the code cannot catch a bug in that code. If a bucket has no
  fixture, skip that obligation with an unlock signal instead of asserting it.
- **Option lists**: when the case or its linked ticket is about options being
  removed, assert the exact list (`toHaveText([...])` on the collection), not
  the presence of the expected ones.
- **"Goes to page X"**: assert that page X rendered (status, title, a heading
  only it carries), not the final URL alone; a URL can be right on an error
  page. A start page needs the same, or an installer or error redirect passes.
- **Values that are not locators** (a response status, a decoded image) are
  asserted with a message argument, so the red check's failure reads as the
  obligation rather than `expected true, received false`.

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

Red-check **each obligation** with its own fault, applied to the application,
never to the test. The check counts only if the test fails *at that
obligation's step*; a fault that fails an earlier step proves nothing about the
obligation it was meant for. When one fault breaks two steps, reorder the steps
or split the test so the target fails first. Check that each fault really
reached the served site (a cached page, a framework that normalises the URL, or
a style rule that overrides `hidden` can leave it invisible) before reading a
pass as "not caught". Restore, run again green, then burn in with repeats and
no retries.

## Step 6: report

State plainly: what the spec asserts, what it depends on, what the red check
showed, and what you deliberately did not cover. A gap with a named unlock signal
is a plan. A gap with no note is indistinguishable from an oversight.

Put gaps and questions where the suite owner's standard keeps them (for a QA
suite: the coverage-gaps file for skips and stale documentation, the progress
tracker's follow-ups for questions), not in a separate notes file of your own.
