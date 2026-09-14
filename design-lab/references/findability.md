# Findability

A 146-component library that cannot be searched is a filing cabinet with no labels. This
document answers "how do I find a component", and the answer is structural: Figma already
indexes the file in two ways, and a library's job is to **populate those two surfaces
properly** — not to build a third one of its own.

## What Figma actually searches

Every decision below follows from this table.

| Surface | Scope | What the query matches |
|---|---|---|
| Assets panel search | file-wide, open while placing components | component **name** and **description**, plus semantic matching |
| Assets panel tree | — | page name, then slash segments in the name |
| Insert / Resources modal | enabled libraries | component name and description |
| Find (`Cmd`/`Ctrl`+`F`) | **the entire file, all pages** | canvas text **and layer names**, filterable by layer type |
| Dev Mode inspect panel | selected node | shows description, documentation links, code syntax — it is not a search |

Two rows here were wrong in an earlier edition of this file, and the error shaped the whole
practice. It claimed the Assets panel reads only the name, and that Find reads only the
current page. Both are false: Figma's own guidance says descriptions are used in search and
that you can tag components with keywords through them, and Find offers results for the
current page **or all pages**. The atlas page existed to compensate for a limitation Figma
does not have.

> Re-verify before trusting rows 1 and 4 after a Figma release. The cheap check for row 1:
> put a distinctive nonsense word in one component's description only, then search it in the
> Assets panel. If it does not match, correct this table and
> `references/library-standard.md` section 2 together — never let them disagree.

## Two indexes, two jobs

### 1. Name — for whoever is looking

```
machine_name — Human Label
```

Assets panel search is substring matching, so one name serves both audiences: typing `banner`
matches, and so does `cpt_cta`. Leading with the machine name also sorts the panel by it,
grouping the `cpt_` family and matching the vocabulary already shared with developers.

- Spell the human half out — `Call To Action Banner`, never `CTA Banner`. An abbreviation is
  a word nobody searches for.
- **Category is carried by the page, not by a slash prefix.** The Assets panel groups local
  components by the page they live on, so the page list does that work and the name stays
  clean.
- **Sub-components and internal parts keep the `_` prefix** (`_Accordion/Item`), which hides
  them from the Assets panel.
- Where one machine name is used by two components — a block and a paragraph both called
  `accordion` — qualify it, because two Figma components cannot share a name and an index row
  would jump to the wrong one. `scripts/index_rows.py` reports this as
  `machine-name-collision`.

### 2. Description — for confirming, and for the words nobody put in the name

The description is a search surface, so everything worth searching by goes in it: the payload
in `references/library-standard.md` section 4.2, plus the vocabulary gap.

**Aliases are the highest-value field and the only one a machine cannot derive.** `Also
called: hero, promo banner, feature strip` is where the difference between what the source
configuration calls a thing and what the design team calls it gets closed. Ask for it once per
project and store it in `components.json`.

## Pages are the usage tier, and the standard fixes the list

`references/library-standard.md` section 3 sets the page list. It is fixed, not adopted from
whatever a file happens to contain — an earlier edition of this file said *"if an existing
library file has a page structure, adopt it"*, and that single instruction is why four
libraries built by this practice have four different page structures.

Tiers express two things a category scheme cannot:

```
Components — High Use                 >= 50 author placements
Components — Medium Use               10 - 49
Components — Low Use                  1 - 9
Components — Structural Only          0 placements, but referenced by other components
Components — Retirement Candidates    0 placements and 0 structural references
```

Those last two are what a library review turns on. On Schusterman they are 31 and 24 of 101
components — more than half the library is either an inner part of a composite or a deletion
candidate, and a category-based organisation hides that completely.

Thresholds are **absolute, not relative**. Bucketing by thirds of the ranked distribution
still labels something "high" on a barely-used site, and cannot express either zero-placement
tier. Overriding them is allowed and must be stated with its reason (standard section 7.2).

### When there is no usage source at all

Some repositories have no way to count placements. Then tiers cannot be computed, and the
answer is **not** to invent a second organising scheme — it is to say so. Collapse the five
tier pages to one page named `Components — Untiered`, order it by the source's own grouping,
and state on Getting Started that no usage source was available and what that costs the
reader. One shape that admits a gap beats two shapes that compete.

Do not route around missing usage data quietly. `scripts/index_rows.py` reports it as
`usage-data-missing`, and on most Drupal sources the real fix is to run `design-lab:usage`.

## Why a library feels unmanageable

Diagnosed against the AHRI library: unique identifiers on a document tree and nothing else. No
tier grouping, so browsing means scrolling. Machine names as component names, so the words a
designer types match nothing. Descriptions present but no documentation links, so nothing in
the Assets panel leads anywhere. The placement counts, live addresses and source references
genuinely collected during the build are stranded in a report nobody opens in Figma.

The fix is not more metadata, and it is not another index page. It is putting the metadata on
the two surfaces Figma already searches.
