# Changelog

## 0.6.0

`figma-atlas` specified a *text card* per component — a handful of lines of canvas text. Run
against a real library that is visibly not documentation, and the comparison that proved it
was the Schusterman Components 2026 file, which had already solved this properly. Same lesson
as `references/prior-art.md`: the existing artifact was better than the plugin's spec.

- **`figma-atlas` now specifies the full card anatomy** — 940-wide cards in a two-column
  grid: eyebrow with machine name, title, a stats row, verified live example, a
  Field/Type/Req./Limit table with explicit truncation, and a breakpoint row
- **One shared scale per component in the breakpoint row.** Scaling each breakpoint
  independently to fill its slot is the obvious implementation and it silently destroys the
  point: a 969px desktop and a 740px tablet render identical widths, so the component reads
  as not responsive. Hit while building PNCB's cards
- **`shot:` versus `scale:` naming.** A frame named `shot:<name>:<Breakpoint>` claims to hold
  a capture. When only measurements exist, the frame is a `scale:` diagram and the row says
  `measured, drawn to scale`. A grey box named `shot:` overstates the file's fidelity
- **`figma-component` step 8 now points documentation links at the atlas card**, and
  `figma-atlas` asserts they are set. An empty `documentationLinks` is the commonest way a
  library looks finished and is not — all seven of PNCB's built components had one
- **`references/verification.md`** gains four documentation assertions

## 0.5.0

`detect.py` could always *recommend* `css-custom-properties`. Nothing implemented it, so on
a theme that had moved off Sass the recommended strategy had no extractor behind it. This
adds the missing third token source, and it turns out to be the best of the three.

- **`extract_tokens_cssvars.py`** — the CSS custom property extractor. Reads only
  stylesheets a `*.libraries.yml` actually loads, prunes `core/` and `contrib/`, tracks the
  selector and media query per declaration, and resolves `var()` chains including the
  fallback argument. On PNCB's `css-candidate` branch: 94 tokens from 5 loaded stylesheets,
  against 1,023 from 174 before core was pruned
- **`plan_variables.py` derives the semantic layer for this strategy.** Custom properties
  are *authored*, so the names state intent where a Sass name does not. Colours are grouped
  by normalised hex; the member with no role word in its name is the palette entry and the
  rest alias it. PNCB gets 32 semantic variables across `text/*`, `surface/*`, `border/*`
  and `action/*` — the gap the 2026-08-31 comparison called the most important one, closed
  from evidence rather than invented
- **New collections** — `Radius`, `FontWeight`, `LetterSpacing`, each with correct scopes,
  driven by whatever the source actually declares
- **`typeScaling` is genuinely answerable here.** A token that scales must be redeclared
  under a media query, which is directly observable — unlike a Sass source map, where it is
  not. A `roleLevelCaveat` records what this still cannot see: a component rule that swaps
  which token it uses at a breakpoint. PNCB has 6 such rules

**Behaviour change, and it alters previously-shipped output.** `num()` is now unit-aware.
Figma FLOAT variables are pixels, and the old reducer stripped the unit, so `2.25rem` became
`2.25` — binding a 36px heading as **2.25 pixels**. This was already wrong on both verified
Site Studio sites, not just on the new strategy:

| Site | Token | Was planned as | Now |
|---|---|---|---|
| AHRI | `Blockquote Paragraph` font-size `1.1rem` | 1.1 px | 17.6 px |
| AHRI | `Blockquote Paragraph` line-height `2rem` | 2 px | 32 px |
| Schusterman | `Breadcrumbs` margin `1.5rem` | 1.5 px | 24 px |

Percentages now return `None` rather than a bare number, because a percentage is not a
pixel length and guessing one is worse than declining.

Otherwise regression-clean: every other value in AHRI's and Schusterman's `variable-plan.json`
is unchanged.

## 0.4.0

The Figma half of the pipeline could not run on a Paragraphs site at all. `design-lab:detect`
recommends `sass-sourcemap` for PNCB, and `plan_variables.py` crashed on its output with
`KeyError: 'modes'` — so `figma-foundation` never ran, and `figma-component` refuses to start
without it. Everything here came from running the plugin end to end against PNCB and hitting
that wall.

- **`plan_variables.py` normalises token schemas instead of assuming one.** The three plug
  points vary independently, but the planner only ever read the Site Studio shape. It now
  maps `sass-sourcemap` output into the canonical shape and **refuses outright** on a schema
  it has no normaliser for. Defaulting the missing key was the tempting fix and the wrong
  one: every other lookup is `.get(...) or []`, so the planner would have reported four
  successful collections while silently discarding all 236 recovered tokens
- **`extract_tokens_sourcemap.py` emits `codeName`.** `references/tokens-and-variables.md`
  has always specified `$brand-blue` for this strategy; the extractor never wrote it, so
  every variable would have shown a raw hex in Dev Mode. All 64 PNCB primitives now carry one
- **`extract_tokens_sourcemap.py` evaluates `lighten()` and `darken()`.** Verified exactly:
  `lighten($periwinkle-dark, 10)` → `#7c92e5`, `lighten($periwinkle-dark, 20%)` → `#a7b6ed`.
  Both were previously recorded as PNCB colours with **no configuration provenance**. They
  have exact provenance; the resolver just stopped at the function call
- **`typeScaling` is emitted explicitly as not observable**, rather than being absent. A
  source map has no CSS property and no media query attached to a declaration, so per-role
  scaling cannot be derived from it. `noneScale` now has three states — `true`, `false`, and
  `null` with `observable: false` — because an absent key read as "nothing scales" is the
  same error `figma-foundation` already warns about
- **`detect.py` performs the prior-art probe itself** and returns `priorArt` plus a leading
  `PRIOR ART:` note. It lived only in skill prose, so running the script directly skipped the
  single most expensive lesson in the plugin. It now also searches `reports/`, `docs/`,
  `design/` and `.storybook/`: on PNCB the old probe found **nothing**, while `reports/` held
  six artifacts including a complete Figma structure comparison
- **`extract_paragraphs.py` reads `default_value`** instead of hardcoding `None`. 0.2.0
  measured this as set in 2 of 102 PNCB field instances and then discarded it, leaving
  `plan.py` unable to compute the implicit unset option when deriving a variant axis

Regression: `variable-plan.json` is byte-identical to 0.3.0 on both AHRI and Schusterman.

Not fixed, recorded instead: the **semantic colour layer cannot be derived for this
strategy.** Site Studio colours carry tags saying what they are *for*; a Sass variable
carries only a name. `plan_variables.py` now emits one `semantic-layer-needs-authoring`
warning rather than five identical near-misses, and the layer stays empty until a human
names it.

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
