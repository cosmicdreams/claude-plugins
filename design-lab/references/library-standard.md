# The component library standard

**Standard version: 4.0.0**

Every library design-lab produces conforms to this document. It is the single answer to "what is a finished component library", so that two people running the plugin against two unrelated codebases — one Drupal with Site Studio, one not Drupal at all — hand back artifacts a third person recognises as the same kind of thing.

The source data will differ wildly. The result must not.

## How to use this document

- `verify.py` checks against this file. A finding is a **blocker** or a **major**. A visual-fidelity blocker cannot be waived while the component is reported as built.
- Every artifact stamps `standardVersion` so a library can state which edition it was built to.
- Deviations are permitted where a codebase genuinely cannot supply something. They are **recorded on the Getting Started page in plain language**, not left for a reader to discover.

## How this standard evolves

Semantic versioning against the *output*, not the plugin:

- **Patch** — clarified wording, no library changes shape.
- **Minor** — a new optional expectation, or a new recorded field. Existing libraries stay conformant.
- **Major** — an existing library must change to stay conformant.

Raising the bar is the point. When a library invents something better than what is written here, that invention gets promoted into this file and the version goes up. The four libraries in [Appendix A](#appendix-a--where-this-standard-came-from) are how version 1.0.0 was derived; the same route stays open.

---

## 1. What a finished library contains

A library is **components and documentation, paired**. Not a component set with docs bolted on, and not a documentation atlas that happens to sit in Figma.

For every **visual component** in build scope, all three exist and reference each other:

1. A real Figma component or component set, on its usage tier page.
2. A documentation card, adjacent to that component on the same page.
3. Links both ways — the component's `description` carries the searchable payload and points at the card; the component's `documentationLinks` jumps to it.

A source entity that is schema-only, a subcomponent of a larger visual whole, retired, or not visually verifiable is not promoted to a Figma asset. It stays in the index with its role and reason. Inventory completeness and component-library quality are different measurements.

### A component is a rendered, reusable visual whole

Configuration entities are discovery inputs, not an instruction to create one Figma component apiece. A buildable component must have:

- a distinct rendered root in the running site;
- at least one verified, anonymously reachable live example;
- a captured reference image at the target state and width;
- an interaction or content contract that makes sense as one reusable asset; and
- a Figma master whose default state visually matches that reference.

Field schemas explain configuration. They do not define the visible boundaries of a component. A frame containing labels such as `field:`, `caption:`, `required`, or `placeholder` is an authoring diagram unless those labels literally appear on the site. Authoring diagrams may exist in supporting documentation but **must never be published as the component master**.

### The file is a seed of ground truth, not an idealisation

This is the governing principle, and it overrides every convenience below.

**The Figma component is a faithful representation of the component as the running site actually implements it — including its defects.** The rendered page and its captured states are the visual authority; source files explain why it looks and behaves that way. Where the code resolves a value through a token, the Figma node binds the corresponding variable. Where the code hardcodes a literal, **the Figma node carries that literal too**.

The purpose is a file both developers and designers can work from and then sync in either direction. That only works if the two sides describe the same thing. A Figma component that binds a variable where the code hardcodes a hex is not a tidier version of the truth — it is a different component, it hides the defect that a designer is best placed to notice, and it makes every subsequent diff meaningless because the two sides were never comparable.

So:

- **Never improve a component on the way into Figma.** Not spacing, not colour, not type. If it looks wrong, that is the finding.
- **A hardcoded value in the code becomes a hardcoded value in Figma plus a recorded defect**, surfaced on the card, so somebody can decide to fix it in the code and re-sync. Silently binding it destroys the signal.
- **A screenshot comparison is part of the build receipt.** A component cannot be `built` until its Figma default state has been compared with its captured live reference and passed.

Idealising the library is the tempting failure here, because the idealised version is prettier and every individual decision to tidy one value looks harmless.

### Why adjacency is a rule, not a preference

Documentation on a different page from its component means every question costs a page change, and the two drift apart the first time either is regenerated. Segregating built components onto their own page — as one existing library does — has the same failure in the other direction.

---

## 2. Search is Figma's job, not the library's

Two native surfaces already index the file. **Build for them; do not reimplement them.**

| Surface | Scope | Matches | What the library must therefore do |
| --- | --- | --- | --- |
| **Assets panel** | file-wide, open while placing components | component **name and description**, plus semantic matching | put the payload in `description` (§4.2) |
| **Find** (`Cmd`/`Ctrl`+`F`) | **entire file, all pages**, filterable by layer type | canvas text **and layer names** | name every documentation layer with the machine name (§5.1) |

A separate full-text index page is therefore **not** a requirement, and must never be justified as one. Figma's Find has searched all pages for some time; any library or skill claiming otherwise is stating something false to its readers and must be corrected.

---

## 3. File structure

Pages, in this order. Names are exact.

```
Cover
Getting Started
Foundations — Color
Foundations — Typography
Foundations — Spacing & Layout
Foundations — Elevation & Shape
Foundations — Brand Voice & Language
Components — High Use
Components — Medium Use
Components — Low Use
Components — Structural Only
Components — Retirement Candidates
Examples
```

Rules:

- **A Foundations page exists only if the token source has values for it.** Omit `Elevation & Shape` when the codebase defines no shadows or radii — and say so under Known gaps. Never publish an empty page; an empty page reads as "this system has none of these", which is a different claim from "we could not find any".
- **A component tier page always exists**, even at zero components, because absence is the finding. Its header panel states the count, placements and thresholds; an empty tier says why in one line.
- **Every page is drawn by a fixed template** from `scripts/render/`: `pages.js` creates and orders them, `cover.js`, `getting_started.js`, `foundation.js` and `tier_page.js` draw them. A Foundations page is one 1440-wide panel; colour swatches are 152 × 96 and bound to their variable; type is shown at true size with a one-line specification; spacing as bars whose width is bound to the variable.
- **Foundations — Brand Voice & Language** exists when the published pages could be read. Every statement on it is measured from the site's copy (§9.1); it is never taken from a brand document and never invented.
- **Examples** exists when page compositions were read. It recomposes up to three real pages from INSTANCES of the library components, in the order the live page renders them, at desktop and at mobile. It holds no components.
- **No divider pages.** Typographic separators like `——— FOUNDATIONS ———` are unnavigable, appear in Find results as noise, and do not survive a rename.
- **No `Internal Only Canvas`, no scratch pages, no `Components — Built`.** Working surfaces do not ship.
- Additional Foundations pages are allowed where the token source justifies them. Additional *component* pages are not — the tier axis is the only page axis (§7.2).
- **Where the repository has no usage source at all**, tiers cannot be computed. Collapse the five tier pages to one, named `Components — Untiered`, ordered by the source's own grouping, and state on Getting Started that no usage source was available and what that costs the reader. Never substitute a second organising scheme; one shape that admits a gap beats two shapes that compete.

---

## 4. The component contract

### 4.1 Naming

```
machine_name — Human Label
```

Em dash, spaces both sides. Both halves are mandatory.

The machine name serves Find and the developer; the human label serves the Assets panel and the designer. A library naming components only `cpt_text` fails every designer who does not know the codebase; one naming them only `Text Editor` fails every developer trying to trace a template. Neither is acceptable alone.

**One Figma component per source component — a single source of truth.** A viewport is never a separate component and never a variant: the component is responsive. Every value that differs between widths is a variable in the `Breakpoint` collection (modes `Desktop 1400px`, `Tablet 800px`, `Mobile 375px`, Desktop the default), and a layout that changes shape between widths is expressed as wrapping auto layout whose widths and offsets are those variables. Mobile and tablet are INSTANCES of the component, resized, with the Breakpoint mode set on the instance or a parent frame. `no-duplicate-components` is a blocker.

**A component with more than one real variant (a content option such as media position) is a `COMPONENT_SET`, never loose siblings.** Only a set gives Figma a variant picker, and only a set lets the variants be compared against each other — which is the whole reason for building them. Loose components sharing a name stem look almost identical on the canvas and behave nothing alike on an instance.

Component sets take the same name. Variants are named by their axes, never by the component.

### 4.2 Description — the searchable payload

`description` is the library's primary search surface. It is structured prose, not a sentence. Required content, in this order:

1. **What it is in the source system** — the type and its machine name.
2. **Usage** — tier, placement count, page count. Real counts, never estimates.
3. **Configuration** — the variant axes and properties a designer can actually change.
4. **Example path** — the portable root-relative path of a verified live example, such as `/blogs/compliance`, not a local hostname.
5. **A pointer to its documentation card.**

Anything a reader would search for belongs here. Synonyms and the terms authors actually use are worth including even when they appear nowhere in the codebase.

### 4.3 Documentation links

Every component carries `documentationLinks` pointing at its card. This is the jump from Assets panel to full documentation and it is a blocker when missing.

### 4.4 Variants

Variant axes follow `variant-policy.md`. A component whose axes would explode is refused at plan time and recorded as not built with the arithmetic shown — never quietly truncated.

---

## 5. The component block

One block per built component, on its tier page. The block is the component's documentation
and its specimen in one frame, so the two cannot drift apart. It follows the pattern the best
single-site libraries share (Ontario, the United States Web Design System, GOV.UK, figma.com):
the real component at real breakpoints, side by side, with a short fixed documentation panel
beside it. Heavier documentation belongs in `components.json`, where a machine can read it.

The block is drawn by `scripts/render/component_block.js` from arguments `figma_build.py`
computes. Nothing in it is laid out by hand, so it is identical on every run.

Left, the **documentation panel** (560 wide, white, 40 of padding), sections in this order:

| Section | Contains |
| --- | --- |
| `Head` | tier, human label, machine name, the source's own description of the component, chips for group and global chrome |
| `Usage` | author placements, structural references, public pages it renders on, a live example (the portable path, linked), its source directory |
| `Figma properties` | every property on the Figma component: name, type, values, default |
| `Fields` | every authored field and slot: source name, kind, required, and how it appears in Figma |
| `Relationships` | components it contains, components it is placed inside, theme templates that render it |
| `Notes` | only recorded source defects, at most four |

Right, the **specimen**: breakpoint column labels (`Mobile · 345px`, narrowest first), then
the ONE component shown at every width — instances resized to mobile and tablet with their
Breakpoint mode set, and the master itself at desktop — then `Live reference`: the captured
screenshots in the same columns at the same scale, so a reader compares by looking down. The
automatic comparison (`figma_compare.py`) measures each pair from one screenshot of the
specimen and records the result in the build record.

Rules:

- **The component is the rendered interface.** Built by `scripts/responsive.py` from the three
  measured widths: auto layout wherever auto layout reproduces the measured positions within
  two pixels at every width; otherwise a wrapping row of slots whose widths and offsets are
  Breakpoint variables; absolute positions only when neither can, and the choice recorded.
- **The desktop, tablet and mobile trio is required** for every asset reported as built, as
  the master plus two instances and as live reference. A width without a trustworthy capture makes the component
  `Not built — incomplete visual evidence`.
- **Fields are source-complete.** A component with no fields says so. An option axis the capture
  cannot show (only the rendered option is drawn) is named in `Fields` and under Known gaps,
  never silently dropped.
- **No authoring diagrams.** Field names never appear inside the component master.
- **Dates stay out of blocks.** A block built on Tuesday and one built on Wednesday from the same
  source must be identical; dates live in the Getting Started changelog.

### 5.1 Layer naming

The block root is `Human Label · machine_name`; the panel is `Documentation · machine_name`.
Layers inside the set are named from the source's own classes (`kt-stat__value` becomes
`Value`) or, failing that, from the element (`Heading`, `Image`, `Link`). A layer named `Frame`
is a blocker.

### 5.2 The documentation style

Documentation is neutral and belongs to design-lab, not to the site. The site's own colours and
fonts appear only inside components and foundation specimens, where they are the subject.

| Role | Style |
| --- | --- |
| Title | Inter Semi Bold 40/48, #18181b |
| Heading | Inter Semi Bold 24/32 |
| Section label | Roboto Mono Medium 12/16, uppercase, tracking 1, #71717a |
| Body | Inter Regular 14/22, #3f3f46 |
| Table cell | Inter Regular 13/20; header Roboto Mono Medium 11/16 uppercase on #fafafa |
| Code identifiers | Roboto Mono Regular 12 |
| Link | #1d4ed8, underlined |
| Panels | white, radius 12, 1-pixel #e4e4e7 border, 40 padding |
| Page background | #f4f4f5 |
| Spacing | 4, 8, 16, 24, 32, 48, 80, 160 — nothing else |

These values live in `scripts/render/_kit.js` and only there.

---

## 6. Variables

### 6.1 Collections and groups

Use the fewest collections that preserve real system boundaries. Collections are for independent modes, publishing/ownership, or lifecycle. Groups are for navigation.

- A single-mode system with one owner normally uses one brand-prefixed collection, such as `<Brand> Core`, and slash-delimited groups such as `Color/Primitive`, `Color/Semantic`, `Spacing`, `Typography`, and `Shape/Radius`.
- Separate collections only when they have different mode sets, must be published independently, or are owned and maintained independently. Record that reason in the foundation receipt.
- **A collection or group exists only if the token source has values for it.** Never invent a domain to look complete.
- **Never split one conceptual domain across competing collections.** Carrying both `Typography` and `Type` guarantees the wrong one gets bound.
- Primitives hold raw values. Semantic aliases them by role. **Where the code resolves a value through a token, the component binds Semantic rather than the primitive** — a theme change is then one edit, not a hunt. Where the code hardcodes, the component hardcodes too (§1) — binding a variable the code does not use is a fidelity failure, not an improvement.

### 6.2 Modes

Mode names state what the mode holds.

- Single-mode collection: `Value`.
- Responsive collection: `<Role> <width>px` — e.g. `Desktop 1440px`, `Tablet 905px`, `Mobile 400px`. The width is the **measured** breakpoint from `tokens.json`, not a convention.
- `Mode 1` and `Default` are blockers. They are Figma's placeholders and mean nobody named the mode.
- A mode whose values never differ from another does not earn its existence (`modes-earn-themselves`).

### 6.3 Scopes and code syntax

- Scopes are always set explicitly. `ALL_SCOPES` puts font stacks in the radius picker and is a major.
- Code syntax names an identifier that **genuinely exists** in the codebase. An empty code name is honest; an invented one sends a developer hunting for something that is not there. Where a token has no code identifier, leave it empty and record the count under Known gaps.

---

## 7. Evidence

The library's authority rests on every number being traceable. Nothing here is estimated.

### 7.1 Provenance

Recorded on the Getting Started page (§8): the source system and version, what was read (configuration entities, layout canvases, published revisions only), how many, over what date, what was excluded and why, and the exact command to regenerate.

### 7.2 Usage tiers

Tiers are the only page axis. Default absolute thresholds, by author placements:

| Tier | Placements |
| --- | --- |
| High Use | 50 or more |
| Medium Use | 10 to 49 |
| Low Use | 1 to 9 |
| Structural Only | 0 placements, 1 or more structural references |
| Retirement Candidates | 0 placements, 0 structural references |

Absolute thresholds are the default because they let two libraries be compared. A site whose distribution makes them useless **may** override them — and then the Getting Started page states the thresholds used **and the reason**, in the same words a reader would need to compare against another library. A silent override is a major.

Other axes — layout versus content, component kind, category — are **chips on the card, never pages**. They cut across every tier, so a page would force a false choice.

### 7.3 Two usage numbers, never one

**Author placements** and **structural references** are reported separately, everywhere. Collapsing them marks load-bearing components as dead. This is why `Structural Only` is its own tier: a component with zero placements and dozens of structural references is not a retirement candidate, and deleting it breaks the site.

### 7.4 Screenshots

Captured from the running site at every documented breakpoint, against pages **verified to render anonymously**. Authenticated pages redirect to a login form that would otherwise be captured as though it were the component. Two components whose selectors resolve to the same element are a major (`captures-unique`).

---

## 8. The Getting Started page

The orientation page and the index, merged. It is where a reader lands second and the only page that has to be read.

Sections in order:

1. **Header** — what this file is, and one line on what it is not.
2. **Coverage** — components, fields, placements, and **built versus not built**, per tier. The headline numbers from the Cover, broken down.
3. **How this file is organised** — tier thresholds with any override and its reason (§7.2); the two usage axes and why (§7.3); the note that non-tier axes are chips.
4. **What each card tells you** — the sections of §5, so a reader knows what they are looking at.
5. **Index** — the jump list, sorted by placements descending within tier. Columns are `Placements`, `Component`, `Tier`, `Type`, `Status`, and `Documentation`, in that order. The component name links to the Figma master; Documentation links to its card. Not-built rows have no fake destination. This is a table of contents, not documentation and not a search index.
6. **Known gaps** — every unmet expectation and every waiver, named specifically, with counts and component names. Regenerated by `design-lab:verify`, which exits non-zero while anything is unresolved.
7. **Provenance and regeneration** — §7.1, ending in the numbered commands to rebuild.

The index lives here, under the summary that gives it meaning, rather than alone on a page of its own.

**Do not claim the index is a search index.** §2 is why.

---

## 9. The Cover

A poster, the file thumbnail, and the only page a stakeholder may ever see. One 1440 × 900 frame
on a #18181b ground with 80 of margin, drawn by `scripts/render/cover.js`:

- **Eyebrow** — the document type (`DRUPAL CANVAS COMPONENT LIBRARY`), Roboto Mono 13, uppercase.
- **Headline** — the organisation, from the site's own name, Inter Semi Bold 72.
- **Lede** — one sentence on what the file covers.
- **Stat tiles** — five, each a frame named `Stat / <what>` with a number, a label and one
  line of qualifier, separated by a 1-pixel rule on top. Never a single text blob.
- **Provenance** — source and commit, the site the captures came from, capture widths,
  standard version, renderer runtime.

The eyebrow is the document type and the headline is the organisation — not the reverse.

---

### 9.1 Brand Voice & Language

Drawn by `scripts/render/voice.js` from `voice.json` (`scripts/extract_voice.py`), which reads
the published pages. Sections in order: a lede stating the corpus (pages, sentences, calls to
action, date); a positioning band quoting the homepage heading and opening paragraphs; five
evidence tiles; OBSERVED and WATCH rows for Voice, Naming & terminology, Headlines, Calls to
action, Readability and Search; vocabulary chips; a mechanics table; and published
inconsistencies on their own panel, recorded as defects, never as guidance.

- Every number carries its denominator. Every quote names its page.
- An OBSERVED row states what the majority of the site does and never contradicts its own
  numbers. WATCH rows are threshold-based and documented in `references/voice.md`.
- No language model writes anything on this page, so it is identical on every run.

## 10. The intermediate model

`components.json` and `tokens.json` conform to `model.md`. The Figma output cannot be consistent while the model that feeds it is not.

- Both files carry **`standardVersion`** and **`toolVersion`** at the top level.
- `components.json` top level: `standardVersion`, `toolVersion`, `generatedAt`, `source`, `components`, `problems`, `totals`.
- `tokens.json` top level: `standardVersion`, `toolVersion`, `generatedAt`, `source`, `modes`, `colors`, `schemes`, `spacing`, `type`, `radius`, `elevation`, `motion`, `typeScaling`, `problems`.
- **Domain buckets, not a flat token array.** A flat array pushes the domain into a per-entry field and makes every consumer re-group it.
- A domain the source does not supply is present and **empty**, never absent — so a reader can tell "none found" from "not looked for".
- Field kinds stay within the closed set in `model.md`. A new kind is a minor version of this standard, not a local addition.

Every build record carries `standardVersion`, `toolVersion`, `sourceHash`, and its assertion evidence, per `build-records.md`.

---

## 11. Conformance

`design-lab:verify` runs the checks below and writes a verify report to the artifact directory. **A library that has never produced a verify report is not a finished library.**

### Blockers

| Check | Fails when |
| --- | --- |
| `foundation-exists` | components built before variables exist |
| `code-syntax-resolves` | a Dev Mode name exists nowhere in the codebase |
| `components-built` | the plan said build, the file does not have it |
| `visual-evidence-present` | a built component has no verified live capture, selector, state, or root-relative example path |
| `master-matches-capture` | a built component has no passing screenshot comparison against its live reference |
| `no-authoring-diagrams` | a component master is a field-schema or anatomy diagram rather than the rendered interface |
| `documentation-anatomy` | a built component's documentation omits a source field, Site Studio property, or component relationship |
| `breakpoint-triad` | a built component lacks desktop, tablet, or mobile screenshot evidence and a passing comparison at that width |
| `native-component-structure` | a built asset is not a native component/component set, or its root is a screenshot image fill |
| `nested-component-coverage` | a rendered source relationship is documented but not represented by a real nested Figma instance |
| `component-naming` | a component is not `machine_name — Human Label` |
| `component-description` | a component's description is empty or lacks the concise §4.2 payload |
| `documentation-links` | a component has no link to its card |
| `documentation-adjacent` | a card is not on the same page as its component |
| `layers-named` | a card layer is named `Frame` or another Figma default |
| `mode-naming` | a mode is named `Mode 1` or `Default` |
| `no-scratch-pages` | a working or divider page shipped |
| `standard-version-stamped` | an artifact or build record carries no `standardVersion` |
| `build-record-assertions` | a component receipt has an empty, skipped, `not-run`, or failing assertion |
| `verify-report-exists` | no verify report was written |
| `bindings-match-source` | the Figma component binds where the source hardcodes, or hardcodes where the source binds (§1) |
| `index-complete` | a component missing from the index, or a rendered index stale against the inventory |
| `index-links-resolve` | a built component whose index row links to nothing |
| `index-component-links` | the component name does not link to the master, or Status is used as the component link |
| `example-path-portable` | a displayed example is a local hostname, lacks a root-relative label, or is not an actual link |
| `variants-are-sets` | variants left as loose components instead of a `COMPONENT_SET` |

### Majors

| Check | Fails when |
| --- | --- |
| `variable-scoped` | a variable is `ALL_SCOPES` |
| `code-syntax-set` | Dev Mode shows a bare number with no description saying why |
| `modes-earn-themselves` | a mode's values never differ |
| `collection-strategy` | collections are split without a distinct mode, publishing, ownership, or lifecycle boundary |
| `documentation-cards` | a component has no card |
| `documentation-cards-unique` | one card name is used twice, so one component is documented twice and another not at all |
| `documentation-signal` | visible docs are dominated by source dumps or generic sections rather than Preview, When to use, Configuration, Usage, Example, and actionable Notes |
| `pages-populated` | a page is empty and carries no line explaining why |
| `shot-frames-have-images` | a placeholder is named like a capture |
| `breakpoints-share-scale` | responsive shots that are useful are scaled per frame |
| `captures-unique` | two components' selectors resolve to one element |
| `two-usage-numbers` | placements and structural references are collapsed into one |
| `tier-thresholds-stated` | thresholds are overridden without a stated reason |
| `known-gaps-current` | Known gaps does not match the latest verify report |

**An unmet expectation resolves to a fix or a recorded waiver. Never to silence.**

---

## Appendix A — where this standard came from

Version 1.0.0 was derived on 1 September 2026 by comparing four libraries. Each had invented one thing worth keeping and none had all of them.

| Library | What it contributed | What it got wrong |
| --- | --- | --- |
| **America's Credit Unions** | usage tiers as the page axis; the `Structural Only` distinction | a text-only atlas justified by a false claim about Figma's search; zero components built; zero screenshots; five empty tier pages |
| **Schusterman** | breakpoint screenshots at three widths; a Known-gaps section that names specific components; the numbered regeneration sequence | zero components; card layers named `Frame`; documentation with nothing to attach to |
| **AHRI** | the documentation card structure — Head, Usage, real Fields table, Relations, Breakpoint shots; the two-usage-axes argument | 16 components segregated onto their own page; no documentation links; duplicate `Typography` and `Type` collections; modes still named `Mode 1` |
| **PNCB** | components living on their tier pages; the description payload; documentation links on every component; binding to a semantic layer; honest empty code names | human-label-only naming; an empty Medium Use page; tier thresholds overridden without the reason recorded |

Two of the four — Schusterman and AHRI — were produced by a bespoke `scripts/component-library` pipeline rather than by design-lab, and are evidence of what the output should be rather than of what the plugin currently does.
