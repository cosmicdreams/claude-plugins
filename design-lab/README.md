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
| AHRI | 146 Site Studio | `config/sync` | 129 custom style entities |
| Schusterman | 101 Site Studio | `config/default` | 172 custom style entities |
| PNCB | 43 Paragraph types | `config/default` | 113 base tokens via Sass source map |

PNCB also has 13 custom Single Directory Components, but only 6 are invoked by a paragraph
template - they are a partial rendering layer, not the component source. It was recorded
as a 13-component Single Directory Component site until 2026-08-31; that profile came from
a bug, not the site. See `references/strategies/README.md`.

## Skills

Run them in this order.

| Skill | Does |
|---|---|
| `design-lab:detect` | which strategies apply |
| `design-lab:inventory` | components + fields + slots + source defects -> `components.json` |
| `design-lab:usage` | verified anonymous example addresses + placement counts + tiers |
| `design-lab:tokens` | colour, spacing, type per breakpoint, each with its code name -> `tokens.json` |
| `design-lab:plan` | reviewable build proposal with variant arithmetic and hard refusals |
| `design-lab:figma-foundation` | variable collections, modes, scopes, code syntax. Once per file |
| `design-lab:figma-component` | **one** component: variants, bindings, assertions, build record |
| `design-lab:figma-atlas` | the searchable index page, plus what was not built |

Extractors: `extract_sitestudio.py`, `extract_sdc.py`, `extract_paragraphs.py` (component
sources), `extract_tokens_sitestudio.py` and `extract_tokens_sourcemap.py` (token sources),
`find_examples.py` (usage source).

`figma-component` builds one component per invocation on purpose. A single run over 146
components exhausts its context partway and leaves a half-built file with no record of where
it stopped; one at a time is resumable, reviewable and can be fanned out.

Planned: `drift`.

## References

- `references/model.md` — the universal model and the provenance rule
- `references/variant-policy.md` — the decision that makes or breaks the library
- `references/findability.md` — how anyone finds a component in a 146-component file
- `references/tokens-and-variables.md` — code syntax, and why the Figma name is not the token
- `references/defaults.md` — which variant goes first, and the evidence for it
- `references/verification.md` — assert numbers, do not eyeball 146 components
- `references/build-records.md` — the idempotency and resume contract
- `references/strategies/README.md` — per-strategy mapping and counting traps
