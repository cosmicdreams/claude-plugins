# TypeScript runtime and development

The plugin requires **Node 24 or later**. Node runs the source directly with native type
stripping; there is no build or bundle step and no dependency installation in a site or plugin.
Only erasable TypeScript syntax is used. The Figma templates are stripped when payloads are
assembled, and the Figma runner is stripped when copied to the person's runner folder.

## Set up a plain plugin copy

Run this once, from any working directory:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/lab_setup.ts" install playwright
```

This single command installs the complete pinned package set from `package-lock.json` and
Playwright Chromium, then records their locations in personal configuration. Sharp reads,
writes and rasterizes images; YAML reads site configuration; Ajv validates artifact contracts.
The same install includes TypeScript and the Node/Figma typings for development checks.
There are no additional runtime packages to install. `design-lab:init` guides the person
through the remaining personal choices (run placement, optional operator, runner import,
and optional corpus/scoreboard). A run with an explicit `--workspace` needs no run-placement
configuration. Importing or executing Figma code is never part of dependency setup.

Packages live in a lock-addressed `typescript/v2-<lock-hash>/` directory under the shared
cache: `~/Library/Caches/design-lab` on macOS, `~/.cache/design-lab` elsewhere. Chromium
lives in `browsers/v2-<lock-hash>/` in that cache. `DESIGN_LAB_CACHE` overrides the cache root
and **must be an absolute path**. `PLAYWRIGHT_BROWSERS_PATH` can name a separate absolute
browser directory; setup and runtime use the same value. `DESIGN_LAB_BROWSER_EXECUTABLE`
can select an already provisioned browser executable.

For an isolated proof or test, use absolute `/tmp` paths:

```sh
export DESIGN_LAB_CACHE=/tmp/design-lab-cache
export DESIGN_LAB_HOME=/tmp/design-lab-home
node /path/to/plugin/scripts/lab_setup.ts install playwright
node /path/to/plugin/scripts/workflow.ts --help
```

`DESIGN_LAB_HOME` isolates runner files, token and active-run pointer. When it is set, the
personal configuration defaults to `<DESIGN_LAB_HOME>/config.json`; otherwise it defaults
to `~/.claude/design-lab.json`. `DESIGN_LAB_CONFIG` explicitly overrides that file.
Relative `DESIGN_LAB_HOME` overrides are rejected. No token is printed by setup.

Both package and Chromium publication use a per-target process lock and temporary sibling
install, with atomic rename after success. Failed installs publish nothing; completed package
installs are reused without mutation. Dead-owner locks recover, live locks time out after two
minutes, and incomplete targets are preserved for inspection. Browser setup also checks the
pinned executable before reusing an install. `setup-ts.ts` installs packages only;
`setup-ts.ts --chromium` adds the browser without changing personal settings. The compatibility
`--production` option retains development packages in the immutable shared install.
On Linux, Playwright also needs operating-system browser libraries. CI runs
`node scripts/setup-browser-deps.ts` for those libraries; ordinary setup never invokes sudo.

All scripts resolve dependencies from this cache independently of cwd. A site needs no
`node_modules`, symlink, or npm install. Capture's old `--node-cwd` flag remains accepted
for command compatibility; normal capture uses the pinned shared dependency resolver.

## Commands and contracts

The front door is `node scripts/workflow.ts <subcommand>`. All **24** baseline workflow
subcommands and flags are retained (the study counted 25). Discovery, build, scoring and
verification run in process. Existing script command names have TS entrypoints, including
`figma_build.ts`, `figma_runner.ts`, `capture_all.ts`, `lab_setup.ts`, `score_run.ts`,
`verify.ts`, `corpus.ts` and `scoreboard.ts`.

`schemas/*.schema.json` is the source of truth. `src/generated/*.ts` and `ArtifactMap` are
committed derivatives. Ajv validates the same schemas without coercion or defaults.
`src/artifact-policy.ts` enforces cross-field acceptance rules: duplicate identities,
row counts, published capture links and complete comparison verdicts. `writeJson` serializes
before writing, fsyncs a private sibling file and atomically replaces its target.

```sh
npm run setup
npm run contracts:generate
npm run contracts:check
npm run typecheck
npm test
npm run contracts:reality
```

`typecheck` checks **tsconfig.src.json and tsconfig.figma.json**, using temporary overlays
with types resolved from the shared cache. The pane retains the host-owned `tsconfig.json`.
`npm test` runs `node --test` across both `tests/ts` and the four browser consent tests;
`npm run test:unit` selects only unit tests. No tests silently skip when Chromium is missing.
`tests/keep-coverage.json` maps all 330 retained baseline scenarios to their TS suites;
related scenarios can share a behavioral test. The 34 output-equivalence scenarios use the
on-demand frozen-run harnesses below. The 132 obsolete cases were removed.

CI uses Node 24, cached lockfile installation, both typechecks, contract drift and Node/browser
tests. It then installs the pinned Claude Code CLI (`@anthropic-ai/claude-code@2.1.293`) and runs
`claude plugin validate .` and `node scripts/test-mod.ts` (which stages the mod-only tests under `/tmp` and invokes
`claude plugin test` there; the host cannot load Node test files). Both run without login and need no secret; a missing
CLI fails the job. Bump the pinned version deliberately and rerun both commands locally after a bump. Equivalence harnesses and the local six-site reality scan are separate
acceptance gates and are not run in CI. `benchmark:check-js` remains a diagnostic command
for the older JS sources, with its known context diagnostics; it is not a CI gate.

## On-demand comparison with the saved baseline

The **external Python oracle** is simply a read-only checkout of the previous implementation.
It supplies the reference results for migration comparisons; it is not used by the plugin,
ordinary Node tests, or CI. Fresh on-demand oracle regression tests require the prepared interpreter. No `.py` file ships in this plugin. TS harness launchers materialize
their small baseline adapters under `/tmp`, invoke the external interpreter, and import only
from the external checkout. Bytecode writes there are disabled.

`DESIGN_LAB_ORACLE_ROOT` accepts the absolute **plugin directory** containing `scripts/`,
or its parent checkout containing `design-lab/scripts/`. Its default is
`/Users/Chris.Weber/Tools/CLAUDE-PLUGINS/worktrees/design-lab-oracle/design-lab`, in the
read-only detached checkout at `4176de29`. `DESIGN_LAB_PYTHON` selects its prepared
interpreter and defaults to `/tmp/dl-venv/bin/python` (**Python 3.14.8**). Pin the
patch version: `html.parser` comment handling differs between Python 3.14 patch releases
(including 3.14.5 and 3.14.8). It needs the baseline's Pillow,
CairoSVG and YAML dependencies. Harnesses compare copied runs and write only under `/tmp`.

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

Former standalone adapter commands are `node tests/equivalence/oracle-cli.ts <adapter-name>
[args...]`; the name omits its old suffix. Discovery's optional live harness needs the site's
already running DDEV environment. The baseline checkout is always read-only.

Comparisons retain the reviewed protocol/cache/runtime differences from phases 2–4. Phase 5
adds only pinned substitutions for generated command text (`workflow`, `figma_build`,
`score_run` suffixes), and generator/tool-version provenance from 0.23.2 to 0.24.0.
They do not ignore counts, scores, findings, pixels or executable behavior. Report JSON ignores
only `generatedAt` and measured `scorerSeconds`, as before. Missing saved whole-file dumps
remain explicitly unmeasured for PNCB and Kingtec.

For a CLI server smoke, `figma_runner.ts serve --project RUN --port 0` binds an isolated
random port and prints it. The production runner retains port 8765. The standalone
`tests/equivalence/http-client.ts --project RUN --source COPIED_SAVED_RUN --transcript
DRIVER_ORACLE_JSON --port PORT` replays saved responses through `/next`, `/file` and `/record`
until done. It decodes and compares served images and performs no Figma actions or baseline
interpreter calls. Run `figma_build.ts receipts --project RUN`, then `score_run.ts RUN` to
produce the benchmark HTML and completion message from the replayed result.
