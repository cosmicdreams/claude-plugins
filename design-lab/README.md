# design-lab

Build and maintain a Figma component library from a codebase.

Extract, model, render are separate on purpose. Writing source straight into Figma gives a
one-shot script that cannot re-run, cannot diff against the source later, and cannot feed
anything but Figma. `components.json` and `tokens.json` are the contract; Figma is one
renderer.

## Three independent plug points

Component source, token source and usage source vary **separately**. A Single Directory
Component site has no tokens in configuration at all — they live in stylesheets. Conflating
the axes forces one site down another's path.

## Verified against

| Site | Components | Config path | Tokens |
|---|---|---|---|
| America's Credit Unions | 69 Drupal authoring bundles | `config/default` | 97 planned variables from authored Sass |
| AHRI | 146 Site Studio | `config/sync` | 129 custom style entities |
| Schusterman | 101 Site Studio | `config/default` | 172 custom style entities |
| PNCB | 43 Paragraph types | `config/default` | 113 base tokens via Sass source map |
| PNCB `css-candidate` | 43 Paragraph types | `config/default` | 94 authored custom properties |

PNCB also has 13 custom Single Directory Components, but only 6 are invoked by a paragraph
template - they are a partial rendering layer, not the component source. It was recorded
as a 13-component Single Directory Component site until 2026-08-31; that profile came from
a bug, not the site. See `references/strategies/README.md`.

## Start here

Use `design-lab:run` for a complete library. It creates `.design-lab/project.json`, records
the repository commit and every strategy decision, validates artifacts before rendering, and
can resume from the first incomplete phase. Use a narrower skill only when the request names a
single phase.

| Skill | Does |
|---|---|
| `design-lab:run` | end-to-end, resumable workflow and completion gate |
| `design-lab:detect` | which strategies apply |
| `design-lab:inventory` | components + fields + slots + source defects -> `components.json` |
| `design-lab:usage` | verified anonymous example addresses + placement counts + tiers |
| `design-lab:capture` | measures and photographs each component on a running site, per breakpoint |
| `design-lab:tokens` | colour, spacing, type per breakpoint, each with its code name -> `tokens.json` |
| `design-lab:plan` | reviewable build proposal with variant arithmetic and hard refusals |
| `design-lab:figma-foundation` | variable collections, modes, scopes, code syntax. Once per file |
| `design-lab:figma-component` | one named atomic component transaction — variants, properties, bindings, documentation card, build record |
| `design-lab:figma-index` | the Getting Started page: inventory, linked index, coverage, known gaps. Refresh after every component |
| `design-lab:verify` | **checks the whole file against the base expectations**; every gap ends as a fix or a recorded waiver |

`scripts/workflow.py` is the deterministic front door. Its `init`, `detect`, `select`,
`extract`, `usage`, `plan`, `variables`, `approve`, `target`, `register`, `record`, `validate`, and
`status` commands write atomically and keep artifact hashes in the project manifest. The
schemas in `schemas/` are the machine-readable contracts; `references/library-standard.md`
is the canonical product definition.

Component extractors cover Site Studio, SDCs, Paragraphs, and combined Drupal authoring
vocabularies (`block_content` + Paragraphs). Token extractors cover Site Studio styles,
theme-loaded CSS custom properties, Sass source maps, and source-authored Sass. Combined Drupal
extraction also writes `render-evidence.json`, a bounded map from each authoring bundle to its
existing Twig, SDC, stylesheet, root-class, and referenced-field evidence.
That evidence includes deterministic `styleFacts` parsed from the component's own Sass: root
and nested-part declarations stay separate, retain token/literal provenance, and give the model
the visual facts it needs without asking it to rediscover every stylesheet rule.

Drupal database usage is deterministic too: `extract_drupal_usage.py` reads the running DDEV
project, preserves placements and structural references as separate measures, writes a validated
`usage.json`, and merges tiers into `components.json`. Planning hard-stops when detection found
usage evidence but it was neither measured nor explicitly waived as degraded.
Waivers are human decisions: the workflow requires both a named decider and a reason, and final
verification refuses any unresolved prerequisite phase. Registering one component receipt also
cannot complete the component phase; valid non-failing receipts must cover the approved plan.

Capture: `scaffold_configs.py` writes a config per component and names the ones a human must
finish; `measure.mjs` records the box model and typography per breakpoint; `capture.mjs`
takes element-scoped screenshots. Playwright is not vendored and resolves from the current
working directory. `DESIGN_LAB_BROWSER_EXECUTABLE` selects an installed browser when a
Playwright-managed Chromium download is unavailable. See `skills/capture/SKILL.md`.

Token sources are ranked by evidence. A substantial theme-loaded custom-property layer states
runtime intent and wins. Source-authored Sass is next, then a recovered Sass source map. Weak
or unloaded CSS never outranks the theme sources merely because similarly named files exist.

`figma-component` owns one component transaction on purpose. `run` may process many
transactions in one model session, but each becomes durable only after its build record is
validated. Every recorded assertion must explicitly pass; skipped fidelity work and an empty
assertion object remain incomplete. A partial run therefore resumes safely instead of pretending
the library is done.

`verify` is the one that runs last and the one that should have existed first. Every other
skill reports on its own step, so a library can pass all of them and still be half a
library — which is exactly what happened on PNCB: four empty Foundations pages, 36 of 43
components missing, no documentation links anywhere, and sixteen variables whose Dev Mode
names existed nowhere in the codebase. Nothing was looking at the whole.

Planned: `drift`.

## References

- `references/prior-art.md` — **read first.** Look for an existing Figma file and existing
  tooling before extracting anything
- `references/model.md` — the universal model and the provenance rule
- `references/variant-policy.md` — the decision that makes or breaks the library
- `references/findability.md` — how anyone finds a component in a 146-component file
- `references/tokens-and-variables.md` — code syntax, and why the Figma name is not the token
- `references/defaults.md` — which variant goes first, and the evidence for it
- `references/verification.md` — assert numbers, do not eyeball 146 components
- `references/build-records.md` — the idempotency and resume contract
- `references/strategies/README.md` — per-strategy mapping and counting traps
