# TypeScript scaffold (phase 1)

Node 24 runs the source with native type stripping. There is no compilation or bundling step.
Use erasable syntax and explicit `.ts` paths. The engine's existing `tsconfig.json` and
`types/index.d.ts` still own the pane; new code uses `tsconfig.src.json` independently.

## Install and run from a plain plugin copy

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-ts.ts"
# Compatibility option; setup still installs the complete dependency set:
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-ts.ts" --production
```

Setup copies the committed package manifest and lockfile into
`~/Library/Caches/design-lab/typescript/v2-<lock-hash>/` on macOS, or
`~/.cache/design-lab/typescript/v2-<lock-hash>/` elsewhere, and reuses a completed install
without mutation. First setup takes a per-key process lock,
runs `npm ci --include=dev` in a temporary sibling, writes `.design-lab-complete` only on success,
and atomically publishes the directory. Runtime and typechecking refuse unmarked installs.
The versioned namespace leaves older installations untouched. A failed install is cleaned up;
a killed setup's unpublished temporary folder can remain for inspection, and the next setup
recovers the dead owner's lock. An unmarked target is preserved as an `.incomplete` sibling.
Live locks time out after two minutes rather than being stolen.

Both normal setup and `--production` retain development packages so another checkout's compiler
cannot be removed. Nothing is installed into the plugin. `DESIGN_LAB_CACHE` overrides the root
and must be an absolute path, such as `/tmp/design-lab-cache`; relative paths and literal `~`
produce an actionable error. Use `$HOME` expansion if you want a home-relative shell path.
The separate lock-addressed folder avoids changing its existing unpinned `playwright/` cache.
Browser binaries retain Playwright's normal cache / `PLAYWRIGHT_BROWSERS_PATH`; setup does
not download browsers. A later capture phase must explicitly provision Chromium.

Direct scripts use the resolver in `src/runtime.ts`:

```ts
import { sharedRequire } from '../src/runtime.ts';
const { chromium } = sharedRequire()('playwright') as typeof import('playwright');
```

This permits `node "${CLAUDE_PLUGIN_ROOT}/scripts/x.ts"` from any cwd. Type-only imports
resolve through the development typecheck overlay and disappear at runtime. For entrypoints
that use ordinary bare ESM imports, the launcher registers Node resolution hooks before
importing the entrypoint, preserving each dependency's ESM export conditions:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/launch.ts" scripts/x.ts [args...]
```

Only bare imports originating in plugin source are redirected to the pinned installation.
Parents inside `node_modules` keep normal resolution, including nested dependency versions.
Node builtins, relative imports, URLs and package-private `#` imports retain normal resolution.

## Contracts

`schemas/*.schema.json` is the source of truth. `src/generated/*.ts` and `ArtifactMap` are
committed derivatives, generated with `json-schema-to-typescript`; do not edit them directly.
Ajv 2020 validates those same schemas without coercion, defaults or removing fields. This
is the only extra runtime dependency beyond Playwright and Sharp. It implements the existing
conditional, reference and union schemas without a second handwritten validator. Generated
TypeScript expresses structural types; runtime constraints such as ranges, cardinality and
conditional requirements remain enforced by schemas.

```ts
import { validate, assertValid, writeJson } from '../src/contracts.ts';
const errors = validate('progress', value); // [] or readable JSON Pointer errors
assertValid('progress', value);            // throws; narrows value to ArtifactMap['progress']
writeJson('/run/progress.json', value);     // serialize, sibling temp, fsync, atomic rename
```

The original 13 kinds and the formerly unschematized boundaries are included. Runner contracts
cover `/next` replies (and driver forms), query parameters, direct `/record` bodies and replies,
and `/error` bodies and replies. Tokens are transient query parameters, never durable artifacts.
A record is the result object itself; it does not contain an added `step`/`result` envelope.
Skipped results are `{}`; check results include font-family arrays, dumps keep their exported
fields, and screenshots carry base64 `png`. The server writes the screenshot's comparison
result separately as a step result. Schema openness preserves historical extension fields.

Historical details are intentional: `accepts` can be a legacy bare string, unbound color `var`
is null, automatic text labels can omit dimensions, fonts can be unchecked/variable/icon stacks,
pre-init state can contain only `fileKey`, and derived specs need not have `extractedAt`.
Contract validation describes serialized structure. Python's workflow policy checks (duplicate
ids, completed comparisons, row-count reconciliation, etc.) still run in Python until ported;
this phase does not merge policy validation into serialization contracts.

## Development and checks

```sh
export DESIGN_LAB_CACHE=/tmp/design-lab-p1-cache
npm run setup
npm run contracts:generate
npm run contracts:check
npm run typecheck
npm test
npm run contracts:reality
npm run benchmark:check-js
```

`typecheck` executes `tsc --noEmit -p` for both `tsconfig.src.json` and `tsconfig.figma.json`
using temporary overlays. The existing CI `npm run typecheck` step therefore checks both.
Node code is discovered recursively under `src/`, `scripts/`, `templates/`, and `tests/ts/`.
Figma code has its own includes under `src/figma/`, `scripts/render/`, `runner/`, and
`templates/figma/`; those folders are excluded from the Node config. Figma uses only the
ES2024 library and `@figma/plugin-typings`, with no Node globals. Its ambient API is also
an overlay input so the check succeeds before the first Figma TS source exists.
`node scripts/ts-tool.ts check-figma` checks only that environment. The pane's engine-owned
`tsconfig.json`, hooks, and pane types remain separate.
The overlays map exact package types from the shared cache; only the Node overlay loads
`@types/node`. Both preserve strict,
`noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `verbatimModuleSyntax`,
`allowImportingTsExtensions`, and `noEmit`. It deletes the overlay afterward. No symlink or
`node_modules` directory is needed in the plugin. `npm run` does not install dependencies.

`contracts:reality` scans the six study folders read-only, recursively including historical
captures and replays. Each matching file is reported; JSONL entries are checked individually.
Optional positional roots replace the defaults; `--json` emits per-file evidence. Screenshot
manifests at `capture*/shots/index.json` and verification dumps named `state.json` are different
artifacts and do not masquerade as library index or build state.

`benchmark:check-js` is an intentionally failing evidence command, separate from CI gates. It
checks unchanged `runner/code.js`, `scripts/render/*.js`, and `scripts/*.mjs` with Node, DOM,
and Figma typings; implicit-any inference is allowed to avoid turning the metric into a
missing-JSDoc count. Function-body templates are checked as raw modules, so missing payload
names and top-level returns are context diagnostics, not proven execution bugs. Its diagnostic
list and limitations are recorded in the phase 1 report. No existing JS/Python is rewritten.

Node tests exercise real artifact excerpts (arrays capped at three entries and local paths
replaced with `/fixture`), all new boundaries, corruption, atomic replacement, failed-write
cleanup, scanner matching, Sharp pixels and copied-plugin launch from an unrelated directory.
Regression tests cover nested ESM
versions/default exports, absolute cache paths, concurrent setup, failure and interruption,
immutable reuse, media-only tokens/arbitrary string modes, future Node entrypoint discovery,
and the Figma environment's exclusion of Node globals.
They perform no browser navigation or Figma actions. CI keeps the Python job and adds the
Node 24 contract drift/typecheck/test job; real corpus data is a local acceptance gate.
