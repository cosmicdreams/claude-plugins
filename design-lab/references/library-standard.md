# The component library standard

**Standard version: 2.0.0**

Every library design-lab produces conforms to this document. It is the single answer to "what is a finished component library", so that two people running the plugin against two unrelated codebases — one Drupal with Site Studio, one not Drupal at all — hand back artifacts a third person recognises as the same kind of thing.

The source data will differ wildly. The result must not.

## How to use this document

- `verify.py` checks against this file. A finding is a **blocker** or a **major**; both resolve to a fix or a recorded waiver, never to silence.
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

For every component in scope, all three exist and reference each other:

1. A real Figma component or component set, on its usage tier page.
2. A documentation card, adjacent to that component on the same page.
3. Links both ways — the component's `description` carries the searchable payload and points at the card; the component's `documentationLinks` jumps to it.

A component that cannot be built is not silently dropped. It appears in the index as **not built**, with a reason.

### The file is a seed of ground truth, not an idealisation

This is the governing principle, and it overrides every convenience below.

**The Figma component is a faithful representation of the component as the running site actually implements it — including its defects.** Where the code resolves a value through a token, the Figma node binds the corresponding variable. Where the code hardcodes a literal, **the Figma node carries that literal too**, and the divergence is recorded as a defect about the codebase.

The purpose is a file both developers and designers can work from and then sync in either direction. That only works if the two sides describe the same thing. A Figma component that binds a variable where the code hardcodes a hex is not a tidier version of the truth — it is a different component, it hides the defect that a designer is best placed to notice, and it makes every subsequent diff meaningless because the two sides were never comparable.

So:

- **Never improve a component on the way into Figma.** Not spacing, not colour, not type. If it looks wrong, that is the finding.
- **A hardcoded value in the code becomes a hardcoded value in Figma plus a recorded defect**, surfaced on the card, so somebody can decide to fix it in the code and re-sync. Silently binding it destroys the signal.
- **Divergence between Figma and code is the product**, not noise to be cleaned up before shipping.

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
Components — High Use
Components — Medium Use
Components — Low Use
Components — Structural Only
Components — Retirement Candidates
```

Rules:

- **A Foundations page exists only if the token source has values for it.** Omit `Elevation & Shape` when the codebase defines no shadows or radii — and say so under Known gaps. Never publish an empty page; an empty page reads as "this system has none of these", which is a different claim from "we could not find any".
- **A component tier page always exists**, even at zero components, because absence is the finding. It carries a single line stating the count and why.
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

Component sets take the same name. Variants are named by their axes, never by the component.

### 4.2 Description — the searchable payload

`description` is the library's primary search surface. It is structured prose, not a sentence. Required content, in this order:

1. **What it is in the source system** — the type and its machine name.
2. **Usage** — tier, placement count, page count. Real counts, never estimates.
3. **Fields** — name, kind, required or optional, cardinality. Note fields that are *not* author-editable and say why.
4. **Containment** — what it is placed inside, and what it can contain.
5. **How it renders** — template or component file path, and whether it is a real component or plain markup.
6. **Token bindings that carry meaning** — e.g. padding bound to a spacing step, with the measured values.
7. **Source path** — the configuration file the anatomy was read from.
8. **A pointer to its documentation card.**

Anything a reader would search for belongs here. Synonyms and the terms authors actually use are worth including even when they appear nowhere in the codebase.

### 4.3 Documentation links

Every component carries `documentationLinks` pointing at its card. This is the jump from Assets panel to full documentation and it is a blocker when missing.

### 4.4 Variants

Variant axes follow `variant-policy.md`. A component whose axes would explode is refused at plan time and recorded as not built with the arithmetic shown — never quietly truncated.

---

## 5. The documentation card contract

One card per component, adjacent to it, same page. Sections in this order:

| Section | Contains |
| --- | --- |
| `Head` | category tags, human label, machine name, verified live example path |
| `Usage` | **two** stat tiles — author placements and structural references, separately (§7.3) |
| `Fields` | labelled count, then a real **table**: field, kind, required, constraint, default. Where there are none, a sentence saying why. |
| `Relations` | `CAN CONTAIN` and `APPEARS IN`, derived from the source, not asserted |
| `Breakpoints` | `ACROSS BREAKPOINTS`, then screenshots at every documented width, **drawn at one shared scale**, each labelled with its real rendered height |

Rules:

- **The fields table is a table.** Preformatted text with box-drawing or bullet glyphs standing in for structure is not a table — it cannot be read at a glance, cannot be restyled, and loses the alignment that makes a field list scannable.
- **Screenshots are required** wherever the component is reachable. A component with no shot carries a stated reason (not reachable anonymously, no isolable selector, renders no distinct markup). Placeholder frames named like captures are a blocker.
- **One shared scale across breakpoints.** Per-frame scaling makes every width look identical and hides the responsive behaviour the strip exists to show.

### 5.1 Layer naming

Card layers carry the machine name so Find reaches them: `Human Label · machine_name` on the card root. Layers named `Frame` are a blocker — they are invisible to the one search surface that covers the whole file.

---

## 6. Variables

### 6.1 Collections

Named `<Brand> <Domain>` — brand-prefixed. When a file subscribes to more than one library, unprefixed collections collide in every picker.

Canonical domains: `Color`, `Semantic`, `Spacing`, `Type`, `Radius`, `Elevation`, `Motion`.

- **A collection exists only if the token source has values for it.** Never invent a domain to look complete.
- **Never two collections for one domain.** Carrying both `Typography` and `Type` splits the same concept across two pickers and guarantees the wrong one gets bound.
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
5. **Index** — the jump list. One row per component: machine name, human label, tier, placements, built or not built, each row hyperlinked to its card. This is a table of contents, not documentation and not a search index — it is short enough to scan and cheap enough to stay correct.
6. **Known gaps** — every unmet expectation and every waiver, named specifically, with counts and component names. Regenerated by `design-lab:verify`, which exits non-zero while anything is unresolved.
7. **Provenance and regeneration** — §7.1, ending in the numbered commands to rebuild.

The index lives here, under the summary that gives it meaning, rather than alone on a page of its own.

**Do not claim the index is a search index.** §2 is why.

---

## 9. The Cover

A poster, and the only page a stakeholder may ever see. Fixed shape:

- **Eyebrow** — the document type (`SITE STUDIO COMPONENT LIBRARY`, `DRUPAL COMPONENT LIBRARY`).
- **Headline** — the organisation.
- **Lede** — one sentence on what the file covers.
- **Stat tiles** — four to six, each a frame named `Stat / <what>`, carrying a number, a label, and one line of qualifier. Never a single text blob.
- **Provenance block** — source and version, what was measured and excluded, capture widths, generation date, regeneration pointer.

The eyebrow is the document type and the headline is the organisation — not the reverse.

---

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
| `component-naming` | a component is not `machine_name — Human Label` |
| `component-description` | a component's description is empty or lacks the §4.2 payload |
| `documentation-links` | a component has no link to its card |
| `documentation-adjacent` | a card is not on the same page as its component |
| `layers-named` | a card layer is named `Frame` or another Figma default |
| `mode-naming` | a mode is named `Mode 1` or `Default` |
| `no-scratch-pages` | a working or divider page shipped |
| `standard-version-stamped` | an artifact or build record carries no `standardVersion` |
| `verify-report-exists` | no verify report was written |
| `bindings-match-source` | the Figma component binds where the source hardcodes, or hardcodes where the source binds (§1) |

### Majors

| Check | Fails when |
| --- | --- |
| `variable-scoped` | a variable is `ALL_SCOPES` |
| `code-syntax-set` | Dev Mode shows a bare number with no description saying why |
| `modes-earn-themselves` | a mode's values never differ |
| `collection-naming` | a collection is unprefixed, or two collections cover one domain |
| `documentation-cards` | a component has no card |
| `documentation-cards-unique` | one card name is used twice, so one component is documented twice and another not at all |
| `fields-are-tables` | a fields list is preformatted text rather than a table |
| `pages-populated` | a page is empty and carries no line explaining why |
| `shot-frames-have-images` | a placeholder is named like a capture |
| `breakpoints-share-scale` | breakpoint shots are scaled per frame |
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
