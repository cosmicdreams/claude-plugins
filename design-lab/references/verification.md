# Verification

## Repeatability across runs

A run is a design-lab workspace after its build. When the runner plugin finishes the last
step, `figma_runner.py` exports every design-lab page with `scripts/figma_dump_tree.js` to
`<run>/figma/dump/<page-name>.json` (a `/` in a page name becomes `-`); the variables step's
result is already at `<run>/figma/results/variables.json`. A build relayed by a model gets
the same files by running `figma_dump_tree.js` once per page through `use_figma`, with the
literal `__PAGE_ID__` replaced by that page's id, and saving each result under that name.
The tree dump records page order, namespaced node paths, geometry rounded to half pixels,
styles, text, properties, docs, and variable names. Figma node ids live only in `_ids` and
are ignored in comparisons.

Run `python3 scripts/compare_runs.py run-a run-b --out report.json --md report.md` to
compare artifacts and every page node. Supply three or more run directories for all
pairwise comparisons and a score matrix. The score formula and category definitions are
documented in the script. Absent optional artifacts are reported as absent; a file present
in only one run is a difference.

To gate a repeated build of one page, save the expected SHA-256 digest in a text file and
run `python3 scripts/determinism.py check run-b/figma/dump/<page-name>.json expected.sha256`.
The hash is computed from sorted JSON keys after removing timestamp and run-id metadata and
the dump's `_ids`. Documentation links carry the block's node id, so a page whose components
link to their blocks hashes the same only when rebuilt into the same file. A mismatch exits
with status 1. This gate is separate from `verify.py`.

Nobody is going to reconstruct 146 components from memory. Verification therefore combines
**machine comparisons for every component** with a consistent visual receipt a human can audit:
desktop, tablet, and mobile screenshots next to the native Figma component.

When merging page dumps into `state.json`, retain the `breakpointCollection` entry and each
card's `breakpointNodes`. The verifier uses their component ids, widths, and explicit mode
ids to check the specimen's master and instances.

The live capture and the Figma specimen are compared as matched image pairs at each width.
The comparison uses a per-channel tolerance to avoid counting small renderer differences.

## What Figma gives you to verify with

| Tool | Returns | Good for |
|---|---|---|
| `use_figma` read-only script | any node property: `absoluteBoundingBox`, `paddingLeft`, `itemSpacing`, `fills`, `fontSize`, `lineHeight`, `boundVariables`, `componentPropertyDefinitions` | exact numeric assertions |
| `get_metadata` | node tree, names, types, sizes | structural assertions |
| `get_screenshot` | rendered image of a node | the human glance, filed in the build record |

`boundVariables` is the one that matters most. It tells you whether a value came from a
variable or was typed in by hand, which is the single regression that silently degrades a
token-driven library back into a pile of rectangles.

## The three assertion classes

Run all three at the end of every `design-lab:figma-component` invocation and write the
result into the build record. A component with a failing assertion is not "built".

### 1. Structure matches the plan

Cheap, exact, no external dependency. Compare the built component against the entry
`plan.py` and the source anatomy produced for it:

- one `COMPONENT` exists per source component, with no Breakpoint variant axis
- a `COMPONENT_SET` is used only when the plan has a real, non-Breakpoint variant axis
- the `Breakpoint` collection has Desktop 1400px (default), Tablet 800px, and Mobile 375px modes
- responsive values bind to variables in that collection
- every entry in `plan.properties` exists with the right type — `TEXT`, `BOOLEAN`,
  `INSTANCE_SWAP`
- no property exists that the plan did not ask for
- the publishable root is a `COMPONENT` or `COMPONENT_SET`, never an image-filled frame
- every rendered component relationship is represented by a real nested instance

The block shows the desktop master and resized mobile and tablet `INSTANCE` nodes with
explicit Breakpoint modes. It also holds three image-filled capture rectangles. No two
component definitions may share a source id or name stem. The Examples page contains
instances and supporting frames and text, without component definitions.

### 2. Bindings match the source

For every node, assert that its binding state **equals the source's binding state** — not
that it is maximally bound. Three outcomes per property, and only the third is a failure:

| Source | Figma | Verdict |
|---|---|---|
| resolves through a token | bound to the matching variable | pass |
| hardcodes a literal | carries the same literal, defect recorded | pass |
| either | bound where the source hardcodes, or hardcoded where the source binds | **fail** |

An earlier edition of this file asserted the opposite — that every fill, padding and type
value must resolve through `boundVariables`, and that a raw value was a defect. That rule
silently upgrades the component. A theme that hardcodes `#342649` where it should use
`--bs-purple` produces a Figma component with a clean bound variable, the flaw disappears,
and the file stops being a representation of the running site. See
`references/library-standard.md` section 1.

So a binding count on its own is not a measurement of quality. The AHRI build reported 810
bindings across 14 components; what matters is how many of those 810 the code actually makes,
and which properties diverge.

Exceptions still have to be declared in the plan rather than discovered at assertion time.
Intentionally fixed geometry exists — icon pixel-grid sizes, hairline dividers — and it is
fine, but it has to be named in advance or the assertion cannot tell it apart from drift.

### 3. Fidelity against the source of truth

Only this class needs the live site, and only for components that have a verified
anonymous example address — see `usage.examples` in `references/model.md`. The block
returns bounding boxes for the mobile instance, tablet instance, desktop master, and their
three live captures. `figma_compare.py` crops matched pairs from one specimen screenshot.
Each pair passes when no more than 6% of its pixels differ by over 40 in a colour channel.
The receipt records each pair's ratio, verdict, threshold, and tolerance.

If no anonymous example exists, record the component as not built and explain why in the
index. `fidelity: "unverified"` is useful diagnostic evidence but cannot complete a build
receipt.

## What the screenshot is for

Desktop, tablet, and mobile screenshots appear inside the component block and in the build
record so a human can catch the class of error numbers miss: a layer in the wrong z-order,
text overflow, implausible density, or a variant that is structurally correct and visually
absurd. Each width receives a comparison verdict from `compare:<id>` before the component
is reported as built. An absent comparison is `not-run`.

The screenshots are never the reusable asset. A component root with an image fill is a hard
failure even when it matches production perfectly.

## Where results go

Into `builds/<component-id>.json`, alongside the node identifiers. That file is both the
verification record and the idempotency key — see `references/build-records.md`.

## Component block assertions

Each built component sits inside `Human Label · machine_name` on its usage tier page. The block is
tagged `designlab/component`; its `Documentation · machine_name` panel contains `Head`,
`Usage`, `Figma properties`, and `Fields`, with optional `Relationships` and `Notes`.
The component is the desktop master. Its mobile and tablet instances carry explicit
Breakpoint modes; the block has three matching image-filled `Capture · …` rectangles.

The receipt reads `build:<id>`, `block:<id>`, `images:<id>`, `evidence:<id>`, and
`compare:<id>`. It records source fields, slots, node ids, variable counts, bindings,
literals, layout fallbacks, upload HTTP statuses, and each comparison verdict. An absent comparison is explicitly
`not-run`: the receipt can be registered, but `build-record-assertions` and
`master-matches-capture` keep verification open until all three widths pass. Getting Started
contains Coverage, How this file is organised, What each component block shows, Index,
Known gaps, and Provenance and regeneration; Changelog is optional.
