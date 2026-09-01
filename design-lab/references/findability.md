# Findability

A 146-component library that cannot be searched is a filing cabinet with no labels. This
document is the answer to "how do I find a component", and it is a **structural** answer:
Figma gives you three indexes, they cover different things, and a library that does not
deliberately populate all three is unusable at this scale.

## What Figma actually searches

This is the whole constraint, and every decision below follows from it.

| Surface | What the query matches | What it cannot see |
|---|---|---|
| Assets panel search | the component **name** (including its slash path) | description, variant values, anything else |
| Assets panel tree | page name, then slash segments in the name | — |
| Insert / Resources modal | component **name** across enabled libraries | description |
| In-file search | **text layer content** and layer names on the canvas | component metadata |
| Dev Mode inspect panel | shows description, documentation links, code syntax on the selected node | it is not a search |

**The name is the only field the designer's search box reads.** The description is not a
search index — it is what confirms you found the right thing once you have found it.
Recommending descriptions "for discoverability", as an earlier draft of this library's
guidance did, is wrong and produced exactly the unusable file this document exists to fix.

> Verify once per Figma release before trusting the first two rows. The cheap check: put a
> distinctive nonsense word in one component's description only, then search it in the
> Assets panel. If it does not match, the table stands.

## Three indexes, three jobs

### 1. Name — for the designer who knows roughly what they want

The name must contain the words a person would actually type. That means the human label,
not the machine name: designers search "accordion", "banner", "quote". They never search
`cpt_cta_banner`. Developers do, and developers work in Dev Mode where the description and
code syntax are visible on selection.

The rule from the Figma library guidance — plain names, no namespace prefix, because
slashes create nested grouping — is written for a thirty-component system. At 146 it
inverts: a flat alphabetical list of 146 entries is not browsable. Deviate deliberately:

- **Component name carries both forms**, machine name first:

  ```
  cpt_cta_banner — Call To Action Banner
  ```

  Assets panel search is **substring** matching, not prefix matching, so one name serves
  both audiences: typing `banner` matches, and so does `cpt_cta`. Leading with the machine
  name also makes the panel sort by it, which groups the `cpt_` family together and matches
  the vocabulary the team already shares with developers.

  Spell the human half out — `Call To Action Banner`, never `CTA Banner`. An abbreviation is
  a word nobody searches for.
- **Category is carried by the page, not by a slash prefix.** The Assets panel groups local
  components by the page they live on, so one page per category gives you a browsable tree
  for free and keeps the name clean.
- **Sub-components and internal parts keep the `_` prefix** (`_Accordion/Item`), which hides
  them from the Assets panel.

Deviating from one-page-per-component is deliberate. 146 pages is its own navigation
failure; the Figma guidance already allows related families to share a page with clear
section separation, and a category page is that exception taken to its natural size.

### 2. Pages — and prefer usage tier over category

Search fails when you cannot name the thing, so browsing is the fallback, and the Assets
panel groups local components by the page they live on. That makes the page list the
information architecture.

**If an existing library file has a page structure, adopt it.** Schusterman Components 2026
organises by usage tier, and it expresses two categories a category scheme cannot:

```
Components — High Use            >= 50 content placements
Components — Medium Use          >= 10
Components — Low Use             1-9
Components — Structural Only     0 placements, but referenced by other components
Components — Retirement Candidates   0 placements and 0 structural references
```

Those last two are the ones a library review actually turns on. On Schusterman they are 31
and 24 components of 101 — more than half the library is either an inner part of a composite
or a deletion candidate, and a category-based organisation hides that completely.

Thresholds are **absolute, not relative**. Bucketing by thirds of the ranked distribution
still labels something "high" on a barely-used site, and cannot express either of the two
zero-placement tiers.

### 2b. Category pages — when no tier data exists

Search fails when you cannot name the thing. Browsing is the fallback, and it only works if
the grouping is semantic rather than alphabetical. Derive categories from the model's
`group` where the source has one — Site Studio's component categories are already authored
by a human and are usually right. Collapse them to somewhere between five and nine pages;
more than nine and you are back to scanning.

### 3. Atlas page — the full-text index

This is the index that does the real work, and it exists because in-file search reads
**canvas text**. One text card per component, and every fact you might search by goes in it:

```
Call To Action Banner
cpt_cta_banner  ·  Marketing  ·  high use  ·  312 placements
Also called: hero, promo banner, feature strip
Live example: https://www.ahrinet.org/certification
Source: config/sync/cohesion_elements.cohesion_component.cpt_cta_banner.yml
Built: 8 variants (Theme x Alignment). Deferred: inside-banner-padding (11 options,
bound to pad/* variables instead of a variant axis).
Defects: none
```

Now `cpt_cta_banner`, `hero`, `312`, and the source path are all findable with one search
box. The atlas is not decoration and it is not a poster for stakeholders — it is the
component database, and it is the only place a machine name is searchable.

**Aliases are the highest-value field and the only one a machine cannot derive.** `Also
called:` is where the vocabulary gap between the source configuration and the design team
gets closed. Ask for it once per project and store it in `components.json`.

## Why the current file feels unmanageable

Diagnosed against the AHRI library: it has unique identifiers on a document tree and
nothing else. No category grouping, so browsing means scrolling. Machine names as component
names, so the words a designer types match nothing. No atlas, so the placement counts, live
addresses and source references that were genuinely collected during the build are stranded
in a report nobody opens in Figma. Every one of the three indexes is empty.

The fix is not more metadata. It is putting the metadata where a search box can reach it.
