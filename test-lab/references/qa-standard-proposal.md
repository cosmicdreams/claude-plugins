# Proposed changes to QA's automation standard

Status: **proposal, not adopted.** QA owns `automation/CLAUDE.md`. test-lab never edits it and
does not assume any of this is accepted. Everything below is offered for the head of QA to accept,
change or reject. Until he does, test-lab's checker (`test-lab check`) treats the standard as
written and never flags a spec for lacking anything proposed here.

Ported from: `automation/CLAUDE.md` at commit `38b72b01a37f785b98867725b5ee012ade26de21`
(see `rules.json`).

## 1. `caseStep()` and the `support/test-lab/` kit

**What.** A suite that opts in copies test-lab's kit into `support/test-lab/` (versioned, one hash per
file). Specs wrap each case step, and each expected result inside it, in `caseStep()`:

```ts
await caseStep(page, { case: 'C1001', step: 'S1' }, 'Click the footer logo', async () => {
  await caseStep(page, { case: 'C1001', step: 'S1', obligation: 'O1' }, 'the home page opens', async () => {
    await expect(page).toHaveURL('/');
  });
});
```

**Why.** It lets a report say which expected result failed, not only which test. That is what makes
a red check meaningful: a fault aimed at one expected result has to fail inside that result's step,
so a test that claims two results but asserts one is caught.

**What does not change.** Page objects, `fixtures/base.ts`, tags, locators, the config baseline and
`COVERAGE-GAPS.md` stay exactly as the standard says. `caseStep()` is a thin `test.step()` wrapper
using public Playwright APIs on 1.58 and later.

## 2. A readiness run uses `--retries=0`

**What.** The config baseline keeps `retries: process.env.CI ? 2 : 0`. test-lab's own runs always add
`--retries=0`, and a test that passes only on retry is reported as flaky, never as passed.

**Why.** CI retries keep a shared pipeline moving; a readiness verdict has to say whether the build
works, and a retry pass hides exactly the instability QA would otherwise meet by hand.

**Proposed wording:** "Retries are for CI throughput. A readiness or certification run uses
`--retries=0`; a pass on retry is a flake, not a pass."

## 3. The mobile viewport guard counts only where the case says the layout doesn't apply

**What.** The standard's guard (`if ((page.viewportSize()?.width ?? 0) < 768) { test.skip(); return; }`)
stays. test-lab counts a guarded skip as fine only when the case itself declares the mobile
configuration not applicable. If a case declares a mobile width and its test skips there, that
configuration is not covered.

**Proposed wording:** add to "Mobile viewport guard": "The case must say the mobile layout is out of
scope (or name the companion case). A guard on a case that applies to mobile is a gap."

## 4. `test.fail()` never counts as coverage

**What.** A known-failure spec keeps the suite green while it fails as expected. test-lab keeps that
behavior for CI, but never counts such a spec toward a ready verdict.

**Proposed wording:** add to "Known-Failure Specs": "A `test.fail()` case is not covered. It is a
tracked gap with a live tripwire."

## 5. Undefined priority: `@p3`, never required

**What.** The standard tags an Undefined-priority case `@p3`. test-lab does the same, and also never
lets such a case be part of a required set until QA assigns a priority.

**Proposed wording:** add to "Tags & Coverage": "`@p3` from an Undefined priority is a default, not a
decision. Assign a priority before the case gates anything."

## 6. Departure, not a proposal: the TestRail "Automated" type

The standard asks for a case's type to be set to Automated once its spec passes. test-lab's source
is read-only in this phase (`lib:testrail` read endpoints only), so it does **not** set the type.
This is a recorded departure: the verdict page says so on every run, and the review request lists
which cases would have been marked.
