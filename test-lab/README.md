# test-lab

Turn a manual test corpus into an automated Playwright suite.

## Install

```
/plugin install test-lab --marketplace cosmicdreams/claude-plugins
```

Then, once per installed copy (after each install or update), install its one
runtime dependency, the pinned source parser (TypeScript 6.0.3):

```sh
node <plugin folder>/scripts/install-runtime.ts
```

This runs `npm ci` in the copy's own `kit` folder from its lockfile, with
lifecycle scripts off, and writes nothing outside `kit/node_modules`. The
plugin ships no `node_modules`; until this step is done, the runner and the
verdict pane refuse to start and print this exact command with the copy's real
path. Requires Node.js 24 or newer with npm. `--offline` installs from the local
npm cache only.

## V2 development

The v2 rewrite is in development. Its purpose is a trustworthy local readiness
verdict before deploying work for human QA. QA owns the regression scope;
developers declare an addendum for their work. The core computes four outcomes:
ready, not ready, inconclusive, and not evaluable.

This checkout contains the verdict foundation, evidence and input-manifest
validation, scope-history checks, a public Playwright helper and reporter, a
read-only TestRail snapshot boundary, and a minimal verdict pane. TestRail
authentication remains in `lib:testrail`. Imported cases require an approved
interpretation and declared configurations before they can gate a verdict.

An executable local CLI now provides `stage-kit`, `preflight`, `run --tier fast`,
`verify`, and read-only snapshot `source`. Its coordinator and persisted data
contract have passed bounded independent integration review. Run
`node src/cli.ts --help` from this folder for the current arguments. `verify`
checks policy; its success does not mean the application is ready.

The foundation and declared invocation-input protocol have passed bounded
independent correctness reviews. The local pilot and live terminal/Desktop
acceptance remain pending. The existing skills below are the current authoring
workflow. Passing fixture and mocked-host tests do not establish pilot or live
UI acceptance. See
[phase 0 traceability](tests/PHASE0-TRACEABILITY.md) for the evidence and gaps.

### Phase 1 (in development)

Phase 1 adds the commands that take a case from a test management tool to a red-checked, accepted
test and a local verdict, and holds converted tests to QA's own automation standard. Run
`node src/cli.ts --help` for every argument.

- **`check`** ports QA's automation standard (`automation/CLAUDE.md`) into `rules.json`: each rule
  records the section and text it comes from, the commit it was ported from, and how it is checked.
  With `--standard` it warns when the standard has changed. It is advisory: a finding never enters the
  verdict, and a rule that flags a clean example suite is a checker bug.
- **`source snapshot | priorities | case`** read cases through a replaceable connector: TestRail
  through lib:testrail's own read-only helper (credentials stay in lib), or recorded responses for
  tests. A refresh is complete or it writes nothing. Priority tags come from the instance's priority
  labels ("2 - Short Regression" is `@p2` whatever its stored ID); Undefined is `@p3` and never
  required. Nothing is written to TestRail.
- **`init`**, **`ingest`**, **`case approve`**, **`regression add`** set up the corpus: Markdown case
  files with where each was drafted from, a written interpretation, and approvals bound to the case's
  hash and, for a TestRail case, to its exact source text. A regression change is a QA transition.
  Approvals by a stand-in read "QA (stand-in)" everywhere.
- **`work`**, **`adopt`**, **`redcheck`**, **`burnin`**, **`accept`**, **`waive`**, **`reverify`**,
  **`graduate propose | decide`** and **`triage`** cover the work's addendum, binding tests to cases,
  evidence, acceptance, graduation into QA's suite and failure classes on a saved run.
- The suite checkout and the application worktree are always named separately. `adapters/ddev.ts`
  reports the root DDEV actually serves, so a site serving another checkout is caught. With
  `addendumRoot: application` in `.test-lab/local.json`, the developer's addendum and work files stay
  in the application worktree, out of QA's repository.
- Red checks change the application, never the test: the local adapter applies and removes each
  recipe's fault (for DDEV, from the application worktree's own `.test-lab/mutations.ts`). A recipe is
  stored only once the red check's own checks pass, and removed again if no receipt is written. Each red
  check binds its own recipe by hash, so red-checking a test's second obligation leaves the first one's
  red check, the burn-in and the acceptance current; editing a recipe stales only its own red check.
- Every command that writes records refuses on main, master or a detached checkout, `regression add`
  included. `graduate decide` and `case approve` check everything before writing, and a refusal part-way
  leaves every file they touch as it was.
- The verdict page lists each acceptance and waiver as the verdict judged it: counted, or not counted and
  why (for example a waiver recorded in the QA role by someone the trusted base does not list, or an
  acceptance for an earlier behavior digest).
- Where the standard and the verdict disagree, the settlement is recorded as a rule and a proposal to
  QA (`references/qa-standard-proposal.md`), not assumed: runs use `--retries=0`; a viewport-guard skip
  counts only where the case declares that configuration not applicable; `test.fail` never counts
  toward ready.

What is proven, and what is not (including the pilot, which has not run), is listed in the
[PHASE1 sections of the traceability file](tests/PHASE0-TRACEABILITY.md#phase1--round-1-build-2026-10-18-uncommitted).

Development requires Node 24 or later and the dependencies locked in this folder,
in `kit`, and in both `tests/playwright/pw-<version>` folders (`npm ci` in each).
Playwright compatibility tests also require Chromium for each pinned release.
Mod checks use the installed Claude Code CLI and its SDK declarations. From this
folder:

```sh
npm test                  # core, including the release and its no-node_modules gate
npm run test:install      # the install step on a fresh release copy; needs the parser in the npm cache
npm run test:playwright
npm run typecheck
npm run test:mod
npm run check:release     # releases/test-lab matches the sources and holds no node_modules
```

The marketplace installs `releases/test-lab`, built from this folder with
`npm run build:release`. Rebuild it after any change to a shipped file;
`check:release` and `npm test` fail until you do.

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
