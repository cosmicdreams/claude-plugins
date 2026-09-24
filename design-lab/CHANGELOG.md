# Changelog

## 0.14.0

**Model-native orchestration without model-dependent bookkeeping.** The plugin now gives a
modern model judgment where judgment helps—source selection, variant policy, and fidelity—while
moving state, validation, idempotency, and completeness into deterministic tools.

- Added `design-lab:run` and `scripts/workflow.py`: one resumable front door backed by
  `.design-lab/project.json`, repository/target identity, explicit decisions, phase state,
  artifact hashes, plan approval, and a completion gate.
- Added standard JSON Schemas and dependency-free validation for project, detection,
  components, tokens, plans, variable plans, and build records. Writes are atomic; an invalid
  replacement cannot destroy the last valid artifact.
- Added the combined `drupal-authoring` strategy. Block types and Paragraph types form ACU's
  69-item editor vocabulary; its 109 SDCs are rendering primitives and no longer win by raw
  count.
- Added bounded Drupal rendering evidence. One deterministic pass maps every authoring bundle
  to existing Twig templates, included SDC definitions, adjacent stylesheets, root classes,
  referenced fields, and suspicious missing fields. The model can spend judgment on fidelity
  instead of launching broad searches for each component.
- Added source-authored Sass extraction, cycle-safe memoized resolution, typed variable
  planning, and reference collections for breakpoints and container widths. Theme-loaded CSS
  is matched by exact path so basename collisions and module-local properties cannot select a
  false token layer.
- Replaced repeated procedural skill prose with concise decision contracts pointing to the
  versioned standard. Added deterministic Figma state-dump scripts so verification no longer
  asks the model to reproduce long inspection programs from memory.
- Added validated foundation, index, and verification receipts. Artifact kinds are persisted
  in the manifest, unknown kinds fail closed, and an invalid receipt cannot mark its phase
  complete.
- Component completion is now derived from approved-plan coverage. Registering one build
  receipt leaves the phase running; only valid, non-failing receipts for every planned build
  can complete it, and whole-project validation detects missing or stale receipts.
- Fixed completeness verification silently ignoring the planner's actual top-level `plans`
  key. A parsed-but-empty plan now blocks instead of disabling the check.
- Added regression tests for atomic writes, schemas, Drupal source ranking, Sass planning,
  resumable workflow state, and plan completeness.
- Added deterministic DDEV-backed Drupal usage extraction. It reproduces ACU's 10,645 direct
  placements and 6,305 nested structural instances across all 69 components, registers
  `usage.json` as its own validated artifact kind, and blocks planning when detected usage was
  silently skipped.
- Resolved `list_predefined_options` values from their PHP plugins instead of treating Drupal's
  exported placeholder rows as real enum choices. ACU now resolves all 20 affected fields
  without model-written repair scripts.
- Bundle stylesheets are additive to child SDC stylesheets, so including `back-link` no longer
  hides `banner.scss` or `image-banner.scss`. Components and tokens now enforce and emit the
  standard's required `toolVersion`.
- Added bounded Sass `styleFacts` to Drupal render evidence. Root and nested-part declarations
  remain separate and retain whether each value came from a CSS custom property, Sass variable,
  or literal, eliminating another component-by-component source-search loop for the model.
- Verification now uses those deterministic facts to block a component that consumes a source
  token but binds no Figma variable, even when browser captures are unavailable. The state dump
  also counts bindings on the component root instead of descendants only.
- Detection no longer reports the active `.design-lab/figma-batches` workspace as external
  prior art merely because `workflow init` created it before discovery.
- Models can report unavailable evidence but can no longer authorise their own degraded path:
  usage and phase waivers now require a named human decider and non-empty reason, both validated
  in the durable project manifest. Final verification also refuses unresolved prerequisite
  phases, including capture.
- Common Drupal contrib fields (`email`, `telephone`, `smartdate`, and `block_field`) now map to
  the standard's text/reference kinds instead of being mislabeled as source-code defects.
- Re-running discovery, extraction, usage, planning, variable planning, or changing the Figma
  target invalidates dependent phase claims and receipt registrations while preserving the raw
  files for diagnosis. Resume can no longer mistake stale downstream evidence for completion.
- Build receipts now require a non-empty set of explicitly passing assertions. `not-run`,
  `skipped`, empty, and missing verdicts fail both artifact registration and whole-file
  verification instead of silently counting as finished work.
- The component skill now explicitly forbids using an editor-field anatomy diagram as the
  publishable component master. The master represents rendered UI; field anatomy stays on the
  documentation card, and insufficient rendering evidence fails or refuses the transaction.
- Figma state dumps and verification now recognize both documented card-root conventions
  (`— documentation` and `Human Label · machine_name (Family)`) and common durable index-row
  prefixes. This removes false negatives discovered during the ACU control replay.
- Added first-class component-scoped capture evidence. The planner now distinguishes visual
  components, mapped subcomponents, schema-only entities, and retirement candidates; it refuses
  to publish a master when no live screenshot proves the component's visual identity.
- The Getting Started index is now placement-first and keeps component-master and documentation
  links separate. Canonical double-underscore build-receipt filenames resume correctly, repeated
  tier headers verify cleanly, and qualified Drupal source ids prevent block/paragraph name
  collisions from inflating completeness.
- Documentation is now source-complete decision support: Head, When to use, every authored
  field/property, every component relationship, desktop/tablet/mobile evidence, native Figma
  configuration, a root-relative label linked to the canonical FQDN, and actionable Notes.
  Refused and structural inventory rows remain traceable without fake component pages.
- Variable planning prefers one collection with slash-delimited groups unless lifecycle or mode
  boundaries justify another collection. Source-authored Sass now outranks a thin compiled-CSS
  palette, and map members without standalone code names carry an explicit Dev Mode explanation.
- Added live anonymous Drupal example verification, targeted multi-breakpoint capture, and a
  capture-evidence assembler. Screenshots are mandatory documentation evidence but can never be
  the publishable component root. Build receipts now prove native node type, source anatomy,
  three-width comparisons, and real nested instances for rendered source relationships.
- Browser-based capture and measurement accept
  `DESIGN_LAB_BROWSER_EXECUTABLE`, allowing a reproducible system-Chrome path when Playwright's
  managed Chromium is unavailable.

**Deterministic Figma builds.** The KINGTEC evaluation showed a model relaying hand-written
layout code could not build the same library twice. Layout decisions moved into fixed templates
and scripts, and the model's remaining job shrank to relaying steps — or to nothing.

- Added `scripts/figma_build.py`: the whole library build as a fixed sequence of steps over
  fixed `scripts/render/*.js` templates. Each payload carries its arguments and a checksum, so
  a payload altered in transit is refused rather than built. `next` refuses to run if the
  templates changed since `init`.
- Added the design-lab runner (`runner/` plus `scripts/figma_runner.py`), a Figma development
  plugin that fetches each step from localhost and posts the result back. No model is in the
  loop, so a build costs no tokens. Three KINGTEC builds produced 7,389 nodes with zero layout,
  style, typography, or binding differences between runs.
- Added `spec_to_tree.py` and `responsive.py`: measured components become one deterministic
  Figma tree, and three breakpoint measurements merge into one responsive master instead of
  per-breakpoint drawings.
- Added `compare_runs.py`, `determinism.py`, and `figma_compare.py` for repeatability scores,
  canonical layout hashes, and per-variant comparison against live captures.
- Added published-site extractors: `extract_compositions.py` (component sequences per page),
  `extract_voice.py` (the copy voice report, see `references/voice.md`), Drupal Canvas
  registrations and usage, `find_rendered_components.py`, and `capture_all.py` to run capture
  end to end.
- Added `fetch_images.py`, which re-encodes AVIF and other formats Figma cannot upload as PNG.
- `references/relay.md` documents the runner, its one-time manual import into Figma desktop,
  and the model-relay fallback. The README gives a prompt that produces machine-specific install
  steps.
- Fixed the Drupal usage crawler skipping certificate verification for every HTTPS site,
  including public production pages. Verification is now relaxed only for local development
  hosts (`localhost`, loopback, `*.ddev.site`, `*.localhost`). The same rule now covers every
  published-site extractor: `find_rendered_components.py`, `published_pages.py`,
  `extract_voice.py`, and `extract_compositions.py` had still accepted any certificate.
- Build records no longer assert what nobody checked. The block step now reads the master
  back from the canvas — its node type, whether its root carries an image fill, every nested
  instance and the component it comes from, and the field rows actually drawn — and the
  native-component flags are derived from those readings. A slotted component with no real
  nested instance now fails relationship coverage instead of passing on a hard-coded `true`,
  and a block recorded before these readings existed fails closed.
- Slot `accepts` is always a list: `["*"]` means any component. Every extractor used to write
  the bare string `"any"`, which the build-record schema rejected and verification compared
  letter by letter; older inventories are read the same way.
- The runner is locked to the plugin. The server prints a random token when it starts, the
  plugin asks for it once and keeps it, and every request without it is refused. Cross-origin
  reads are allowed only for a plugin's own origin instead of any web page, so a page that
  learns a file key can neither read steps nor forge results. The unused `--port` flag is gone,
  a malformed request body gets an error reply, and two workspaces claiming one Figma file are
  refused instead of one silently replacing the other.
- A component captured at only some widths now gets a build record with a failing
  `breakpoint-evidence` assertion naming the missing widths, instead of stopping receipt
  generation for every component. Each capture now lands in the rectangle of its own column
  when a width was captured but not measured.
- Components with no usage tier get a `Components — Untiered` page instead of stopping the
  build; with no usage source at all, the five tier pages collapse into that one, as the
  standard requires.
- An image that cannot be fetched no longer stops the build: it is recorded as failed and the
  build record's image-upload assertion names it. SVG is rasterised to PNG with cairosvg when
  installed and otherwise recorded as failed, because Figma cannot use SVG as an image fill. An
  upload the plugin cannot complete now fails its step, so it is reported rather than recorded
  as done.
- `compare_runs.py` reads the page dumps the runner writes to `figma/dump/`, so the build's
  state file is no longer compared as a page, and it compares the variables step's recorded
  result.

## 0.13.0

**The build side now instructs what the verify side checks.** An audit of all 30 checks
against the build skills found 8 with *no* build-side instruction at all and 5 only implied.
The verifier had been running ahead of the builder, which means a faithful run of the pipeline
produced a library its own verifier rejected.

- **`figma-component` builds the documentation card again.** Deleting `figma-atlas` in 0.10.0
  took the only "build every card" instruction with it — a regression this release introduces
  the fix for. The card is now step 9, built beside its component on the same page, with the
  section 5 anatomy, the fields **table**, named layers, and `shot:`/`scale:` frame naming.
  Folding it into `figma-component` rather than restoring a separate skill is deliberate:
  adjacency is then true by construction, which is what `documentation-adjacent` requires.

- **`figma-foundation` creates the file's pages.** Nothing did. `figma-component` was told to
  "resolve the target page from the usage tier" against pages that no skill had ever made.

- **`figma-foundation` names collections `<Brand> <Domain>`.** It previously specified
  `Primitives`, `Semantic`, `Spacing`, `Type` — unprefixed, which is exactly what
  `collection-naming` fails. The build skill was instructing the defect. Mode naming is now
  explicit too, rather than left to whatever the variable plan generated.

- **All six extractors stamp `standardVersion`**, and `model.md` and `build-records.md` carry
  it in their example shapes. Section 10 required it and nothing wrote it. Verified end to end
  against the real America's Credit Unions repository: 33 paragraph components extracted with
  `standardVersion: 2.1.0`.

- **`figma-component` step 2 handles machine-name collisions** and step 6 states the
  `COMPONENT_SET` requirement outright.

### Two bugs of mine, both silent

- **`structuralRefs` was read as `structuralReferences`** in `index_rows.py` and `verify.py` —
  a key that exists nowhere in `references/model.md`, in `find_examples.py`, or in any real
  artifact. It always resolved to `None`. Consequences: `two-usage-numbers` failed every
  library that had the data (all 69 America's Credit Unions components carry it), and
  `tier_of()` could never assign the Structural Only tier, so **every load-bearing component
  was tiered as a retirement candidate**. On America's Credit Unions that moved 3 components
  out of a list headed "safe to delete" — Structural Only 0 → 3, Retirement Candidates
  17 → 14. Both readers now use the model's key and accept the longer spelling rather than
  silently returning zero.

## 0.12.0

**Standard 2.1.0 — the last three unenforced expectations now have checks**, bringing the set
to 30. Each enforces something the standard already required in prose, which is why this is a
minor rather than a major: a library genuinely conformant to 2.0.0 stays conformant.

- **`index-complete`** (blocker) — every component in the inventory has a row in the index,
  *and* the page rendered into Figma is not stale against the index it was generated from.
  Both are checked, because a reader trusts the page, not the JSON. Section 8 said "every
  discovered component gets a row" and nothing had ever confirmed it; `--index` was read for
  exactly one thing, the tier thresholds.
- **`index-links-resolve`** (blocker) — a built component whose index row links to nothing is
  a component nobody reaches from the one page that claims to list the library.
- **`variants-are-sets`** (blocker) — variants left as loose components instead of a
  `COMPONENT_SET`. Only a set gives Figma a variant picker and lets the variants be compared
  against each other, which is the whole point of building them. Uses `plan.json` where
  available; otherwise detects the shape the mistake takes on canvas — several loose
  components sharing one machine-name stem. Section 4.4 now states the requirement outright
  rather than presupposing it.

- **The state dump captures node type and variant count**, without which a loose component
  cannot be told from a set, and an `indexRowCount` read from the rendered page. The index
  container is named `Index` and each row `row: <machine_name>` so that count is possible.

- Checks that cannot run still report "not checked" rather than passing. Run against the real
  PNCB artifacts, `index-complete` confirms all 44 components are listed and
  `index-links-resolve` passes, while `variants-are-sets` correctly declines to answer because
  that state dump predates the node-type field.

## 0.11.0

**Standard 2.0.0 — the library is a seed of ground truth, not an idealisation.** This inverts
a rule that was stated in three places and was actively harmful.

The plugin previously instructed the builder to bind every visual property to a variable and
to *"finish at zero hardcoded fills — assert it"*, and `verification.md` asserted that a raw
value was a defect. That silently upgrades the component. A theme that hardcodes `#342649`
where it should use `--bs-purple` produced a Figma component with a clean bound variable: the
flaw vanished, the designer best placed to notice it never saw it, and the two sides were
never comparable, which makes any later sync meaningless.

- **`library-standard.md` section 1** now opens with the governing principle: the Figma
  component is a faithful representation of the component as the running site implements it,
  **including its defects**. Bind where the source binds; hardcode where the source hardcodes,
  and record the divergence as a defect about the codebase. Never improve a component on the
  way into Figma. Divergence between Figma and code is the product.
- **`figma-component` step 3** and **`verification.md` section 2** rewritten to match. The
  binding assertion is now three-outcome — source binds and Figma binds, source hardcodes and
  Figma hardcodes, or a mismatch — and only the mismatch fails.
- **This is a major standard version** because a library built under the old rule can fail the
  new check.

- **`measure.mjs` records declared values, not just computed ones.** `getComputedStyle`
  resolves `var(--bs-purple)` and `#342649` to the identical `rgb(52, 38, 73)`, so the
  pipeline had no way to tell a token from a literal and the fidelity rule would have been
  unactionable. It now reads the raw declaration off the matching rules. Cascade order is
  approximated by document order plus matching media queries, not by specificity — stated in
  the code rather than implied, because that approximation can disagree with the browser.

  Verified against the live America's Credit Unions homepage: `body` computes to
  `rgb(52, 38, 73)` and declares `var(--bs-body-color)`; `h1` computes to `80px` and declares
  `var(--k--typography--font-size-h1)`; `a` declares the literal `transparent` for its
  background and is correctly distinguished.

  That run also found a defect in the existing library. America's Credit Unions' `tokens.json`
  records `type/size/h1` with `codeName: null` and the description *"No custom property holds
  this value. Only the base body size is emitted, as --bs-body-font-size."* The site actually
  renders h1 through `--k--typography--font-size-h1`. The blank was explained by a wrong
  explanation, and `code-syntax-set` passed it because it only checks that *an* explanation
  addresses the absence, not that the explanation is true.

- **New check `bindings-match-source`** (blocker), bringing the set to 27. It compares the
  source's declared values against the Figma component's bindings and fails a component that
  binds where the code hardcodes, or hardcodes where the code binds. Compared at component
  level, not per property — mapping a CSS node path onto a Figma node identifier is a real
  problem this does not pretend to solve, and the check says so. Degrades to a `minor`
  "not checked" without `--measurements`.

- **The verify state dump captures `boundVariables`**, which it never did — so nothing had
  ever looked at whether a built component binds anything at all.

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

- **A check with no subject now reports `N/A`, not `PASS`.** Measured on America's Credit
  Unions, whose Figma file contains zero components: five component checks and one shot check
  had nothing to fail on, so the file scored 17 of 26 passing. It now scores 11 passed, 6 not
  applicable, 12 open. Reporting a vacuous pass is the same error as reporting an unrun check
  as passing, and it flatters exactly the libraries that deserve it least.

- **`pages-populated` no longer treats unloaded as empty.** Figma loads pages on demand and an
  unloaded page reports `0` children whatever it holds — the America's Credit Unions Atlas
  page reads `0` before `setCurrentPageAsync` and `76` after. The state dump took its counts
  from the root iteration, so this check would have fired on nearly every page of every file.
  Counts now come from the per-page pass, and a page never made current is reported as
  unmeasured rather than empty.

- **`code-syntax-resolves` degrades to `minor` when the theme has no compiled CSS.**
  Bootstrap-style frameworks emit their custom properties at build time, so grepping a
  repository whose `dist/` is gitignored reports every one as dangling — eight of them on
  America's Credit Unions, at blocker severity, for properties that do resolve in the
  compiled `index.css` its own tokens.json cites.

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
