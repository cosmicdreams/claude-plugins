# design-lab phase 2 port — 2026-10-07

**Partial implementation; gap-ffo.7 stays open.** Capture, flat/responsive trees, compact payload assembly, Sharp asset fetching and nesting utilities are implemented and validated. The TypeScript build driver and Figma-side ports are not implemented. This is a local handoff under the task's quality/scope fallback, not a claim that phase 2 is accepted.

Worktree: `/Users/Chris.Weber/Tools/CLAUDE-PLUGINS/worktrees/design-lab-ts`; branch: `feat/design-lab-typescript`; base: `5714b1d1`. Node `v24.14.0`, Python `3.14.5`, lock-addressed dependencies under `DESIGN_LAB_CACHE=/tmp/design-lab-p1-cache`. Node 24 + Sharp, not Bun. The reference checkout, Arm B worktree, installed plugin caches, `~/.design-lab` and original run inputs were not changed. No Figma actions, push or PR. Existing Python and JS remain the oracle; skills are unchanged.

## Implemented behavior and changed files

- Capture: one Chromium launch across selector checks, measurements and screenshots; bounded pool (default 4), isolated contexts, ordered outcomes, per-component checkpoint records and per-step millisecond timings. Resume/config invalidation, legacy script-hash migration, `--only`, `--fresh`, selector-check mode and bounded page fallback are supported. Qualified component IDs prevent equal machine names overwriting one another. Measurement/walk/cookie/mask behavior retains the original/Arm B semantics. Twig tagging, config scaffolding, child subtree/crop derivation, relationships, evidence assembly and the narrow capture registry boundary run in-process.
- Geometry: flat and responsive conversion preserve stacking, absolute decorations, masks, native vectors, hidden/reordered child slots, grid/flex inference, layout tolerance and variable bindings. Exact Python half-even rounding and subtraction grouping are retained where geometry depends on them.
- Payloads: compact shared text styles and padding, strip defaults/source metadata, sorted ASCII arguments and UTF-16 FNV checksum; renderer caches loaded templates per instance. TypeScript snippet stripping uses Node `module.stripTypeScriptTypes` inside an async wrapper. Existing Figma templates are still JS; no production TS Figma template is supplied yet.
- Images: Node HTTP(S), redirects/retries, local development TLS behavior, public fallback and frozen/offline cache lookup; Sharp rasterizes SVG/WebP and preserves accepted PNG/JPEG/GIF bytes. No driver integration or full asset-manifest equivalence claim.

Changed files (relative to the feature worktree):

- `design-lab/src/capture.ts`
- `design-lab/src/capture/browser.ts`
- `design-lab/src/capture/cookies.ts`
- `design-lab/src/capture/derive.ts`
- `design-lab/src/capture/evidence.ts`
- `design-lab/src/capture/masks.ts`
- `design-lab/src/capture/pool.ts`
- `design-lab/src/capture/register.ts`
- `design-lab/src/capture/run.ts`
- `design-lab/src/capture/scaffold.ts`
- `design-lab/src/capture/selectors.ts`
- `design-lab/src/capture/twig-scripts.ts`
- `design-lab/src/capture/twig.ts`
- `design-lab/src/capture/types.ts`
- `design-lab/src/capture/walk.ts`
- `design-lab/src/fetch-images.ts`
- `design-lab/src/json.ts`
- `design-lab/src/nesting.ts`
- `design-lab/src/render-payload.ts`
- `design-lab/src/responsive.ts`
- `design-lab/src/spec-to-tree.ts`
- `design-lab/tests/browser/cookies.test.ts`
- `design-lab/tests/equivalence/capture-cli.ts`
- `design-lab/tests/equivalence/capture.ts`
- `design-lab/tests/equivalence/keep-oracle.py`
- `design-lab/tests/equivalence/trees-oracle.py`
- `design-lab/tests/equivalence/trees.ts`
- `design-lab/tests/ts/capture.test.ts`
- `design-lab/tests/ts/fetch-images.test.ts`
- `design-lab/tests/ts/p2-fixtures.ts`
- `design-lab/tests/ts/spec-tree.test.ts`
- `design-lab/tsconfig.src.json`
- `analysis-reports/design-lab-p2-port-2026-10-07.md` (this report; copied to the user-requested root report path).

## Local commits

```
aa6f4cfa feat(design-lab): capture with one Chromium and a bounded page pool
7f16d14c feat(design-lab): fetch build images with Sharp
6166b0d5 feat(design-lab): port measured trees and payload assembly to TypeScript
```

A separate documentation commit records this report; its hash is reported at handoff. No push.

## Acceptance results

| Check | Result | Limit |
|---|---|---|
| 1. Every component spec → tree | 202/202 flat; 199/199 producible responsive trees deep-equal | Three original specs cannot produce a Python responsive tree; TS also rejects them. No silent skipped success. |
| 2. Tree → payload | 199 compact ARGS and `build_responsive` host payloads match exactly | Component tree/variables fixture envelope, not the unported driver's complete metadata/font/alternate envelope. Figma template code remains the unchanged JS oracle; real TS template stripping equivalence is outstanding. |
| 3. Driver replay | **Not implemented/run** | Full DEFINITIVEHC and PNCB init/next/record sequence and payload replay remains required. |
| 4. PNCB capture | Pass for five components × three widths at concurrency 1 and 4 | Actual TS CLI vs independently captured Python/mjs specs/indexes/pixels, plus independent Python evidence assembly on the same index/files. Frozen configs; real-site scaffold/selector/registry end-to-end equivalence is not claimed. |
| 5. Compiler/tests | Src and all new tests/harnesses compile; Node and Python tests green | Figma TS sources are missing. The old JS oracle still reports all 156 checkJs diagnostics. Therefore the full check is incomplete. |

### Corpus details

All source specs were copied to `/tmp` before running producers. Each producer runs in-process in its own language. Flat and responsive trees are compared as decoded JSON without geometry normalization or tolerances. The only JSON number normalization is inherent JSON serialization of negative zero. Invalid-input comparison requires both producers to reject, without claiming identical exception classes/messages.

| Run | Components/specs | Flat exact | Responsive exact | Compact ARGS + payload exact | Both reject responsive |
|---|---:|---:|---:|---:|---:|
| pncb | 29 | 29 | 28 | 28 | 1 |
| definitive | 62 | 62 | 62 | 62 | 0 |
| massport | 34 | 34 | 34 | 34 | 0 |
| kingtec | 31 | 31 | 29 | 29 | 2 |
| acu | 46 | 46 | 46 | 46 | 0 |
| **Total** | **202** | **202** | **199** | **199** | **3** |

Oracle errors, retained rather than hidden:

- PNCB `paragraph__accordion_links.spec.json`: hidden root; Python `'NoneType' object does not support item assignment`; TS rejects invisible root.
- Kingtec `contact-layout.spec.json` and `contact-social-link.spec.json`: no usable default measurement root; Python `list index out of range`; TS rejects missing root.

No remaining mismatches. Scratch summary: `/tmp/design-lab-p2-trees-cZZkFz/summary.json`; log: `/tmp/design-lab-p2-trees.log`.

Producer/comparison wall times: TS **14.675s**, Python **32.923s**. These include conversion, compaction/payload generation and scratch I/O; TS also does assertions/repeated responsive construction. They are not full pipeline timings.

### Capture details

Site already running: `https://pncb-2026-merge.ddev.site`; no `ddev start` was necessary. Components: `paragraph:card`, `paragraph:icon_callout`, `paragraph:resource`, `paragraph:accordion`, `paragraph:cta_block`. Desktop/tablet/mobile, screenshot scale 1. Original `.mjs` commands run from the shared Playwright dependency folder. Specs ignore only `extractedAt`; screenshot indexes compare exactly after the same component-ID filename qualification used by the Python capture driver. Images compare decoded RGBA buffers and dimensions, with no tolerance. Evidence compares every field except `generatedAt` on the same index/files, so no path/hash fields are hidden. Ten record configuration hashes and complete statuses also match Python (`scale=1.0`).

| Producer/lane | Wall seconds | Specs exact | Indexes exact | Images pixel-identical | Evidence |
|---|---:|---:|---:|---:|---|
| Original mjs control, separate measure/capture launches | 165.622 | baseline 5 | baseline 5 | baseline 15 | independent Python assembler |
| TS primitive pool, concurrency 1 | 160.533 | 5 | 5 | 15 | not assembled in that lane |
| TS primitive pool, concurrency 4 | 63.971 | 5 | 5 | 15 | not assembled in that lane |
| TS complete CLI, concurrency 1 | 162.871 | 5 | 5 | 15 | exact except timestamp |
| TS complete CLI, concurrency 4 | 65.226 | 5 | 5 | 15 | exact except timestamp |

CLI results: `/tmp/design-lab-p2-capture-cli-SCuT55/summary.json`; log `/tmp/design-lab-p2-capture-cli.log`. Primitive results and oracle fixtures: `/tmp/design-lab-p2-capture-fixtures/summary.json`. The initial primitive harness used Node's macOS temporary folder (`/var/folders/...`); it copied source configs before writing and left originals untouched. Fixtures were then copied to `/tmp`, and the harness was corrected to always create `/tmp` scratch folders. The complete CLI lane writes only in `/tmp`.

These are single measured runs against a warm local DDEV site, not statistical performance estimates. The control has ten browser launches; the TS CLI has one per run. Parallelism accounts for most of the capture improvement. Per-step measurements are stored in each scratch capture record.

## Tests and validation

| Suite | Tests | Passed | Skipped | Wall time |
|---|---:|---:|---:|---:|
| All fast Node tests (47 P1 + 67 P2) | 114 | 114 | 0 | 3.582s |
| P2 scope Node tests including consent browser lane | 71 | 71 | 0 | 12.715s |
| Browser lane alone, initial run | 4 | 4 | 0 | 13.000s |
| Python KEEP tests for the same ported modules/regressions | 57 | 57 | 0 | 16.170s |
| Existing full Python suite | 500 | 496 | 4 | 62.794s |

The Node and Python scope lanes cover the same ported modules and retained regressions; they do not have a one-to-one test count. Node adds pool/timeout isolation, config-hash serialization/migration, exact geometry rounding/tolerance, payload transit rejection/type stripping, and Sharp/network failure cases. The full Python run's four skips are the consent browser tests without their explicit environment; the separately configured KEEP lane runs all four successfully. No new Node test is skipped. No new DELETE fixture/snapshot/prose-shape tests were ported.

KEEP mapping in this partial slice:

- `tests/ts/spec-tree.test.ts`: flat color/CSS-variable/layout/BEM/name regressions; responsive visibility/reorder/stacking/wrap/grid/overflow regressions; all nine mask cases; shape/pseudo/rotation/translation/decorations; FNV plus rounding, layout tolerance, transit rejection and native type-strip regression.
- `tests/ts/capture.test.ts`: source preference/selectors and child example preference; bounded candidates, resume/evidence, changed configs, only/check/selector failure, no-check limit, qualified IDs; subtree/crop, Twig counting/namespace/marker behavior, children-first and variant/signature regressions; pool/timeout and record-hash migration additions.
- `tests/ts/fetch-images.test.ts`: recursive images/backgrounds, missing asset isolation, Sharp SVG conversion, frozen offline lookup/source exclusion; WebP, pass-through, HTTP redirect/non-retry/fallback, TLS host and symlink cases.
- `tests/browser/cookies.test.ts`: all four KEEP consent cases, using a real Chromium against an ephemeral local HTTP server.
- Remaining KEEP tests for the driver, font plan, native Figma builds, runner, receipts, counts/compare/index functions are not ported. Shared dependency setup remains P1/phase-5 scope. Canvas extraction/sync tests that call outside this slice were excluded from the Python scoped selector; the original full suite still covers them.

The Python scoped harness logs every selected test name at `/tmp/design-lab-p2-python-keep.log` and derives selection from the prune report. It deliberately excludes `build_responsive.ts` font/template tests, which are still pending.

`ts-tool.ts check` runs strict `tsc --noEmit` against src, existing P1 helpers and all new unit/browser/equivalence TS. Clean. `git diff --check` is clean. The intentional `check-js` baseline command still exits 1 with 156 diagnostics; it was not weakened/suppressed.

## Failures found and corrected

- Initial corpus run: two DEFINITIVEHC flat-tree differences at a layout tolerance boundary. Reproduced arithmetic associativity differences in `(offset + size)` subtraction; retained Python grouping and added a synthetic boundary test. Final corpus has no mismatches.
- Initial capture CLI evidence comparison: missing `sha256:` prefix and macOS `/tmp` symlink canonicalization. Corrected evidence/registry hashes and path resolution; final evidence comparisons pass without hiding those fields. Initial log preserved at `/tmp/design-lab-p2-capture-cli-initial-failure.log`.
- Record digest review: Python's argparse `float` scale serializes `1.0`; JS serializes `1`. Corrected the digest envelope and verified hardcoded oracle vectors plus 10 real PNCB records. Added legacy-hash upgrade coverage.
- Legacy migration initially rewrote a record whose current and legacy hash were equal, breaking the unchanged-record timestamp assertion. Require an actual hash change before writing. Final Node suite passes.
- Harness strict-typing errors (assert overload and Sharp buffer inference) and two trailing blank lines were corrected before the capture commit.

These are port/equivalence findings. They are **not** counted as bugs discovered by the 156 existing-JS TypeScript diagnostics.

## checkJs triage — benchmark metric

**Totals: (a) confirmed real bugs 0; (b) missing declarations/narrowing 145; (c) false positives 11.** Only the two cookie diagnostics have a completed TS counterpart in this slice; 154 diagnostics still belong to unported Figma code. All 156 remain in the unchanged JS oracle baseline.

Strict criterion for (a): a concrete input that yields wrong runtime behavior, not merely a broad inferred node type or a missing injected symbol. Review found no such demonstrated input among these diagnostics; no speculative bug count is credited. This is not a certificate that the unported Figma code has no bugs. Runtime fixes in the eventual Figma port must revisit these classifications and cite reproducing inputs if (a) is established.

- (b): declare optional vendor keys; typed option objects and number-or-padding unions; literal/tuple types for paints/enums/scopes; injected `ARGS`/kit/helper symbols; annotate dynamically attached function properties and narrow Figma lookup/scene/container types. These do not, by themselves, require changing behavior for valid contracted inputs.
- (c): eleven templates intentionally return from an assembled async-function body; checkJs incorrectly treats each standalone snippet as a module. Wrapping for type checking/type stripping addresses the context, without changing the runtime return.

Every original diagnostic is listed below (original JS file/line/column, not a fabricated TS location). “Pending” means triaged but not fixed/ported. “TS counterpart” means only the new TS path is fixed; the oracle JS is preserved.

| # | Original location | Diagnostic | Class | Disposition / reason |
|---:|---|---|:---:|---|
| 1 | `design-lab/runner/code.js:30:28` | TS2339: Property 'open' does not exist on type '(text: any) => void'. | b | Pending: declare dynamically assigned log.open property |
| 2 | `design-lab/runner/code.js:34:12` | TS2339: Property 'open' does not exist on type '(text: any) => void'. | b | Pending: declare dynamically assigned log.open property |
| 3 | `design-lab/runner/code.js:77:10` | TS2339: Property 'open' does not exist on type '(text: any) => void'. | b | Pending: declare dynamically assigned log.open property |
| 4 | `design-lab/runner/code.js:94:12` | TS2339: Property 'fills' does not exist on type 'BaseNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 5 | `design-lab/runner/code.js:108:28` | TS2339: Property 'exportAsync' does not exist on type 'BaseNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 6 | `design-lab/scripts/cookie_preferences.mjs:29:29` | TS2339: Property 'expected' does not exist on type '{ banner: any; close: any; expected: boolean; } \| { banner: string; script: string; close: any; }'. | b | TS counterpart: optional Vendor.expected/script declarations + script guard; unchanged valid behavior |
| 7 | `design-lab/scripts/cookie_preferences.mjs:29:67` | TS2339: Property 'script' does not exist on type '{ banner: any; close: any; expected: boolean; } \| { banner: string; script: string; close: any; }'. | b | TS counterpart: optional Vendor.expected/script declarations + script guard; unchanged valid behavior |
| 8 | `design-lab/scripts/render/_kit.js:75:35` | TS2339: Property 'name' does not exist on type '{}'. | b | Pending: declare optional options/receiver shape inferred without contract |
| 9 | `design-lab/scripts/render/_kit.js:75:41` | TS2339: Property 'width' does not exist on type '{}'. | b | Pending: declare optional options/receiver shape inferred without contract |
| 10 | `design-lab/scripts/render/_kit.js:75:48` | TS2339: Property 'link' does not exist on type '{}'. | b | Pending: declare optional options/receiver shape inferred without contract |
| 11 | `design-lab/scripts/render/_kit.js:75:54` | TS2339: Property 'align' does not exist on type '{}'. | b | Pending: declare optional options/receiver shape inferred without contract |
| 12 | `design-lab/scripts/render/_kit.js:84:3` | TS2322: Type '{ type: string; color: { r: number; g: number; b: number; }; opacity: number; }[]' is not assignable to type 'unique symbol \| readonly Paint[]'. | b | Pending: preserve SOLID literal and optional paint fields |
| 13 | `design-lab/scripts/render/_kit.js:101:29` | TS2339: Property 'name' does not exist on type '{ align?: string; gap?: number; justify?: string; pad?: number; wrap?: boolean; }'. | b | Pending: declare optional options/receiver shape inferred without contract |
| 14 | `design-lab/scripts/render/_kit.js:101:53` | TS2339: Property 'fill' does not exist on type '{ align?: string; gap?: number; justify?: string; pad?: number; wrap?: boolean; }'. | b | Pending: declare optional options/receiver shape inferred without contract |
| 15 | `design-lab/scripts/render/_kit.js:101:59` | TS2339: Property 'radius' does not exist on type '{ align?: string; gap?: number; justify?: string; pad?: number; wrap?: boolean; }'. | b | Pending: declare optional options/receiver shape inferred without contract |
| 16 | `design-lab/scripts/render/_kit.js:101:67` | TS2339: Property 'stroke' does not exist on type '{ align?: string; gap?: number; justify?: string; pad?: number; wrap?: boolean; }'. | b | Pending: declare optional options/receiver shape inferred without contract |
| 17 | `design-lab/scripts/render/_kit.js:101:75` | TS2339: Property 'width' does not exist on type '{ align?: string; gap?: number; justify?: string; pad?: number; wrap?: boolean; }'. | b | Pending: declare optional options/receiver shape inferred without contract |
| 18 | `design-lab/scripts/render/_kit.js:101:82` | TS2339: Property 'height' does not exist on type '{ align?: string; gap?: number; justify?: string; pad?: number; wrap?: boolean; }'. | b | Pending: declare optional options/receiver shape inferred without contract |
| 19 | `design-lab/scripts/render/_kit.js:101:136` | TS2339: Property 'rowGap' does not exist on type '{ align?: string; gap?: number; justify?: string; pad?: number; wrap?: boolean; }'. | b | Pending: declare optional options/receiver shape inferred without contract |
| 20 | `design-lab/scripts/render/_kit.js:108:3` | TS2322: Type 'string' is not assignable to type '"BASELINE" \| "CENTER" \| "MAX" \| "MIN"'. | b | Pending: typed options or literal enum union; inferred default is too narrow/wide |
| 21 | `design-lab/scripts/render/_kit.js:109:3` | TS2322: Type 'string' is not assignable to type '"CENTER" \| "MAX" \| "MIN" \| "SPACE_AROUND" \| "SPACE_BETWEEN" \| "SPACE_EVENLY"'. | b | Pending: typed options or literal enum union; inferred default is too narrow/wide |
| 22 | `design-lab/scripts/render/_kit.js:111:3` | TS2322: Type '{ type: string; color: { r: number; g: number; b: number; }; opacity: number; }[]' is not assignable to type 'unique symbol \| readonly Paint[]'. | b | Pending: preserve SOLID literal and optional paint fields |
| 23 | `design-lab/scripts/render/_kit.js:113:17` | TS2322: Type '{ type: string; color: { r: number; g: number; b: number; }; opacity: number; }[]' is not assignable to type 'readonly Paint[]'. | b | Pending: preserve SOLID literal and optional paint fields |
| 24 | `design-lab/scripts/render/_kit.js:147:61` | TS2322: Type '{ t: number; r: number; b: number; l: number; }' is not assignable to type 'number'. | b | Pending: declare number-or-side-padding option already handled at runtime |
| 25 | `design-lab/scripts/render/_kit.js:155:3` | TS2322: Type '{ type: string; color: { r: number; g: number; b: number; }; opacity: number; }[]' is not assignable to type 'unique symbol \| readonly Paint[]'. | b | Pending: preserve SOLID literal and optional paint fields |
| 26 | `design-lab/scripts/render/_kit.js:163:49` | TS2339: Property 'width' does not exist on type '{ name?: string; }'. | b | Pending: declare optional options/receiver shape inferred without contract |
| 27 | `design-lab/scripts/render/_kit.js:165:33` | TS2353: Object literal may only specify known properties, and 'name' does not exist in type '{ align?: string; gap?: number; justify?: string; pad?: number; wrap?: boolean; }'. | b | Pending: typed options or literal enum union; inferred default is too narrow/wide |
| 28 | `design-lab/scripts/render/_kit.js:167:77` | TS2322: Type '{ t: number; r: number; b: number; l: number; }' is not assignable to type 'number'. | b | Pending: declare number-or-side-padding option already handled at runtime |
| 29 | `design-lab/scripts/render/_kit.js:171:90` | TS2322: Type '{ t: number; r: number; b: number; l: number; }' is not assignable to type 'number'. | b | Pending: declare number-or-side-padding option already handled at runtime |
| 30 | `design-lab/scripts/render/_kit.js:187:33` | TS2353: Object literal may only specify known properties, and 'name' does not exist in type '{ align?: string; gap?: number; justify?: string; pad?: number; wrap?: boolean; }'. | b | Pending: typed options or literal enum union; inferred default is too narrow/wide |
| 31 | `design-lab/scripts/render/_kit.js:202:3` | TS2322: Type '{ type: string; color: { r: number; g: number; b: number; }; opacity: number; }[]' is not assignable to type 'readonly Paint[]'. | b | Pending: preserve SOLID literal and optional paint fields |
| 32 | `design-lab/scripts/render/build_responsive.js:14:32` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 33 | `design-lab/scripts/render/build_responsive.js:24:5` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 34 | `design-lab/scripts/render/build_responsive.js:24:25` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 35 | `design-lab/scripts/render/build_responsive.js:27:19` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 36 | `design-lab/scripts/render/build_responsive.js:29:43` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 37 | `design-lab/scripts/render/build_responsive.js:30:33` | TS2345: Argument of type 'BaseNode' is not assignable to parameter of type 'PageNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 38 | `design-lab/scripts/render/build_responsive.js:34:46` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 39 | `design-lab/scripts/render/build_responsive.js:37:50` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 40 | `design-lab/scripts/render/build_responsive.js:39:54` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 41 | `design-lab/scripts/render/build_responsive.js:40:39` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 42 | `design-lab/scripts/render/build_responsive.js:41:15` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 43 | `design-lab/scripts/render/build_responsive.js:42:15` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 44 | `design-lab/scripts/render/build_responsive.js:45:53` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 45 | `design-lab/scripts/render/build_responsive.js:47:28` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 46 | `design-lab/scripts/render/build_responsive.js:48:30` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 47 | `design-lab/scripts/render/build_responsive.js:48:66` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 48 | `design-lab/scripts/render/build_responsive.js:56:46` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 49 | `design-lab/scripts/render/build_responsive.js:57:64` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 50 | `design-lab/scripts/render/build_responsive.js:68:43` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 51 | `design-lab/scripts/render/build_responsive.js:76:41` | TS2339: Property 'test' does not exist on type 'string[] \| RegExp'. | b | Pending: type RegExp/scopes pair as a tuple and scopes as enum literals |
| 52 | `design-lab/scripts/render/build_responsive.js:77:5` | TS2322: Type 'string[] \| RegExp' is not assignable to type 'VariableScope[]'. | b | Pending: type RegExp/scopes pair as a tuple and scopes as enum literals |
| 53 | `design-lab/scripts/render/build_responsive.js:82:32` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 54 | `design-lab/scripts/render/build_responsive.js:94:15` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 55 | `design-lab/scripts/render/build_responsive.js:173:39` | TS2339: Property 'tag' does not exist on type 'string'. | b | Pending: narrow axis string versus tagged axis object; string.tag read is harmless undefined |
| 56 | `design-lab/scripts/render/build_responsive.js:189:12` | TS2322: Type 'SolidPaint' is not assignable to type '{ type: string; color: { r: number; g: number; b: number; }; opacity: any; }'. | b | Pending: preserve SOLID literal and optional paint fields |
| 57 | `design-lab/scripts/render/build_responsive.js:189:57` | TS2345: Argument of type '{ type: string; color: { r: number; g: number; b: number; }; opacity: any; }' is not assignable to parameter of type 'SolidPaint'. | b | Pending: preserve SOLID literal and optional paint fields |
| 58 | `design-lab/scripts/render/build_responsive.js:271:18` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 59 | `design-lab/scripts/render/build_responsive.js:282:24` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 60 | `design-lab/scripts/render/build_responsive.js:394:23` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 61 | `design-lab/scripts/render/build_responsive.js:394:79` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 62 | `design-lab/scripts/render/build_responsive.js:395:5` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 63 | `design-lab/scripts/render/build_responsive.js:396:30` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 64 | `design-lab/scripts/render/build_responsive.js:396:65` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 65 | `design-lab/scripts/render/build_responsive.js:401:47` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 66 | `design-lab/scripts/render/build_responsive.js:406:22` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 67 | `design-lab/scripts/render/build_responsive.js:407:8` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 68 | `design-lab/scripts/render/build_responsive.js:409:38` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 69 | `design-lab/scripts/render/build_responsive.js:414:24` | TS2339: Property 'children' does not exist on type 'BaseNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 70 | `design-lab/scripts/render/build_responsive.js:414:139` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 71 | `design-lab/scripts/render/build_responsive.js:417:37` | TS2339: Property 'children' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 72 | `design-lab/scripts/render/build_responsive.js:419:57` | TS2339: Property 'boundVariables' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 73 | `design-lab/scripts/render/build_responsive.js:420:86` | TS2339: Property 'setBoundVariable' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 74 | `design-lab/scripts/render/build_responsive.js:422:13` | TS2339: Property 'layoutMode' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 75 | `design-lab/scripts/render/build_responsive.js:423:13` | TS2339: Property 'strokes' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 76 | `design-lab/scripts/render/build_responsive.js:423:37` | TS2339: Property 'effects' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 77 | `design-lab/scripts/render/build_responsive.js:423:61` | TS2339: Property 'cornerRadius' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 78 | `design-lab/scripts/render/build_responsive.js:423:89` | TS2339: Property 'opacity' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 79 | `design-lab/scripts/render/build_responsive.js:426:58` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 80 | `design-lab/scripts/render/build_responsive.js:427:13` | TS2339: Property 'description' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 81 | `design-lab/scripts/render/build_responsive.js:427:27` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 82 | `design-lab/scripts/render/build_responsive.js:428:13` | TS2339: Property 'clipsContent' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 83 | `design-lab/scripts/render/build_responsive.js:429:13` | TS2339: Property 'resize' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 84 | `design-lab/scripts/render/build_responsive.js:432:26` | TS2345: Argument of type 'DocumentNode \| PageNode \| SceneNode' is not assignable to parameter of type 'BooleanOperationNode \| CodeBlockNode \| ComponentNode \| ConnectorNode \| EllipseNode \| EmbedNode \| ... 26 more ... \| WidgetNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 85 | `design-lab/scripts/render/build_responsive.js:432:43` | TS2339: Property 'appendChild' does not exist on type 'BaseNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 86 | `design-lab/scripts/render/build_responsive.js:433:13` | TS2339: Property 'x' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 87 | `design-lab/scripts/render/build_responsive.js:433:17` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 88 | `design-lab/scripts/render/build_responsive.js:434:13` | TS2339: Property 'y' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 89 | `design-lab/scripts/render/build_responsive.js:434:17` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 90 | `design-lab/scripts/render/build_responsive.js:437:13` | TS2339: Property 'resize' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 91 | `design-lab/scripts/render/build_responsive.js:437:60` | TS2339: Property 'height' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 92 | `design-lab/scripts/render/build_responsive.js:439:54` | TS2339: Property 'counterAxisSizingMode' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 93 | `design-lab/scripts/render/build_responsive.js:439:97` | TS2339: Property 'primaryAxisSizingMode' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 94 | `design-lab/scripts/render/build_responsive.js:440:22` | TS2339: Property 'primaryAxisSizingMode' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 95 | `design-lab/scripts/render/build_responsive.js:440:65` | TS2339: Property 'counterAxisSizingMode' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 96 | `design-lab/scripts/render/build_responsive.js:449:36` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 97 | `design-lab/scripts/render/build_responsive.js:449:47` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 98 | `design-lab/scripts/render/build_responsive.js:450:5` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 99 | `design-lab/scripts/render/build_responsive.js:452:19` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 100 | `design-lab/scripts/render/build_responsive.js:452:111` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 101 | `design-lab/scripts/render/build_responsive.js:457:20` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 102 | `design-lab/scripts/render/build_responsive.js:465:99` | TS2345: Argument of type 'BaseNode' is not assignable to parameter of type 'BaseNode & ChildrenMixin'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 103 | `design-lab/scripts/render/build_responsive.js:466:89` | TS2339: Property 'appendChild' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 104 | `design-lab/scripts/render/build_responsive.js:467:16` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 105 | `design-lab/scripts/render/build_responsive.js:468:9` | TS2339: Property 'description' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 106 | `design-lab/scripts/render/build_responsive.js:468:23` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 107 | `design-lab/scripts/render/build_responsive.js:469:54` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 108 | `design-lab/scripts/render/build_responsive.js:470:9` | TS2339: Property 'x' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 109 | `design-lab/scripts/render/build_responsive.js:470:13` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 110 | `design-lab/scripts/render/build_responsive.js:471:9` | TS2339: Property 'y' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 111 | `design-lab/scripts/render/build_responsive.js:471:13` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 112 | `design-lab/scripts/render/build_responsive.js:475:9` | TS2339: Property 'resizeWithoutConstraints' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 113 | `design-lab/scripts/render/build_responsive.js:475:60` | TS2339: Property 'children' does not exist on type 'DocumentNode \| PageNode \| SceneNode'. | b | Pending: narrow Figma node/container/scene lookup to contracted receiver |
| 114 | `design-lab/scripts/render/build_responsive.js:477:1` | TS1108: A 'return' statement can only be used within a function body. | c | Pending: async-body snippet, standalone-module context false positive |
| 115 | `design-lab/scripts/render/component_block.js:21:7` | TS2304: Cannot find name 'loadKitFonts'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 116 | `design-lab/scripts/render/component_block.js:22:20` | TS2552: Cannot find name 'onPage'. Did you mean 'page'? | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 117 | `design-lab/scripts/render/component_block.js:22:27` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 118 | `design-lab/scripts/render/component_block.js:23:1` | TS1108: A 'return' statement can only be used within a function body. | c | Pending: async-body snippet, standalone-module context false positive |
| 119 | `design-lab/scripts/render/cover.js:34:16` | TS2304: Cannot find name 'KIT'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 120 | `design-lab/scripts/render/cover.js:36:35` | TS2552: Cannot find name 'ROLES'. Did you mean 'role'? | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 121 | `design-lab/scripts/render/cover.js:36:75` | TS2552: Cannot find name 'ROLES'. Did you mean 'role'? | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 122 | `design-lab/scripts/render/cover.js:36:95` | TS2552: Cannot find name 'ROLES'. Did you mean 'role'? | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 123 | `design-lab/scripts/render/cover.js:42:9` | TS2304: Cannot find name 'loadKitFonts'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 124 | `design-lab/scripts/render/cover.js:46:19` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 125 | `design-lab/scripts/render/cover.js:47:20` | TS2552: Cannot find name 'onPage'. Did you mean 'page'? | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 126 | `design-lab/scripts/render/cover.js:47:27` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 127 | `design-lab/scripts/render/cover.js:48:1` | TS1108: A 'return' statement can only be used within a function body. | c | Pending: async-body snippet, standalone-module context false positive |
| 128 | `design-lab/scripts/render/examples.js:10:7` | TS2304: Cannot find name 'loadKitFonts'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 129 | `design-lab/scripts/render/examples.js:11:20` | TS2552: Cannot find name 'onPage'. Did you mean 'page'? | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 130 | `design-lab/scripts/render/examples.js:11:27` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 131 | `design-lab/scripts/render/examples.js:12:1` | TS1108: A 'return' statement can only be used within a function body. | c | Pending: async-body snippet, standalone-module context false positive |
| 132 | `design-lab/scripts/render/foundation.js:15:7` | TS2304: Cannot find name 'loadKitFonts'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 133 | `design-lab/scripts/render/foundation.js:16:20` | TS2552: Cannot find name 'onPage'. Did you mean 'page'? | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 134 | `design-lab/scripts/render/foundation.js:16:27` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 135 | `design-lab/scripts/render/foundation.js:17:1` | TS1108: A 'return' statement can only be used within a function body. | c | Pending: async-body snippet, standalone-module context false positive |
| 136 | `design-lab/scripts/render/getting_started.js:15:7` | TS2304: Cannot find name 'loadKitFonts'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 137 | `design-lab/scripts/render/getting_started.js:16:20` | TS2552: Cannot find name 'onPage'. Did you mean 'page'? | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 138 | `design-lab/scripts/render/getting_started.js:16:27` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 139 | `design-lab/scripts/render/getting_started.js:17:1` | TS1108: A 'return' statement can only be used within a function body. | c | Pending: async-body snippet, standalone-module context false positive |
| 140 | `design-lab/scripts/render/pages.js:11:16` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 141 | `design-lab/scripts/render/pages.js:36:1` | TS1108: A 'return' statement can only be used within a function body. | c | Pending: async-body snippet, standalone-module context false positive |
| 142 | `design-lab/scripts/render/tier_page.js:10:7` | TS2304: Cannot find name 'loadKitFonts'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 143 | `design-lab/scripts/render/tier_page.js:11:20` | TS2552: Cannot find name 'onPage'. Did you mean 'page'? | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 144 | `design-lab/scripts/render/tier_page.js:11:27` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 145 | `design-lab/scripts/render/tier_page.js:12:1` | TS1108: A 'return' statement can only be used within a function body. | c | Pending: async-body snippet, standalone-module context false positive |
| 146 | `design-lab/scripts/render/variables.js:32:44` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 147 | `design-lab/scripts/render/variables.js:76:1` | TS1108: A 'return' statement can only be used within a function body. | c | Pending: async-body snippet, standalone-module context false positive |
| 148 | `design-lab/scripts/render/voice.js:14:7` | TS2304: Cannot find name 'loadKitFonts'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 149 | `design-lab/scripts/render/voice.js:15:20` | TS2552: Cannot find name 'onPage'. Did you mean 'page'? | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 150 | `design-lab/scripts/render/voice.js:15:27` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 151 | `design-lab/scripts/render/voice.js:16:1` | TS1108: A 'return' statement can only be used within a function body. | c | Pending: async-body snippet, standalone-module context false positive |
| 152 | `design-lab/scripts/render/wipe.js:10:22` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 153 | `design-lab/scripts/render/wipe.js:10:56` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 154 | `design-lab/scripts/render/wipe.js:11:73` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 155 | `design-lab/scripts/render/wipe.js:39:8` | TS2304: Cannot find name 'ARGS'. | b | Pending: declare injected ARGS or prepended kit/helper symbol |
| 156 | `design-lab/scripts/render/wipe.js:43:1` | TS1108: A 'return' statement can only be used within a function body. | c | Pending: async-body snippet, standalone-module context false positive |

## Commands run / reproducibility

All implementation/git commands run in the feature worktree. Environment prefix for Node: `DESIGN_LAB_CACHE=/tmp/design-lab-p1-cache`; for oracle harnesses also `DESIGN_LAB_PYTHON=/tmp/design-lab-armb/venv/bin/python`. Python test environment: `PYTHONDONTWRITEBYTECODE=1`, `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib` (cairosvg), and `DESIGN_LAB_TEST_NODE_CWD=/tmp/design-lab-p1-cache/typescript/e5199a8806b0f4ff` for consent tests.

```
node design-lab/scripts/ts-tool.ts check
node design-lab/scripts/ts-tool.ts check-js     # intentional baseline failure: 156 errors
node --test design-lab/tests/ts/*.test.ts
node --test design-lab/tests/ts/capture.test.ts design-lab/tests/ts/fetch-images.test.ts design-lab/tests/ts/spec-tree.test.ts design-lab/tests/browser/cookies.test.ts
node --test design-lab/tests/browser/cookies.test.ts
node design-lab/tests/equivalence/trees.ts
node design-lab/tests/equivalence/capture.ts
node design-lab/tests/equivalence/capture-cli.ts /tmp/design-lab-p2-capture-fixtures
/tmp/design-lab-armb/venv/bin/python design-lab/tests/equivalence/keep-oracle.py /Users/Chris.Weber/Tools/CLAUDE-PLUGINS/analysis-reports/design-lab-test-prune-2026-10-07.md
/tmp/design-lab-armb/venv/bin/python -m unittest discover -s design-lab/tests

git branch --show-current
git rev-parse --show-toplevel
git diff --cached --check
git diff 5714b1d1 --check
git status --short
git commit -m 'feat(design-lab): port measured trees and payload assembly to TypeScript'
git commit -m 'feat(design-lab): fetch build images with Sharp'
git commit -m 'feat(design-lab): capture with one Chromium and a bounded page pool'
bd prime
bd show gap-ffo.7
bd update gap-ffo.7 --status in_progress
bd update gap-ffo.7 --append-notes 'Partial phase 2 ...'
```

The capture harness invokes unchanged `measure.mjs --config ... --out ...`, `capture.mjs --configs ... --only-ids ... --out ... --scale 1`, and the Python evidence assembler; tree harness invokes unchanged Python converters/compactor/renderer. Additional Python assertions verified all ten PNCB record hashes/statuses. Read-only source/report/git inspections and scratch fixture copy commands are omitted from this reproduction list. All successful checks have logs in `/tmp/design-lab-p2-*.log`.

Exposed implemented operations:

```
node ${CLAUDE_PLUGIN_ROOT}/src/capture.ts run --project SCRATCH_RUN --canonical-base-url URL --configs DIR --concurrency 4
node ${CLAUDE_PLUGIN_ROOT}/src/responsive.ts SPEC --label LABEL --key ID --out TREE
node ${CLAUDE_PLUGIN_ROOT}/src/render-payload.ts call TEMPLATE ARGS.json --out PAYLOAD
node ${CLAUDE_PLUGIN_ROOT}/src/render-payload.ts inline TEMPLATE ARGS.json --out PAYLOAD
node ${CLAUDE_PLUGIN_ROOT}/src/render-payload.ts hash
```

Do not point capture at the original run folders during equivalence work. `figma_build init/next/record/receipts` and `runner serve` TS commands are **not available** yet.

## Remaining work, questions and risks

1. Port `figma_build.py` as the in-process TS driver, including init/next/record, write-on-change state, all step argument producers and artifact lifecycle. Replay full DEFINITIVEHC and PNCB sequences/payloads against the current Python oracle on scratch copies. Do not substitute a Python bridge and claim a rewrite.
2. Port Node HTTP runner/install and receipt handling (`figma_runner.py`, `figma_receipts.py`). Installation must strip `runner/code.ts` into manifest-loadable `code.js`, without modifying installed caches in this phase. No live Figma build is permitted.
3. Port `runner/code.js`, every `scripts/render/*.js` and `figma_dump_*.js` with plugin-typings and contract-derived ARGS. Add globalThis font-list/load-font/local-variable caches with documented invalidation, as Arm B does. Complete/fix all remaining 154 counterpart diagnostics; preserve the oracle JS until phase 5 and prove stripped template behavior equivalence.
4. Port `fonts.py`, `index_rows.py`, `library_counts.py`, `figma_compare.py`, and remaining nesting build/alternate/wiring orchestration. Connect Sharp fetching to the driver and cover font/native identity/count/comparison KEEP tests.
5. Broaden payload equivalence from the tested compact tree envelope to every real step's full argument producer/template, including fonts, masters, variants, alternates, docs and token/index actions. Full driver replay remains the decisive acceptance test.
6. Clarify acceptance of the three malformed corpus specs: currently both implementations reject; no usable Python output exists to deep-equal. No user answer was needed to proceed with all valid inputs.
7. Capture equivalence used frozen configs and `--no-check` for timing, with selector/scaffold/registry/derived behavior verified in retained unit cases. Real-site end-to-end scaffold + selector + child-relationship comparisons and broader failure/cancellation/slow-page tests would improve confidence before switching skills.

Risk: this is a usable capture/tree/payload slice, not a complete TS plugin. Python/JS remain necessary for build/runner/Figma operations, and skills still call them. Library semantics can differ for exotic SVG/web assets; Sharp is covered by pixels/unit fixtures, not every Pillow/cairosvg input. Payload stripping's wrapper is tested for an async body with a top-level return; actual production TS snippets and type-only import/declaration handling are still to be designed/proven. Python-number formatting in unusual nested floating config values deserves a dedicated cross-language matrix before claiming arbitrary-config digest equivalence. Ordinary scale values and all ten real record hashes are verified.

`gap-ffo.7` is in progress, not closed. The local branch contains three implementation commits plus the report commit. Pre-existing untracked `.claude/` and `design-lab/spikes/` were not staged. No outstanding new-test failure; full acceptance remains incomplete for the explicit items above.
