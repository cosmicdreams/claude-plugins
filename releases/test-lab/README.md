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
