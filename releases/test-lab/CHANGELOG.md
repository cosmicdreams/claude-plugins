# Changelog

## Unreleased — phase 1, round 2 repairs (2026-10-18)

Fixed:

- `redcheck` stored its recipe before checking the branch, the served root, the site's health and host
  safety, so a refused attempt left a recipe behind. It now stores the recipe only after those checks,
  and removes it again if no receipt is written.
- A test's behavior digest no longer includes its mutation recipes. Each red check already binds its own
  recipe by hash, and the verdict re-checks that hash on every read. Before this change, red-checking a
  second obligation on the same test made the first red check stale, and `accept` refused until
  `reverify` ran. `reverify` now also replays a red check whose recipe file was edited in place.
- `regression add` wrote a QA transition and changed the profile on main or a detached checkout. It
  now refuses there, like every other command that writes records.
- `graduate decide` could record "graduated" and move the case, then fail on an Undefined priority or an
  unpublished QA base, which left the case in neither set and the proposal closed. It now checks
  everything first and rolls back every file if a later write fails. `case approve` uses the same
  rollback.
- The verdict page's handoff listed every acceptance and waiver, and said "counted as waived" even for
  waivers the verdict refused. It now reports how the verdict judged each record: counted (and on which
  configurations), or not counted and why.

## Unreleased — phase 1, round 1 (2026-10-18)

Added:

- `check`: QA's automation standard as `rules.json` and an advisory checker, with one passing and one
  failing fixture per rule and a drift warning when the standard changes.
- `source snapshot | priorities | case` through a replaceable connector (TestRail via lib:testrail's
  read-only helper, or recorded responses). Priority tags from the priority label, not the stored ID.
- Markdown case files; `init`, `ingest`, `case approve`, `regression add`, `work`, `adopt`,
  `redcheck`, `burnin`, `accept`, `waive`, `reverify`, `graduate propose | decide` and `triage`.
- `adapters/ddev.ts`, a local adapter that reports DDEV's own application root and runs Drush only once
  DDEV reports the project running.
- The verdict page and pane show approvals and acceptances with role labels ("QA (stand-in)"),
  waivers, graduation decisions, projects not run locally and failure classes chosen on the saved run.
- `references/qa-standard-proposal.md`: the changes test-lab proposes to QA's standard, not assumed.

Changed:

- Every planned run passes `--retries=0` and refuses any other retry count.
- A case whose source priority is Undefined can't be in a required set.
- `.test-lab/local.json` may set `addendumRoot: application`, which keeps the addendum and work files in
  the application worktree.

Not proven: the pilot, live TestRail, browser-side mutations, live terminal and Desktop use (see the
PHASE1 section of `tests/PHASE0-TRACEABILITY.md`).

## 2.0.0 — 2026-10-18 (unreleased; phase 0 of test-lab v2)

Major: v2 replaces the v1 authoring-only plugin with a readiness verdict core. The existing skills
(`automate`, `ingest`, `accessibility-scan`, `perf-measure`) are unchanged.

Added:

- A local command-line interface (CLI), `node src/cli.ts`: `stage-kit`, `preflight`, `run --tier fast`,
  `verify` and read-only snapshot `source`. The coordinator computes four outcomes (ready, not ready,
  inconclusive, not evaluable) from Playwright evidence it recomputes itself.
- The kit a suite stages (`kit/`): the public `caseStep()` helper, the step-ledger reporter and the
  pinned source parser it needs.
- A verdict pane and tool (`hooks/mod/`), backed by a runner (`src/mod-entry.ts`) that the mod starts
  through the host. A result is shown only when the operation, its status and its artifact carry the
  same request identity, so a recent sibling run is never shown as this one's result. Slow
  preparation has no launch deadline and is never reported as a dead runner; after the launch budget
  the pane says completion and cleanup are unknown and keeps a best-effort Stop.

Distribution:

- The marketplace installs `releases/test-lab`, a build of this folder without tests
  (`npm run build:release`). It ships no `node_modules`. Each installed copy installs its one runtime
  dependency, TypeScript 6.0.3, once with `node scripts/install-runtime.ts` (`npm ci` in its `kit`
  folder, lifecycle scripts off). Until then the runner and the pane refuse to start and print that
  command with the copy's real path.
- `npm run check:release` fails when the release drifts from the sources or holds any `node_modules`.
  `npm run test:install` proves the install step on a fresh copy, offline from the npm cache.

Not proven (see `tests/PHASE0-TRACEABILITY.md`): live terminal and Desktop use of the rebuilt mod, a
real host-driven run with report opening and clipboard, and any pilot run.

## 0.4.0 — 2026-09-29

- Add `accessibility-scan` and `perf-measure`, moved from the retired improve plugin. Score tuples feed `research-lab:experiment`.

## 0.3.0

Adds TypeSafe's Jev model as an optional first pass over the ingest triage.

- `scripts/triage_cases.py` asks one Choice per manual test case over the bucket table in `skills/ingest`. Confident answers (confidence at or above 0.8, a starting point) are used; uncertain ones, and every case when `TYPESAFE_API_KEY` is absent or `JEV_DISABLED=1`, are handed back for the agent to classify exactly as before. Every verdict records its source, model version, confidence, and threshold.
- `scripts/jev_client.py` — the shared standard-library client, copied verbatim across plugins; `admin/scripts/check-jev-client-copies.sh` fails if the copies diverge.
- `tests/test_triage_cases.py` — offline tests with a fake transport.

## 0.2.1

Rebuilds the test data factory on Playwright instead of a shell-out.

The 0.2.0 factory drove `drush`, because that is what the source review saw and praised by name. That optimised for recognition over transferability, which is the wrong trade for a standard whose whole claim is that it outlives any one stack — and the reviewer's own team is not on Drupal.

- `factories/content.ts` is now built on `APIRequestContext`. It is portable to any system with an HTTP write interface, runs in-process so a failed setup appears in the Playwright trace rather than a swallowed stderr, and sends structured data instead of generating source.
- That last property retires a class of defect rather than mitigating it. With nothing interpolated into another language there is nothing to escape, so the apostrophe that silently greens a suite cannot occur. `phpString()` is a patch for a problem this approach does not have.
- Factories are exposed as a fixture. A spec that builds its own factory builds its own credentials, which is the shared-layer anti-pattern in disguise.
- `global-teardown.ts` sweeps over the same request context, so the orphan sweep needs no shell and no platform tooling on the machine running the suite.
- `factories/drush.ts` survives as the documented escape hatch, warranted in two cases only: no write interface reachable over HTTP, or an operation the interface deliberately does not expose. It still carries the two rules that apply once you do shell out — escape everything interpolated, refuse an unnarrowed destructive verb.
- Define "factory". It manufactures the content a spec acts on; it does not generate tests. The plugin's job is generating tests, so the two senses of the word sat one directory apart with nothing distinguishing them.


## 0.2.0

Closes the gap between what the methodology asserts and what the scaffold actually demonstrates. Every rule the document claimed now has runnable code behind it, and the two rules that prose cannot enforce are enforced.

### The scaffold is now a working tree

- Restructured `references/scaffold/` to mirror the `tests/e2e/` layout it advertises. Previously the files sat flat while the documentation described a directory tree, so copying it as instructed broke every import.
- Added the factory layer, which the methodology called the strongest part of a mature suite and the scaffold omitted entirely: `factories/drush.ts` with `phpString()` escaping and a `drush()` wrapper that refuses an unnarrowed destructive verb, and `factories/content.ts` returning typed handles that carry their own `cleanup()`.
- Added `global-teardown.ts` (the orphan sweep), `global-setup.ts` (session capture, a no-op against shared environments) and `COVERAGE-GAPS.md`. All three were listed in the scaffold tree and none of them existed.
- Added a worked spec under `slices/` showing the case identifier in filename and title, `test.step()` throughout, tags actually applied, and a factory-created page disposed in a `finally`.
- The scaffold typechecks under `strict` with no `any`.

### Two rules moved from prose to enforcement

- `support/check-tags.mjs` fails the build on a tag defined in `TAGS.md` and applied to no spec, and on a tag applied and never defined. A tag documented and unused was one of the two defects in the source review, and it is the one an author under deadline commits while believing they are being thorough.
- `TAGS.md` now admits a tag only once a spec applies it. The remaining tags sit in a catalogue below the table until something needs them.

### Fidelity fixes

- Every rule in `references/methodology.md` is marked `[review]` or `[project]`, separating what the Velir head of Quality Assurance actually said from conventions added since. Several rules — the class-suffix convention, the animation polling, the traceability mechanism and four of the five tags — were presented as his and were ours.
- The factory section now leads with the four portable rules (one central adapter, typed handles with cleanup, escape everything interpolated, guard destructive commands) and demotes `drush()` and `phpString()` to the worked Drupal example. The standard is a Playwright standard; it was reading as a Drupal one.
- The locator guidance is now ordered and complete: role and accessible name, then a stable authored hook such as `data-component-id`, then a theme class as a commented compromise, never a generated hook. `ExampleComponent.ts` follows its own advice, which it previously did not — it was comment-first and cascading-style-sheet-second.
- `references/` paths in both skills are anchored to `${CLAUDE_PLUGIN_ROOT}`. A bare path resolved against the consumer project, where the methodology is not, so the standard the skill exists to enforce could silently never load.

### Corrections

- `base.fixture.ts` decides locality by parsing the hostname rather than matching text anywhere in the URL. `https://example.com/?next=localhost` and the host `project.ddev.site.example.com` both passed the old test, either of which hands a stored editor session to a shared environment.
- `test-lab:automate` requires `test.step()` throughout, matching the methodology. It previously required it only for tests with more than one phase, so the two documents disagreed.
- `test-lab:ingest` gains a delivery gate: run the full suite, keep `playwright-report/`, and deliver it with the code. The campaign previously ended on a count of cases, with no evidence the suite had ever been run.


## 0.1.1

Closes four fidelity gaps against the source review.

- The success criterion the review closed on - maintainable by someone who was not there when it was built - now opens the methodology, so the rules below it read as means rather than preferences.
- Traceability section: the case identifier belongs in the filename as well as the test title. Grepping for a case number has to find the spec.
- Component and Page class suffixes stated rather than implied.
- Shared helpers live in `factories/`, with the environment wrapper alongside them, which is what makes the first anti-pattern legible.

## 0.1.0

Initial release.

- `test-lab:automate` — convert one user story, workflow, or manual test case into a Playwright spec, including a required red check that proves the assertion can fail.
- `test-lab:ingest` — pull a corpus out of a test management tool, triage what is automatable, and drive `automate` across it.
- `references/methodology.md` — the authoring standard, derived from a Velir head of Quality Assurance review of a real Drupal suite in May 2026.
- `references/sources/testrail.md` — the TestRail adapter, including the project-membership and credential-shape traps that cost a day to find.
- `references/scaffold/` — a working Page Object Model skeleton, fixture, and tag catalogue.
