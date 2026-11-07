# Phase 0 traceability

What each phase 0 obligation in `plans/test-lab-v2.md` (§2, §4, §6, §8, §9, §14) is proven by, and what is not proven. "Real" means exercised against real files, real Git, real HTTP or a real Playwright run; "synthetic" means built ledgers or records fed to the real core; "mock" means the host test kit's mocked engine. Nothing here is pilot evidence.

| Obligation | Proven by | Kind |
|---|---|---|
| Decision table, rules 1–8, first match wins | `tests/ts/verdict.test.ts` (counterexamples, one fact changed per case) | synthetic ledgers, real receipts on disk |
| Retry-pass, expected failure, unexpected pass, runtime skip, `step.skip`, missing result never pass | `tests/ts/normalize.test.ts`; `tests/playwright/compat.test.ts` "full scenario" | synthetic + real 1.58.2/1.60.0 |
| Deepest failing obligation credited; failed test gives no passing witness | `normalize.test.ts` "attribution"; compat "deepest failing obligation" | synthetic + real |
| Many-to-many: a pass never hides another mapped failure; failure in an earlier invocation not hidden by a later pass | `normalize.test.ts`; `verdict.test.ts` rule 6 two-invocation | synthetic |
| Run status: teardown error, interrupted, killed, global timeout, missing invocation, cut ledger, unexplained status | `normalize.test.ts` "run status"; compat teardown and timeout/kill tests | synthetic + real |
| Completion record written last; JSON, HTML and step ledger in the invocation folder; no report server | compat "full scenario", teardown | real |
| `caseStep()` uses public `step.attach`; viewport read from the page; IDs, nesting, duplicate titles, skips, errors round-trip | compat; `scripts/typecheck.ts` (kit against each release's public types) | real |
| Receipts recomputed from ledgers: integrity hash, path containment, recipe hash, failure in the right obligation's step, setup passed, restored pass, five clean repeats | `tests/ts/evidence.test.ts`; compat "red check ... through receipts" (Playwright-written ledgers) | real files + real |
| Evidence transfer only by explicit applicability on same project and role, same material fields | `evidence.test.ts` "transfer"; "bindings" | real files |
| Behavior/toolchain digests: helper, config-only helper, declared stylesheet, case content, recipe, fixture option move the right digest; outputs and new specs move none; undeclared reads and computed imports stay unresolved | `tests/ts/digest.test.ts` | real files |
| Content manifest: two uncommitted states differ; edit during run; outputs excluded; generated assets hashed | `tests/ts/identity.test.ts` | real Git |
| Effective base URL is what Playwright resolved (shell override and hard-coded config) | compat "full scenario", "ignores the base-URL variable" | real |
| QA transitions replayed on current base with prior hashes; upstream case survives; conflict; reconcile supersedes; roles from base; stale local base read from remote-tracking ref | `tests/ts/regression.test.ts` | pure + real Git (bare remote) |
| Work journal: written first; check never changes it; truncation invalid on every run; import order; diverged import refused; fresh clone marked; binding survives rename; detached needs `--work` | `tests/ts/work.test.ts` | real files + real Git config |
| Role refusals: demotion, quarantine, risk acceptance, regression approval/acceptance/waiver by a developer | `tests/ts/roles.test.ts`, `evidence.test.ts`, `verdict.test.ts` | synthetic |
| Excluded suite never invoked; config-only probe loads no spec; excluded project not selected; dependency on excluded project refused; path exclusion never loaded during discovery or run | compat "excluded projects and paths" (marker file written at module load) | real |
| Fixture existence (404 missing → rule 3) vs 500 (not established; tests decide → rule 5, "application error") | `tests/ts/preflight.test.ts`; `verdict.test.ts` rule 3 | real HTTP |
| Health page answering 500 is reachable, not an outage; unreachable host trips | `preflight.test.ts`; `verdict.test.ts` rule 4 | real HTTP |
| Secret `use` options never written | compat exclusions test (`httpCredentials`) | real |
| Mod: registered tool, pane on terminal and desktop, report opened by argv on the same machine, summary only otherwise | `tests/mod/register.test.tsx` via `npm run test:mod` (`claude plugin test`) | mock |
| TestRail snapshot boundary: complete dated snapshots, metadata-derived priority ids, unapproved drafts, stale/partial refusal and bounded pagination | `tests/ts/source.test.ts` | synthetic source JSON through the real importer |

## Not proven by phase 0

- **Live Desktop and live terminal UI.** The mod's tests run under the host kit's mocked engine. No documented automated Desktop mod-test command exists; Desktop loading, rendering and the report opener on Desktop are not checked.
- **Pilot evidence.** No run, verdict, red check or counterexample on a real pilot site (phase 1 has one pilot).
- **Live `source` collection and CLI wiring.** `src/source.ts` reads the normalized dated snapshot format; the public CLI and an archived-source migration require phase 1 wiring. No new TestRail read or credential check is claimed by its synthetic tests.
- **Preflight wiring.** Fixture checks, host scan, health probe, identity and the run plan exist as tested functions; no CLI composes them into a run. `drush`-based local fixture existence and `ddev describe` are parsed but never invoked.
- **After-setup role probe.** A describe-scope `storageState` is treated as unobservable (the case is not run), not probed.
- **Global setup safety.** A governed config's `globalSetup` runs on every real run; only the literal-host scan guards it, and the scan is not yet wired into a run.
- **Case corpus format.** Cases are JSON records; the Markdown front-matter corpus is phase 1.
- **Cross-repository suite and application roots.** Identity takes the application root separately, but no test runs a suite checkout distinct from the served worktree.


## Independent review R1 repair traceability

The original review's 11 reproductions were added as failing regressions before their fixes. Core
failure output is retained in `/tmp/test-lab-repair-red-core.txt`, with rule 1/classification output in
`/tmp/test-lab-repair-red-verdict.txt` and transition output in
`/tmp/test-lab-repair-red-regression.txt`. `/tmp/test-lab-repair-red-pw.txt` records both pinned versions
loading the forbidden marker and accepting a real five-repeat run with teardown failure. The additional
computed-read exemption failed in `/tmp/test-lab-repair-red-computed.txt` before that repair.

1. **Project-specific exclusion union:** `tests/playwright/repair.test.ts`, `R1-1`, on both pinned versions.
   A combined invocation with different permitted file sets is refused before specs load. Caller file
   arguments cannot widen the filters (`/tmp/test-lab-repair-red-argv.txt` captures the failing real
   reproduction before that fix); extra argv is limited to execution options. Callers must
   plan separate invocations. Dependency/teardown projects with path exclusions are refused even when
   also explicitly selected, because Playwright does not filter dependency specs.
2. **Filesystem read exemption and destructured require:** `digest.test.ts`, `R1-2`. Static reads must
   match this reader's own declarations. Computed reads need a declaration with a zero-based `read`
   index, so one declaration never authorizes the reader's other computed reads. Declared inputs are
   expanded and hashed; edits to a separately declared hidden input move the digest.
3. **Empty case matrix:** `verdict.test.ts`, `R1-3`. An approved empty matrix is invalid under rule 1;
   normalization retains its required-case row, and the verdict checks the declared denominator.
   Imported drafts still have empty matrices and cannot gate merely by adding an approval.
4. **Waiver bypassing burn-in:** `evidence.test.ts`, `R1-4`. A waiver replaces only the red check;
   current digests, valid burn-in and acceptance remain necessary.
5. **Cross-case failure propagation:** `evidence.test.ts`, `R1-5`. A propagated C1/S1/O1 parent cannot
   claim a deeper C2/S1/O1 failure. Attribution checks the complete tuple and its structural step path.
6. **Delimiter identity collision:** `evidence.test.ts`, `R1-6`. Test, behavior and obligation keys use
   structural arrays; literal/nested titles and delimiter-containing fields cannot share receipts.
7. **Backdated developer demotion:** `roles.test.ts`, `R1-7`. Onboarding comes only from an explicitly
   trusted immutable baseline. Proposed dates and reordering cannot establish it; edited baseline
   records are refused and cannot replace the trusted classification.
8. **Failed burn-in / skipped restoration:** `evidence.test.ts`, `R1-8`, and actual Playwright `R1-8`.
   Run-level errors disqualify receipts; restored and burn-in runs require clean first-attempt passes,
   and the restored target obligation must actually pass. Burn-in obligation skips are rejected.
9. **Original QA transition bindings:** `regression.test.ts`, `R1-9`, plus its real-Git transition test.
   `readTransitionBases` reads immutable commits in upstream history. Original before/after hashes
   are checked against those sets plus preceding branch transitions before current-base replay.
   Forged fields and reordered transitions fail; subsequent upstream additions remain required.
10. **Environment binding:** `evidence.test.ts`, `R1-10`, and actual Playwright receipt integration.
    Receipts and schema-2 raw ledgers carry explicit environment id/kind/base URL. These bindings,
    actual effective base URL and current environment must agree. Same-URL identity changes and
    altered raw bindings invalidate sensitivity; acceptance survives an environment-only change.
    Old receipts lacking bindings are invalid, and old schema ledgers are not migrated.
11. **Persisted status enums:** `normalize.test.ts`, `R1-11`. Declaration/result expected statuses,
    result statuses, outcome records and final statuses are closed enums before outcome computation.

The kit version is now `0.2.0`, with ledger/step schema `2`. No existing verified receipt was migrated.
Classification callers must supply the trusted baseline from Git; regression callers must supply
`readTransitionBases` results. CLI composition remains a pending gate, so these APIs are not described
as an integrated command workflow. The live host, after-setup role, cross-repository and pilot gaps
listed above remain open. Repair completion is not phase 0 acceptance or the start of phase 1.

Validation for this repair (2026-10-09): `npm test` 202 passed; `npm run test:playwright` 22 passed
on 1.58.2/1.60.0; `npm run typecheck` core, both public Playwright type gates and mod/SDK passed;
`npm run test:mod` 10 mocked-host tests passed; `claude plugin validate test-lab` passed. Final logs:
`/tmp/test-lab-repair-core-final.txt`, `/tmp/test-lab-repair-pw-final.txt`,
`/tmp/test-lab-repair-types-final.txt`, `/tmp/test-lab-repair-mod.txt`.
Independent re-review remains a separate app-owned task. No phase acceptance is implied.

## Round 2 source-boundary repairs

The independent round 2 report identified contradictory source project identities and
malformed separated-step data. The root added `R2-10` and `R2-11` in `source.test.ts`;
both failed before the source fixes (`/tmp/test-lab-source-r2-red.log`). Suite and case
project identities supplied by the API must agree with the requested project before
the snapshot can be complete. A malformed separated-step value stays `needs-work`
with no fallback interpretation or approval. All eleven source tests pass after the
fixes. These tests exercise the collection boundary with injected raw responses and
the on-disk reader; they are not live TestRail or pilot evidence. Independent closure
and the remaining round 2 core repairs were subsequently reviewed in the rounds
linked below.

## Current integration status — 2026-10-10

Earlier sections record historical milestones, not current acceptance. The
[foundation R7 review](../../plans/test-lab-v2-phase0-review-r7.md) confirmed the
retained foundation repairs with 407 core and 76 actual Playwright tests. The
[invocation-input R2 review](../../plans/test-lab-v2-invocation-inputs-review-r2.md)
confirmed declared nonsecret input observations, begin-fault retention and
per-test projections with 489 core and 90 actual Playwright tests. These are
bounded ordinary correctness reviews; neither establishes live acceptance.

The executable coordinator has generic integration coverage in
`tests/playwright/coordinator.test.ts` and `coordinator-r1.test.ts`, supported by
`tests/fixtures/coordinator.ts` and `coordinator-evidence.ts`. Separate temporary
application and suite repositories exercise all four verdicts, actual login
dependencies and authenticated after-setup actor probes, genuine mutation,
restoration and five-repeat evidence, input changes, exclusions and interruption.
These fixtures establish generic behavior, not Drupal permissions or a pilot run.

The [coordinator R1 review](../../plans/test-lab-v2-local-coordinator-review-r1.md)
found eight integration issues. The
[repair response](../../plans/test-lab-v2-local-coordinator-repairs-r1.md) records
their fixes and a subsequent interruption-message fix, reporting 514 core and
108 actual Playwright tests. The
[independent coordinator R2 review](../../plans/test-lab-v2-local-coordinator-review-r2.md)
confirmed all eight repairs and the interruption fix on the current code, passing
514 core and 108 actual Playwright tests independently. It checked the on-disk
work after the implementation agent's usage-limit interruption. The intermittent
`ps` permission failure did not recur; inspection confirmed process-group
termination precedes that check and an error does not claim confirmed cleanup.
Cleanup guarantees remain limited to owned process groups and adapters honoring
their cancellation contract.

The live terminal/Desktop load, rebuild and artifact-opening gates, concrete
Drupal/DDEV adapter, authoring/review operations and the owner-approved pilot
remain open. Source snapshots retain their existing TestRail boundary; none of
these fixture checks proves live TestRail or client acceptance.

## Mod host spike — 2026-10-10

The [mod implementation response](../../plans/test-lab-v2-mod-coordinator-implementation-r1.md)
records live Claude Code 2.1.296 terminal plugin loading, registered tools,
model-invoked verdict reading, pane drawing and module rebuilding after an edit.
Evidence is in `/tmp/test-lab-host-spike-2026-10-10T16-21-42-559Z.jsonl` and
`/tmp/test-lab-host-pane-spike-2026-10-10T16-24-51-253Z.jsonl`. These checks do not
prove successful host-driven execution: the process call failed with
`sandbox-exec: sandbox_apply: Operation not permitted`. Report and copy buttons
also failed; their exact cause was not established. Desktop was not tested live.
No guard bypass or account installation is part of this evidence.

The standalone runner passed focused real-Playwright Ready, Stop and deadline
checks, and 32 mocked-host checks passed. The complete gates remained red:
518/519 core tests and 110/111 actual Playwright tests passed. The failures concern
adapter cleanup under denied `ps` access and the new Ready-runner test becoming
Inconclusive under the full suite. Dependency packaging also remains incomplete
for a Git-only marketplace install. Independent mod review is active; this slice
and phase 0 are not accepted.

## Current status — 2026-10-18 (plugin 2.0.0)

This section supersedes the gate counts above. Mod review R2
(`plans/test-lab-v2-mod-coordinator-review-r2.md`) left three items open; their state now:

- **H2, recent-sibling artifact identity: repaired.** The coordinator writes the request identity into
  the run manifest and `verdict.json`, the runner puts it on the status, and the mod shows a result only
  when the operation, status and artifact identities match exactly (`hooks/mod/operation.ts`,
  `bindingProblem`). Proven by `tests/mod/register.test.tsx` (recent and future same-context siblings
  for other work or inputs refused; overlapping operations). Mock host.
- **M3, preparation versus launch: repaired.** The launch budget counts from `launchedAt`, which is null
  while preparing, so slow preparation is never reported as a dead runner; once the budget elapses the
  pane says completion and cleanup are unknown and keeps a best-effort Stop. Proven by
  `tests/mod/start.test.tsx` (delayed file, store and pane operations) and `register.test.tsx` (reload
  during preparation). Mock host.
- **H1, marketplace distribution: redone under the 2026-10-18 rule that `node_modules` is never
  committed or shipped.** The marketplace entry selects `releases/test-lab`, a build without tests and
  without any `node_modules` (release.json schema 2). Each installed copy installs its one runtime
  dependency (TypeScript 6.0.3) with `node scripts/install-runtime.ts`, which runs `npm ci` in the copy's
  own `kit` folder from `kit/package-lock.json` with lifecycle scripts off. Until then the runner's probe,
  the runner and the pane refuse to start and print that command with the copy's path.
  - `tests/ts/release.test.ts`: the selected directory, copied from the Git index to an isolated folder
    with an empty npm cache and offline, holds no `node_modules`, names its install step, refuses a
    request, installs nothing, passes `claude plugin validate`, and its mod imports stay inside the copy.
    A release tree holding any `node_modules` (top level, `kit`, nested, or listed in release.json)
    fails `releaseProblem` and the drift gate, which `npm run check:release` runs.
  - `tests/install/release-install.test.ts` (`npm run test:install`): a fresh copy of the selected
    release reaches a working state by the documented step, run offline from this machine's npm cache:
    only `kit/node_modules` is written, the runtime probe reports ready, the CLI, coordinator and kit load
    from the copy's own parser, and the runner hands a request to the CLI's parser. With an empty cache
    the step fails with `npm ci in <copy>/kit failed: npm error ...` and the copy still refuses to run.
    This gate needs the locked tarball in the npm cache (run `npm ci` once in `kit/`); it never uses
    the network. A real marketplace install (`/plugin install`) followed by the step was not run.
  - The earlier core failures (the parser tarball missing from the npm cache) are gone: the build no
    longer reads the cache. The staged `releases/test-lab/node_modules` was removed from the index, and
    the repository root `.gitignore` now ignores `node_modules/`.

Gates on 2026-10-18, run from `test-lab/` unless noted (logs in `/tmp/tl-gates-20261018/`):

| Gate | Result |
|---|---|
| `npm test` (default parallel) | 533/534 twice; the one failure is environmental, see below |
| `node --test --test-concurrency=1 tests/ts/*.test.ts` | 534/534 twice |
| `npm run test:install` | 3/3 (precondition, install to working state, clear failure with an empty cache) |
| `npm run test:playwright` (concurrency 1) | 111/111 passed in 1,000 s |
| `npm run typecheck` | 4/4 (core; kit on Playwright 1.58.2 and 1.60.0 types; mod against the SDK declarations) |
| `npm run test:mod` | 68/68 |
| `python3 -m unittest tests/test_triage_cases.py` | 5/5 |
| `npm run check:release` | passed: release matches source and manifest, no `node_modules` |
| `claude plugin validate` on `test-lab`, `releases/test-lab` and the repository root | all three passed, no advice left (the README now has the install line) |

The Playwright gate ran while only documentation (README, CHANGELOG, this file) was still being
edited; no code changed after it. No `ps` permission error occurred in this run.

**The one core failure is the sandbox, not the product.** `command adapter abort stops its owned
descendant and preserves unrelated process` (`tests/ts/coordinator-r1.test.ts`) failed in both default
parallel `npm test` runs with: `local adapter operation interrupted/aborted; adapter tree cleanup could
not be confirmed: process group N was signalled, but its termination could not be verified:
kill(group,0) was refused and /bin/ps failed (EPERM)`. Diagnostics (`/tmp/tl-gates-20261018/`):
- `ps-diagnostics.log`: in this agent sandbox, executing `/bin/ps` is denied outright, from the shell
  (`operation not permitted: /bin/ps`) and from Node (`spawnSync` error `EPERM`). The product's
  confirmation fallback after a refused `kill(group,0)` is `ps`, so it can never confirm here.
- `adapter-abort-repeat.log`: the abort and timeout tests alone, 8 of 8 runs passed;
  `coordinator-r1-file-repeat.log`: the whole file, 3 of 3 passed; `core-serial.log`: the whole core
  suite with concurrency 1, 534/534 twice. The refused `kill(group,0)` appears only under parallel load.
- The product behaves as designed: when cleanup cannot be verified it says so and never reports
  confirmed cleanup. The test is not weakened and `npm test` is not switched to serial to hide it.
  Outside the sandbox, with `ps` allowed, it is expected to pass; that was not run, because running
  outside the sandbox is a guard bypass.

Still not proven, and not provable by an agent here:

- No fresh independent review of the H2 and M3 repairs, or of the redone H1, has run. OpenAI models are
  unavailable until 2026-10-22, so per the plan it is Opus 5.5 or a reviewer the owner names.
  gap-rdu.4 should not close before it.
- Live terminal and Desktop: the rebuilt mod has not been loaded live; Desktop loading, rendering and
  the report opener on Desktop have never been checked.
- A real host-driven `run`, report opening and clipboard: earlier attempts were blocked by the nested
  sandbox (`sandbox-exec: sandbox_apply: Operation not permitted`); the guard is not bypassed.
- The phase 1 items listed under "Not proven by phase 0" above.
