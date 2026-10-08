# TypeScript runtime and development

The plugin requires **Node 24 or later**. Node runs the source directly with native type stripping; there is no build or bundle step and no dependency installation in a site or plugin. Only erasable TypeScript syntax is used. The Figma templates are stripped when payloads are assembled, and the Figma runner is stripped when copied to the person's runner folder.

## Set up a plain plugin copy

Run this once, from any working directory:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/lab_setup.ts" install playwright
```

This single command installs the complete pinned package set from `package-lock.json` and Playwright Chromium, then records their locations in personal configuration. Sharp reads, writes and rasterizes images; YAML reads site configuration; Ajv validates artifact contracts. The same install includes TypeScript and the Node/Figma typings for development checks. There are no additional runtime packages to install. `design-lab:init` guides the person through the remaining personal choices (run placement, optional operator, runner import, and optional corpus/scoreboard). A run with an explicit `--workspace` needs no run-placement configuration. Importing or executing Figma code is never part of dependency setup.

Development pins the native TypeScript 7 compiler as `@typescript/native` and runs both project typechecks through its `tsc`. Typed ESLint resolves `typescript` to the official `@typescript/typescript6` compatibility API package because TypeScript 7.0 does not expose a programmatic API yet. This is the TypeScript team's documented side-by-side setup for tools such as typescript-eslint; it keeps TypeScript 7 as the compiler while giving those tools the TypeScript 6 API they require. When TypeScript 7's new API is supported by typescript-eslint, the compatibility alias can be removed.

Packages live in a lock-addressed `typescript/v2-<lock-hash>/` directory under the shared cache: `~/Library/Caches/design-lab` on macOS, `~/.cache/design-lab` elsewhere. Chromium lives in `browsers/v2-<lock-hash>/` in that cache. `DESIGN_LAB_CACHE` overrides the cache root and **must be an absolute path**. `PLAYWRIGHT_BROWSERS_PATH` can name a separate absolute browser directory; setup and runtime use the same value. `DESIGN_LAB_BROWSER_EXECUTABLE` can select an already provisioned browser executable.

For an isolated proof or test, use absolute `/tmp` paths:

```sh
export DESIGN_LAB_CACHE=/tmp/design-lab-cache
export DESIGN_LAB_HOME=/tmp/design-lab-home
node /path/to/plugin/scripts/lab_setup.ts install playwright
node /path/to/plugin/scripts/workflow.ts --help
```

`DESIGN_LAB_HOME` isolates runner files, token and active-run pointer. When it is set, the personal configuration defaults to `<DESIGN_LAB_HOME>/config.json`; otherwise it defaults to `~/.claude/design-lab.json`. `DESIGN_LAB_CONFIG` explicitly overrides that file. Relative `DESIGN_LAB_HOME` overrides are rejected. No token is printed by setup.

Both package and Chromium publication use a per-target process lock and temporary sibling install, with atomic rename after success. Failed installs publish nothing; completed package installs are reused without mutation. Dead-owner locks recover, live locks time out after two minutes, and incomplete targets are preserved for inspection. Browser setup also checks the pinned executable before reusing an install. `setup-ts.ts` installs packages only; `setup-ts.ts --chromium` adds the browser without changing personal settings. The compatibility `--production` option retains development packages in the immutable shared install. On Linux, Playwright also needs operating-system browser libraries. CI runs `node scripts/setup-browser-deps.ts` for those libraries; ordinary setup never invokes sudo.

All scripts resolve dependencies from this cache independently of cwd. A site needs no `node_modules`, symlink, or npm install. `workflow.ts preflight --node-cwd` is still accepted for command compatibility, and only changes which folder the preflight Playwright check probes; capture ignores it and uses the pinned shared dependency resolver.

## Commands and contracts

The front door is `node scripts/workflow.ts <subcommand>`. All **24** baseline workflow subcommands and flags are retained (the study counted 25). Discovery, build, scoring and verification run in process. Existing script command names have TS entrypoints, including `figma_build.ts`, `figma_runner.ts`, `capture_all.ts`, `lab_setup.ts`, `score_run.ts`, `verify.ts`, `corpus.ts` and `scoreboard.ts`.

`schemas/*.schema.json` is the source of truth. `src/generated/*.ts` and `ArtifactMap` are committed derivatives. Ajv validates the same schemas without coercion or defaults. `src/artifact-policy.ts` enforces cross-field acceptance rules: duplicate identities, row counts, published capture links and complete comparison verdicts. `writeJson` serializes before writing, fsyncs a private sibling file and atomically replaces its target.

```sh
npm run setup
npm run contracts:generate
npm run contracts:check
npm run typecheck
npm test
npm run contracts:reality
```

`typecheck` checks **tsconfig.src.json and tsconfig.figma.json**, using temporary overlays with types resolved from the shared cache. The pane retains the host-owned `tsconfig.json`. Both development configs also enable `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch` and `useUnknownInCatchVariables`. Optional artifact fields are omitted when absent; explicit `null` keeps its recorded meaning. `npm test` runs `node --test` across both `tests/ts` and the four browser consent tests; `npm run test:unit` selects only unit tests. No tests silently skip when Chromium is missing. `tests/keep-coverage.json` maps all 330 retained baseline scenarios to their TS suites; related scenarios can share a behavioral test. The 34 output-equivalence scenarios use the on-demand frozen-run harnesses below. The 132 obsolete cases were removed.

CI uses Node 24, cached lockfile installation, both typechecks, contract drift and Node/browser tests. It then installs the pinned Claude Code CLI (`@anthropic-ai/claude-code@2.1.293`) and runs `claude plugin validate .` and `node scripts/test-mod.ts` (which stages the mod-only tests under `/tmp` and invokes `claude plugin test` there; the host cannot load Node test files). Both run without login and need no secret; a missing CLI fails the job. Bump the pinned version deliberately and rerun both commands locally after a bump. Equivalence harnesses and the local six-site reality scan are separate acceptance gates and are not run in CI. `benchmark:check-js` is a diagnostic over the original JavaScript, read from the baseline checkout: it needs `DESIGN_LAB_ORACLE_ROOT` and checks no file shipped in this plugin. It reports exactly the 156 diagnostics triaged in `tests/fixtures/checkjs-triage.json` (the baseline templates are checked as ES modules, because they run inside an async function body) and is not a CI gate.

## Verified and not yet verified

The port reproduces the previous release's results where they were compared. It has not run end to end on a live Figma file. Keep this list in step with `CHANGELOG.md`.

Verified against the previous release (the read-only baseline checkout):
- Component trees and Figma payloads, on 202 recorded specs.
- Driver replay of two recorded builds, 293 and 101 steps.
- Component and token discovery on five repositories, and on two live local sites.
- Sequential CLI walks through capture on PNCB and DEFINITIVE, with the same approved inputs and browser version across three frozen implementations; see "Workflow timing" below.
- Six scorecards and reports, with pixel-identical thumbnails.
- Every baseline workflow subcommand (24 of 24) and flag (44 of 44), and every skill, command, reference and hook, has a TypeScript counterpart.

Checked only on synthetic or replayed data:
- A recorded driver transcript for one real library.
- Canvas usage, from a replay of the Structured Query Language (SQL) queries and never a real Canvas database.
- Fonts, from injected Adobe kit responses.
- The runner protocol, from a fake client over HTTP; no Figma code ran.

Not yet verified:
- A live Figma build with the new runner protocol and the per-step inventory refresh.
- A fresh whole-file verification for two real libraries.
- A continuous integration (CI) run on GitHub's x86_64 Ubuntu runner. The workflow steps pass in a native arm64 Debian container with Node 24; the x86_64 Claude Code CLI binary and `scripts/setup-browser-deps.ts` have not run on a real runner.
- A `.ts` skill invoked from an installed copy of the plugin, on either Claude account.
- Any invocation from Codex.

Release gates: a stage-2 build on a live Figma file with the new runner, a CI run on a pull request, and one `.ts` skill run from an installed copy on each Claude account.

### Workflow timing — 2026-10-08

The observed workflow through capture was faster in the final TypeScript implementation. These totals sum the timed CLI invocations through capture; they exclude setup, output comparison and Figma builds. Each implementation used the same approved selections and plan decisions, isolated caches/homes and Playwright 1.63.0 with the same Chromium revision. No other agent or benchmark task ran alongside a timed command.

| Local site | Original Python A | Improved Python B | TypeScript C | C versus A | C versus B |
| --- | ---: | ---: | ---: | ---: | ---: |
| PNCB, mean of two samples | 1157.524 s | 531.113 s | 339.752 s | 3.41× | 1.56× |
| DEFINITIVE, one sample | 1701.100 s | 779.935 s | 450.483 s | 3.78× | 1.73× |

A is `4176de29`, B is `d836d3a9` with concurrency 4, and C is `1d79e165` with concurrency 4. B's architecture changes already improve the baseline by about 2.18×. C also changes capture scheduling, so this comparison measures the implementations, not an isolated effect of the programming language.

The owner's explicit go-ahead waived the original load-below-4 waiting gate. Every one-minute start load remained above that gate (13.12–27.15), and all were recorded. PNCB ran A/B/C then C/B/A; DEFINITIVE ran B/C/A. The one-sample DEFINITIVE result retains an uncorrected fresh-cache/order bias. Earlier overloaded stage-1 timings and the initial pilot with a different Playwright version are excluded.

Components, tokens and variable plans matched across arms. All 84 PNCB PNGs were byte-identical across arms and repeats; measurement specs matched after a secondary comparison normalized only Drupal's random view-instance class. On DEFINITIVE, A/C differed in 4 of 195 PNGs, and some measurements had subpixel geometry differences. All approved build inputs have captures, but every capture CLI also reported refusals for components without examples or visible selectors. Final Figma output equality and build timing remain unmeasured. The owner runbook provides six fresh-file builds, one per site and implementation; their completion is pending.

Evidence is retained outside the plugin repository in `analysis-reports/design-lab-bench-final-2026-10-08.md` and `analysis-reports/design-lab-figma-runbook-2026-10-08.md` at the project workspace root, with raw commands, timings, comparisons and checkpoints under `/tmp/design-lab-bench-final`. The original Python, improved Python and measured TypeScript worktrees remain unchanged.

## On-demand comparison with the saved baseline

The **external Python oracle** is simply a read-only checkout of the previous implementation. It supplies the reference results for migration comparisons; it is not used by the plugin, ordinary Node tests, or CI. Fresh on-demand oracle regression tests require the prepared interpreter. No `.py` file ships in this plugin. TS harness launchers materialize their small baseline adapters under `/tmp`, invoke the external interpreter, and import only from the external checkout. Bytecode writes there are disabled.

`DESIGN_LAB_ORACLE_ROOT` accepts the absolute **plugin directory** containing `scripts/`, or its parent checkout containing `design-lab/scripts/`. Its default is `/Users/Chris.Weber/Tools/CLAUDE-PLUGINS/worktrees/design-lab-oracle/design-lab`, in the read-only detached checkout at `4176de29`. `DESIGN_LAB_PYTHON` selects its prepared interpreter and defaults to `/tmp/dl-venv/bin/python` (**Python 3.14.8**). Pin the patch version: `html.parser` comment handling differs between Python 3.14 patch releases (including 3.14.5 and 3.14.8). It needs the baseline's Pillow, CairoSVG and YAML dependencies. Harnesses compare copied runs and write only under `/tmp`.

```sh
export DESIGN_LAB_ORACLE_ROOT=/path/to/read-only/baseline-checkout
export DESIGN_LAB_PYTHON=/path/to/prepared/baseline-venv/bin/python
node --test tests/equivalence/oracle-tests/*.test.ts
node tests/equivalence/driver.ts
node tests/equivalence/trees.ts
node tests/equivalence/runner-smoke.ts /tmp/driver-replay-root
node tests/equivalence/evaluation.ts /tmp/evaluation-results
node tests/equivalence/auxiliary.ts /tmp/evaluation-results
node tests/equivalence/determinism.ts /tmp/evaluation-results
node tests/equivalence/tier1.ts /tmp/evaluation-results
node tests/equivalence/discovery.ts /tmp/discovery-results
node tests/equivalence/oracle-cli.ts discovery-compare /tmp/discovery-results
```

Former standalone adapter commands are `node tests/equivalence/oracle-cli.ts <adapter-name> [args...]`; the name omits its old suffix. Discovery's optional live harness needs the site's already running DDEV environment. The baseline checkout is always read-only.

Comparisons retain the reviewed protocol/cache/runtime differences from phases 2–4. Phase 5 adds only pinned substitutions for generated command text (`workflow`, `figma_build`, `score_run` suffixes), and generator/tool-version provenance from 0.23.2 to 0.24.0. They do not ignore counts, scores, findings, pixels or executable behavior. Report JSON ignores only `generatedAt` and measured `scorerSeconds`, as before. Missing saved whole-file dumps remain explicitly unmeasured for PNCB and Kingtec.

For a CLI server smoke, `figma_runner.ts serve --project RUN --port 0` binds an isolated random port and prints it. The production runner retains port 8765. The standalone `tests/equivalence/http-client.ts --project RUN --source COPIED_SAVED_RUN --transcript DRIVER_ORACLE_JSON --port PORT` replays saved responses through `/next`, `/file` and `/record` until done. It decodes and compares served images and performs no Figma actions or baseline interpreter calls. Run `figma_build.ts receipts --project RUN`, then `score_run.ts RUN` to produce the benchmark HTML and completion message from the replayed result.
