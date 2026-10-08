# Design-lab lint and formatting — 2026-10-08

Bead: `gap-ffo.22`  
Branch: `chore/design-lab-ts-lint-format`  
Base: `1a02f8bf`

## Tooling

| Tool | Pinned version | Use |
|---|---:|---|
| ESLint | 10.12.0 | Flat config and TypeScript linting |
| `typescript-eslint` | 8.71.1 | Typed rules using the existing Node and Figma tsconfigs |
| Prettier | 3.9.9 | TypeScript formatting, `printWidth: 120` |
| Native TypeScript | 7.0.2 | Compiler for both project typechecks |
| `@typescript/typescript6` | 6.0.2 | Programmatic API resolved as `typescript` for typed ESLint |

The aliases preserve TypeScript 7 as the compiler: `@typescript/native` is `typescript@7.0.2`, and `typescript` is `@typescript/typescript6@6.0.2`. The `ts-tool.ts` launcher invokes the native compiler directly. Typed ESLint uses the TypeScript 6 compatibility API because TypeScript 7.0 has no programmatic API yet. This follows the TypeScript team's [side-by-side guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0); `typescript-eslint` currently documents support through `<6.1.0` in its [dependency version policy](https://typescript-eslint.io/users/dependency-versions/). The compatibility alias can be removed when `typescript-eslint` supports TypeScript 7's new API.

Lint rules: `no-explicit-any` error, `no-unnecessary-type-assertion` error, `no-non-null-assertion` warning, `switch-exhaustiveness-check` error, `consistent-type-imports` error, `prefer-readonly` warning, and `no-floating-promises` error. `src/generated/**` is excluded from lint and formatting. Prettier ignores all Markdown and JSON, including fixtures and schemas, plus generated `types/index.d.ts`; `.prettierrc.json` preserves quote style, uses single quotes, semicolons, trailing commas, and width 120.

## Rule counts

| Run | Errors | Warnings | Details |
|---|---:|---:|---|
| Initial lint after adding rules | 927 | 1,358 | 528 floating promises, 140 explicit `any`, 184 unnecessary assertions, 72 type-import violations, 1 switch exhaustiveness error; most remaining findings were non-null assertions |
| After lint fixes | 744 | 1,218 | Explicit `any`, type-import, and assertion fixes applied; 528 floating promises still remained at this intermediate point |
| Final lint | 0 | 1,227 | All warnings are `no-non-null-assertion`; no lint errors |

All 528 floating-promise findings were resolved. Test registrations explicitly consume their promises; the other changes use typed seams or explicit handling. The remaining non-null assertions are warnings by design and are spread across checked protocol data, Figma template inputs, and test fixtures. They remain warnings so their broader removal can be reviewed independently.

## Commits

1. `3d30907b` — tooling, pinned dependencies, flat lint config, shared-cache launcher, formatter config
2. `b2d241fe` — TypeScript formatting only
3. `a803cda3` — lint fixes
4. `c0c0d5f6` — `noUnusedLocals` and `noUnusedParameters` in both tsconfigs, plus fixes
5. `ce3139ed` — CI lint and format checks after typecheck
6. `1806778` — TypeScript 7 compiler/API aliases, documentation, generated contract and whitespace-sensitive reviewed-fixture updates

The formatting commit's `git diff --ignore-all-space --stat` reports 246 files and 35,154 insertions / 13,077 deletions. This is because Git ignores space characters but not line breaks: Prettier reflowed long expressions and statements, so a changed line can appear as a removed line plus several added lines. The formatter did not change executable syntax; template, runner, typed-seam, driver, tree, and evaluation parity checks below passed. The `quoteProps: preserve` setting also retains literal key spelling in Figma-injected templates.

## Verification

| Check | Result |
|---|---|
| TypeScript Node + Figma typechecks | Pass with native TypeScript 7.0.2; both configs include `noUnusedLocals` and `noUnusedParameters` |
| `npm run lint` | 0 errors, 1,227 warnings (all non-null assertions) |
| `npm run format:check` | Pass |
| `npm test` | 599/599 pass, 21.7 seconds |
| `npm run contracts:check` | Pass |
| `npm run contracts:reality` | 2,190/2,190 files pass |
| Template and runner parity | 12 template units, 4 dumps; runner AST parity passes; runner reviewed seams pass |
| Driver replay | 293/293 and 101/101 steps match |
| Tree corpus | 202 flat trees match; 199 responsive trees and payloads match; 3 oracle-invalid inputs are rejected as expected |
| Runner HTTP smoke | Reaches `done`; matched; 296 requests served on each implementation arm; 58 receipts each |
| Evaluation parity | 6/6 runs match; all 442/442 checked images are exact. Two whole-file verification artifacts remain marked pending live builds in the pre-existing coverage manifest. |
| `node scripts/test-mod.ts` | 76/76 pass |
| `claude plugin validate ./design-lab` | Pass |

The runner and tree checks exercise the typed-seam parity. Reviewed-diff fixtures were updated in place for Prettier's whitespace changes; no new reviewed-diff entries were added.
