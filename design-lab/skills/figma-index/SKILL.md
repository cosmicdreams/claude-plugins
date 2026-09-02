---
name: figma-index
description: >
  Build and refresh the Getting Started page — the inventory of every component discovered,
  the linked index that jumps to each one's card, coverage counts, and known gaps. Idempotent:
  run it once before any component is built, then again after each one. Not for building
  components (design-lab:figma-component) or the final conformance run (design-lab:verify).
---

# Build the index

Read `references/library-standard.md` section 8 first. It defines the page this skill owns.

## What replaced the atlas, and why

This skill used to be `figma-atlas`. It built a separate page of one text card per component,
and it justified that page with a claim that was **false**:

> the only full-text index a Figma file has … in-file search reads canvas text and nothing else

Figma's Find searches the **entire file, across all pages**, for canvas text and layer names,
filterable by layer type. It has for some time. The atlas was therefore solving a problem
Figma already solved — and paying for it by flattening every field table, every relation and
every screenshot into text, which is strictly worse documentation than the same facts drawn
properly next to the component.

So: **no atlas page.** Documentation cards live beside their components on the tier pages
(standard section 1). What survives is the part the atlas got right — a complete inventory
including what was *not* built — and that becomes a jump list on Getting Started, under the
summary that gives it meaning.

Two consequences you must not undo:

- **Never justify a page by claiming Figma cannot search.** If a future Figma release changes
  what Find covers, verify it and update the standard — do not reason from this file.
- **The index is a table of contents, not a search index and not documentation.** One row per
  component. If a row starts growing fields, it belongs on the card instead.

## Run it early, and run it often

The index is the answer to "what is in this library and how much of it exists yet", so it is
useful from the moment `components.json` exists — before a single component is built, when
every row reads *not built*. That is not an embarrassment, it is the coverage baseline.

Regenerate it after **every** component build. It is one page and one script; a stale index
that claims a component is unbuilt after you built it is worse than no index. `design-lab:figma-component`
finishes by writing a build record, and that record is this skill's only input about what
exists — so the two stay in step by construction.

## Step 1 — generate the rows

```
python3 scripts/index_rows.py <artifacts>/components.json \
    --builds <artifacts>/builds [--high 50] [--medium 10] --report
```

It joins `components.json` with `builds/*.json` and returns every component with its tier,
placements, built state, the reason it is not built, and `linkTarget` — the node its row
hyperlinks to. Drop `--report` for the JSON you render from.

Never hand-assemble this list. Reading it off the Figma file tells you what got built, not
what was discovered, so it cannot show a gap — which is the one thing the index is for.

### Act on `problems` before rendering

- `usage-data-missing` — components have no usage data, so no tier could be assigned. Run
  `design-lab:usage` first. Rendering anyway produces an index with an untiered bucket and a
  library whose page structure is a guess.
- `machine-name-collision` — one machine name used by more than one component, so both would
  become the same Figma component name and the jump list would send readers to the wrong
  card. Qualify the name at build time with its source type (`block:accordion` and
  `paragraph:accordion` are two components, not one) and record the qualification on the card.

## Step 2 — the page

`Getting Started`, second in the file, exactly that name. Create it if absent; otherwise
**replace its content in place** — do not add a second page and do not append a second index.
The build record's node identifiers are what make that safe; never guess one.

Sections in the order the standard sets:

1. **Header** — what this file is, and one line on what it is not.
2. **Coverage** — components, fields, placements, and built versus not built, per tier, from
   `totals`. This is the honest counterpart to the Cover: the Cover says how big the system
   is, this says how much of it exists in Figma.
3. **How this file is organised** — the tier thresholds actually used. If `thresholds.default`
   is false, state the override **and its reason** in the same breath; an unexplained
   threshold cannot be compared against another library and is a `tier-thresholds-stated`
   failure.
4. **What each card tells you** — the card sections, so a reader knows what they are seeing.
5. **Index** — step 3.
6. **Known gaps** — every unmet expectation and waiver, from the latest verify report, named
   specifically with counts and component names. Not a vague apology: "four components have
   no render config, so no screenshots: table_row (116 placements), motivation_card, …".
7. **Provenance and regeneration** — source system and version, what was read and excluded,
   capture widths, generation date, then the numbered commands to rebuild.

## Step 3 — the index itself

A table. One row per component, in the order the script returns them — tier, then placements
descending, so the busiest component in the library is the first row.

| Column | From |
|---|---|
| Machine name | `machineName` |
| Component | `label` |
| Tier | `tier` |
| Placements | `placements` |
| Built | `built`, and where false, `reason` in the same cell |

Each row's machine-name cell is a **hyperlink to `linkTarget`** — the documentation card
where one exists, the component otherwise. Set it with `setRangeHyperlink` and a
`{ type: 'NODE', nodeID }` target, so the jump survives a page rename.

Rules:

- **Every discovered component gets a row**, including refusals, failures and never-attempted.
  A list of only what worked misrepresents the library's coverage, which is the failure the
  old "Not built" section existed to prevent — keep the guarantee, drop the separate section.
- **A row with no `linkTarget` is not a link.** Never point a row at a plausible-looking node
  identifier; a wrong jump is worse than no jump.
- **Never truncate silently.** If the table is split for layout, every component still appears
  somewhere and the split is stated.
- **Reason is one short phrase**, from the script — `not attempted`, `refused by the planner —
  would be 4,096 variants`, `build failed — 2 assertion(s)`. Do not editorialise.

## Step 4 — after rendering

Return the page identifier and the row count you wrote, and record them, so the next run
updates rather than duplicates.

This is not the last step. `design-lab:verify` is. The index is very good at making a
quarter-built library look organised, because a tidy table of 99 *not built* rows still reads
as a finished document. Run verify and put its coverage figure in front of a human before
anyone treats the file as done.
