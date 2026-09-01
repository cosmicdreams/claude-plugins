---
name: figma-atlas
description: >
  Build the atlas page — one searchable text card per component plus a "Not built" section —
  which is the only full-text index a Figma file has. Run after the components are built.
  Not for building components (design-lab:figma-component).
---

# Build the atlas

## This is not the last step

`design-lab:verify` is. The atlas is the last thing *built*; it is not the thing that says
the library is finished. Run verify afterwards and put its completeness figure — how many of
the expected components actually exist — in front of a human before anyone treats the file
as done. The atlas is very good at making a quarter-built library look complete, because
every card it draws is a card that worked.

The atlas is not a poster for stakeholders. It is the component database, and it exists
because **in-file search reads canvas text and nothing else**. The Assets panel search box
matches component names only; it cannot see a description. So every fact worth searching by
has to be written onto the canvas here or it is not findable at all.

Read `references/findability.md` first.

## One documentation card per component

The card below is not invented — it is the anatomy of the Schusterman Components 2026 file,
which is the best documentation this practice has produced. Match it. A component whose only
documentation is a `description` field is not documented: descriptions are invisible on the
canvas, invisible to in-file search, and invisible to anyone scrolling the page.

Each card is **940 wide**, in a two-column grid, under a page header stating the tier and its
threshold. Top to bottom:

| Row | Holds | Source |
|---|---|---|
| Eyebrow | category chip + **machine name** | `components.json` `group`, `id` |
| Title | the human label | `label` |
| Stats | placements, pages, entities, editable fields | usage source |
| Live example | a **verified public** address | `design-lab:usage` |
| `FIELDS` | table — Field / Type / Req. / Limit, slots first | `fields`, `slots` |
| `ACROSS BREAKPOINTS` | one frame per breakpoint, with measured pixel dimensions | render harness |

Truncate a long field table with an explicit `+ N more fields not shown`. Never silently cut.

### The breakpoint row is the part that gets faked

**Draw every breakpoint of one component at a single shared scale.** Scaling each frame
independently to fill its slot is the obvious implementation and it destroys the only thing
the row exists to show: a 969px desktop and a 740px tablet come out the same width, so the
component reads as not responsive at all. Compute one scale per component from its widest
and tallest measurement, then apply it to all three.

**A grey box is not a screenshot, and must not be named like one.** Real captures belong in
frames named `shot:<machine_name>:<Breakpoint>`. If the render harness has not run and you
only have measurements, draw scale diagrams named `scale:<machine_name>:<Breakpoint>`, label
the row `measured, drawn to scale`, and record the missing captures as an open gap. Naming a
placeholder `shot:` makes the file claim a fidelity it does not have.

### Link the component to its card

`design-lab:figma-component` step 8 sets `documentationLinks`. Assert it here: a component
with an empty `documentationLinks` array is undocumented no matter how good its card looks,
because nothing in the Assets panel leads a designer to the card.

## The "Not built" section is required

List every refused component with its variant arithmetic, and every deferred and unsupported
field. Twelve of AHRI's 146 components exceed `maxVariants`; four more have fields Figma
cannot express. A library that shows only what succeeded misrepresents its own coverage.

## Breakpoint frames

Three frames — one per spacing mode — holding the same handful of components. Since AHRI type
does not scale but spacing does, modes alone tell half the story; three frames side by side
make the responsive behaviour legible without anyone editing a variable.

## Source the content from disk, not from memory

Build every card from `components.json`, the usage source and `builds/*.json`. The build records are what make
the atlas reproducible after a context reset, and regenerating it is how the page stays
honest as components are added.
