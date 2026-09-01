# Changelog

## 0.3.0

Everything here came from running the plugin against Schusterman and discovering, afterwards,
that a Figma file and a complete working toolchain already existed. Every difference was
design-lab being worse.

- `references/prior-art.md` — look for an existing Figma file and existing repository tooling
  before extracting. `design-lab:detect` now begins with that probe
- `extract_tokens_sitestudio.py` rewritten to read `cohesion_website_settings` first:
  `cohesion_color` (the palette), `cohesion_font_stack` (families, with `$coh-font-*`
  resolved), `cohesion_scss_variable` (the spacer scale). Custom styles are now the
  component layer, emitted separately
- `plan_variables.py` carries the palette across intact and builds a semantic alias layer
  from the colours' own tags
- `find_examples.py` tiers are now **absolute** and gain two categories — `structural only`
  and `unused` — plus the Figma page each maps to
- `references/findability.md` prefers usage-tier pages over invented category pages
- Components are named `<machine_name> — <Human Label>`; Assets panel search is substring
  matching, so one name answers both `banner` and `cpt_cta`

What the greenfield run got wrong, measured:

| | greenfield | the existing answer |
|---|---|---|
| `cpt_text` placements | 26, from a 250-page crawl | **871**, from 2,448 production canvases |
| colour palette | 11 hexes named `card-fake-button` | **43** named colours with Sass variables |
| font families | unresolved `$coh-font-serif` | **Greta Text** |
| spacing | 23 deduped component ramps | `$spacer-xxs..xxxl`, a real 4-96 ramp |
| organisation | invented category pages | usage-tier pages already under review |

## 0.2.0

The Figma half of the pipeline, and three corrections to facts the pilot got wrong.

- `design-lab:usage` — verified anonymous example addresses, placement counts and tiers via
  `find_examples.py`. Addresses are crawled and status-checked, never read from a claim
- `design-lab:tokens` and `extract_tokens_sitestudio.py` — Site Studio custom styles to
  `tokens.json`, with per-breakpoint cascade and a `codeName` per token
- `design-lab:figma-foundation` — variable collections, modes, scopes and code syntax
- `design-lab:figma-component` — one component per invocation, with assertions and a build
  record, so a 146-component library survives context resets
- `design-lab:figma-atlas` — the searchable index page, including what was refused
- `references/findability.md` — the Assets panel searches names only; descriptions are not
  an index. Category pages and an atlas of canvas text are what make a large file navigable
- `references/tokens-and-variables.md`, `references/defaults.md`,
  `references/verification.md`, `references/build-records.md`

Corrections, each verified against the repositories:

- **Type does scale on AHRI.** The pilot measured body text at 20/32 across breakpoints and
  built a single-mode type collection. 13 of 43 font-size tokens scale, Heading 2 among
  them at 48/48/42/36; Schusterman is 8 of 65. Scaling is a per-role fact
- **`coh-ce-<name>-<hash>` is not an instance marker.** It is stamped on every styled
  element of a component template - Schusterman's `cpt_content_card_0` carries eight
  hashes - so counting it inflates one site footer into 35 placements. The per-placement
  marker is `coh-component-instance-<uuid>`
- **Site Studio defaults live at `json_values.model.<uuid>.value`**, populated in 1,485 of
  1,858 fields. Select options carry no default marker at all across 4,732 options.
  Paragraphs are the opposite: `default_value` is set in 2 of 102 PNCB field instances

## 0.1.0

Initial skeleton.

- Universal component model (`references/model.md`) with three independent plug points
- Variant policy (`references/variant-policy.md`) with defaults, review flags and a hard stop
- `design-lab:detect` — strategy detection, verified on three real repositories
- `design-lab:inventory` — Site Studio and Single Directory Component extractors, doubling as a source lint
- Zero-dependency YAML fallback for Single Directory Components (no PyYAML on any local interpreter)
- `design-lab:plan` — build proposal with variant arithmetic and refusals
