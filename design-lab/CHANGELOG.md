# Changelog

## 0.10.0

**`figma-atlas` is gone, and `references/library-standard.md` is new.** Both come out of
comparing the four libraries this practice has produced — America's Credit Unions,
Schusterman, AHRI and PNCB. They share a page skeleton and almost nothing else: three
different artifact classes, four naming schemes, four variable-collection conventions, and
`components.json` files agreeing on four top-level keys.

- **`references/library-standard.md`** — the single answer to "what is a finished component
  library", at `standardVersion` 1.0.0. Artifact model, page list, component and card
  contracts, variable rules, evidence rules, the Getting Started page, the intermediate model,
  and 25 conformance checks. It versions independently of the plugin, against the *output*: a
  major means an existing library must change to stay conformant. Appendix A records which of
  the four libraries each rule came from.

- **`figma-atlas` removed; `figma-index` replaces it.** The atlas described itself as building
  "the only full-text index a Figma file has". That is false. Figma's Find searches the entire
  file across all pages, for canvas text and layer names, and the Assets panel matches
  descriptions as well as names. The atlas solved a problem Figma had already solved, and paid
  for it by flattening every field table, relation and screenshot into text — strictly worse
  documentation than the same facts drawn beside the component.

- **`figma-index`** owns the Getting Started page instead: inventory, coverage counts, the
  linked index, known gaps and provenance. It is idempotent and meant to run *early and
  often* — once before anything is built, when every row reads *not built* and that is the
  coverage baseline, then again after each component. The index is a table of contents, and
  the skill says so in as many words, so nobody rebuilds a search index by accident.

- **`scripts/index_rows.py`** — joins `components.json` with `builds/*.json` into the index
  rows. Two checks that fire on real data: `usage-data-missing` (Schusterman and PNCB both
  carry `"usage": null` for every component, so no tier can be assigned) and
  `machine-name-collision` (America's Credit Unions has 12 machine names used by two
  components each — `block:accordion` and `paragraph:accordion` — which cannot both be named
  `machine_name — Human Label`, and would have produced 12 pairs of identically-named Figma
  components).

- **`references/findability.md` corrected.** Its search table had two false rows, and its
  instruction *"if an existing library file has a page structure, adopt it"* is the single
  line that let four libraries drift into four page structures. The page list is now fixed by
  the standard. Added: what to do when a repository has no usage source at all — one
  `Components — Untiered` page and an admission on Getting Started, never a competing scheme.

- **`build-records.md`** gains `figma.documentationCardId`, the node every index row
  hyperlinks to. A record without it produces a row that cannot be jumped to.

- **`figma-component` step 12** — refresh the index after writing the build record, so the
  Getting Started page stops claiming the component is unbuilt.

- **`verify.py` goes from 12 checks to 26**, which is the standard's list exactly — the three
  places that name checks (`verify.py`, `skills/verify/SKILL.md`, the standard) are now
  identical sets. New blockers: `component-naming`, `component-description`,
  `documentation-adjacent`, `layers-named`, `mode-naming`, `no-scratch-pages`,
  `standard-version-stamped`, `verify-report-exists`. New majors: `collection-naming`,
  `fields-are-tables`, `two-usage-numbers`, `tier-thresholds-stated`, `known-gaps-current`.
  `documentation-links` is promoted from major to blocker. New flags: `--index`, `--builds`,
  `--brand`, `--out`.

- **`--out` writes the verify report**, and its absence is itself a blocker. A library that
  has never produced a report is not a finished library, and `figma-index` regenerates Known
  gaps from that file.

- **`completeness` no longer over-reports.** It matched on the human label where
  `components-built` matched on the machine name, and `_norm` strips underscores — so
  `Text Editor` and `text_editor` collapsed to one string and a file where nothing was named
  correctly reported 100% built while a blocker said the component was missing. Both now use
  one `built_keys()` builder, and the display name is never normalised. The headline coverage
  figure must never be the more generous of the two.

- **The verify state dump was wrong in two ways**, both found by running it against the live
  PNCB file rather than a fixture. Figma node proxies *throw* on an unknown property instead
  of returning `undefined`, so the `n.findAll ? …` guard raised `TypeError` on a TEXT node;
  it now tests node type. And the Known-gaps capture matched the heading text only, returning
  `"Known gaps — read before trusting a card"` and nothing beneath it, which would have failed
  `known-gaps-current` on every run — it now takes the whole section.

  Run against real PNCB state, the check set reports 11 of 44 components built and finds
  every component named by human label alone, 9 modes still called `Mode 1` or `Default`,
  `PNCB Typography` and `PNCB Type` splitting one domain, and 9 to 16 layers per card still
  named `Frame`.

## 0.9.0

**`design-lab:capture`** — the half of the pipeline that was living in a client repository.
Measuring and photographing components was done for PNCB with scripts under
`scripts/figma-spec/`, which meant the next project started from nothing. Ported, generalised
and verified against the running PNCB site.

- **`measure.mjs`** — box model, typography, fills and borders per node per breakpoint. No
  images by design: everything it records becomes a native Figma node with bound variables
- **`capture.mjs`** — element-scoped screenshots per breakpoint per state, sharing the same
  config. `states[].setup` runs in both, so a component that must be opened to be visible
  opens identically when measured and when photographed. Playwright resolves from the
  **caller's** directory, not the plugin's, which a bare import gets wrong every time
- **`scaffold_configs.py`** — writes a config per component and, more usefully, names the
  ones that will silently produce nothing. It reads each component's Twig template for a
  root selector and reports where the answer came from. A classless root is reported as
  such: PNCB's `table_row` opens with a bare `<tr>`, so no selector is derivable and the
  scaffolder says so instead of guessing

The gap this closes, concretely: PNCB had four components with no config, therefore no
measurements and no screenshots, and one of them — `table_row` — is the third most placed
component on the site at 116 placements. Nothing surfaced it until `verify` counted. It is
captured now, at 889 x 229 desktop.

Three traps are written into the skill because each produced wrong output: take the first
match with real height rather than `.first()`, since pages hold empty instances of the same
component; two components can share a root selector and the failure is invisible in a
directory listing (five PNCB components produced two distinct pictures); and never expand a
component whose measurement recorded it collapsed, which produced a 6131px image captioned
1871px.

## 0.8.0

Three gaps found by running the plugin to completion on PNCB and then asking what it still
would not have caught.

**A completeness figure on every run.** `verify` now prints `COMPLETENESS  N of M components
built`, broken down by usage tier, whether or not anything else failed, and closes with a
line saying the number needs a human answer. Partial coverage is the one defect that looks
like success from the outside: eleven good components on four well-made pages read as a
finished library right up until somebody counts. `figma-atlas` now opens by saying it is not
the last step — it is very good at making a quarter-built library look complete, because
every card it draws is a card that worked.

**Token integration rules that were only ever in someone's head.**
- `plan_variables.py` emits `LeadingRatio` and `Motion` for the CSS custom property source.
  `LeadingRatio` carries **no scopes**: CSS line-height is legally a length or a unitless
  ratio, Figma has no ratio-typed line-height variable, and binding 1.56 makes Figma read
  1.56 *pixels* and collapse every line of text. Line-height no longer routes through the
  Type collection for this strategy, where it would have become a bindable pixel value
- `figma-foundation` now states that code syntax is set **only where the Figma value matches
  the code value**. Pointing a variable at a custom property holding a different number
  gives a name that resolves, looks right in Dev Mode, and is wrong. On PNCB that was 1 of 6
  radius variables and 6 of 16 spacing variables; the rest were left with no code name
- Where no code name exists, the reason goes **on the variable**. `verify` accepts a
  description that addresses the absence and flags one that does not

**`figma-component` takes the component name.** `design-lab:figma-component <machine_name>`.
With no argument it lists the unbuilt candidates and stops rather than choosing. The build
sequence now carries what was learned building eleven of them by hand:
- **Every text node gets a TEXT property.** The step most often skipped and the one that
  decides whether a component is used at all — without it a designer detaches the instance
  to change one word, and a detached instance stops tracking the library. Five of PNCB's
  first seven had none
- **Every slot gets an INSTANCE_SWAP property**, composed from real instances of the
  components it accepts. A table containing three actual `table_row` instances shows the
  relationship; three static rows only look like it
- Property traps, each hit in practice: a colliding property name is silently renamed to
  `Content2`; a variant set needs the property wired in *every* variant, not just the
  default; never read `componentPropertyDefinitions` from a variant
- Read the description of any similarly-named component before writing a machine name. A
  library holding both `table` and `table_row` punishes a guess, and a wrong machine name is
  worse than none because it gets quoted downstream as fact

## 0.7.3

- `documentation-cards` understands the `<machine_name> — <Human Label> — documentation`
  card name from `references/findability.md`, not just `<Human Label> — documentation`.
  Renaming the cards to the documented convention made the check report all 44 as missing,
  which is the check being wrong rather than the file

## 0.7.2

- `code-syntax-set` now requires the description to *address* the blank, not merely to
  exist. The 0.7.1 version accepted any description and so passed ten PNCB colours carrying
  unrelated notes from an earlier build — a false pass, which is precisely the failure this
  check exists to prevent. A verifier that can be satisfied by irrelevant text is worse than
  no verifier, because it converts an open question into a recorded pass

## 0.7.1

- `code-syntax-set` no longer flags a variable whose blank code name is explained. An absent
  code name is not automatically wrong — a Figma font style is a string where CSS carries a
  numeric weight, and a computed pixel line-height has no equivalent where the token is a
  unitless ratio. What separates a considered blank from an overlooked one is whether anyone
  wrote down why, so a description resolves it in place. Same fix-or-waive rule, recorded on
  the variable where the next person will read it rather than in a side file

## 0.7.0

**`design-lab:verify`** — the missing step. Every skill in this plugin reported success on
its own work, and the PNCB library still ended up with four empty Foundations pages, 36 of
43 components never built, not one component carrying a documentation link, and sixteen
semantic variables whose Dev Mode code syntax named CSS custom properties that exist nowhere
in the codebase. Each step passed. Nothing looked at the whole.

The rule it encodes: **an unmet expectation resolves to a fix or a recorded waiver, never to
silence.** Waivers live in `waivers.json` with who decided, when and why, so declining
something is durable rather than re-argued every run — and so the agent cannot quietly
decide on the user's behalf.

Twelve checks, every one of them derived from something that actually went wrong:

| Check | Catches |
|---|---|
| `foundation-exists` | components built before variables |
| `code-syntax-resolves` | Dev Mode names that exist nowhere in the codebase |
| `components-built` | the plan said build, the file does not have it |
| `variable-scoped` | `ALL_SCOPES` |
| `code-syntax-set` | Dev Mode showing a bare number |
| `modes-earn-themselves` | modes whose values never differ |
| `documentation-links` | nothing leads from the Assets panel to the documentation |
| `documentation-cards` | a component with no card |
| `documentation-cards-unique` | two cards sharing a name |
| `pages-populated` | an empty page |
| `shot-frames-have-images` | a placeholder named like a capture |
| `breakpoints-share-scale` | per-frame scaling that hides responsive behaviour |
| `captures-unique` | two components whose selectors resolve to one element |

`code-syntax-resolves` is the one worth having on its own. It greps every code syntax against
the real codebase, and it degrades to a `minor` "not checked" finding rather than a pass when
`--theme-root` is absent — a check that did not run is not a check that passed, and
conflating the two is the whole failure this release exists to stop.

First run against PNCB: 4 passed, 17 open, 0 waived.

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
