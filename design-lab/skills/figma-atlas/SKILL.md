---
name: figma-atlas
description: >
  Build the atlas page — one searchable text card per component plus a "Not built" section —
  which is the only full-text index a Figma file has. Run after the components are built.
  Not for building components (design-lab:figma-component).
---

# Build the atlas

The atlas is not a poster for stakeholders. It is the component database, and it exists
because **in-file search reads canvas text and nothing else**. The Assets panel search box
matches component names only; it cannot see a description. So every fact worth searching by
has to be written onto the canvas here or it is not findable at all.

Read `references/findability.md` first.

## One text card per component

```
Call To Action Banner
cpt_cta_banner  ·  Marketing  ·  high use  ·  312 placements
Also called: hero, promo banner, feature strip
Live example: https://www.ahrinet.org/certification
Source: config/sync/cohesion_elements.cohesion_component.cpt_cta_banner.yml
Built: 8 variants (Theme x Alignment). Deferred: inside-banner-padding (11 options,
bound to pad/* variables rather than a variant axis).
Defects: none
```

Now the machine name, the synonyms, the placement count and the source path are all reachable
from one search box. Place an instance of the component beside its card so the page doubles
as a contact sheet.

**Aliases are the highest-value line and the only one a machine cannot derive.** `Also
called:` closes the vocabulary gap between the source configuration and the design team. Ask
for them once per project and store them in `components.json`.

## The "Not built" section is required

List every refused component with its variant arithmetic, and every deferred and unsupported
field. Twelve of AHRI's 146 components exceed `maxVariants`; four more have fields Figma
cannot express. A library that shows only what succeeded misrepresents its own coverage.

## Breakpoint frames

Three frames — one per spacing mode — holding the same handful of components. Since AHRI type
does not scale but spacing does, modes alone tell half the story; three frames side by side
make the responsive behaviour legible without anyone editing a variable.

## Source the content from disk, not from memory

Build every card from `components.json` and `builds/*.json`. The build records are what make
the atlas reproducible after a context reset, and regenerating it is how the page stays
honest as components are added.
