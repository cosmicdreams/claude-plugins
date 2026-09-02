# Verification

Nobody is going to eyeball 146 components. Verification here means **the machine compares
numbers**, and a screenshot is filed for the handful of cases numbers cannot decide.

An earlier draft of this guidance said "compare the built component against the live
version", which reads as a request for manual visual review and is not what is being
proposed. Pixel-diffing a Figma render against a browser render is a bad gate anyway: font
rasterisation, antialiasing and subpixel positioning differ between the two renderers, so
the diff is noisy even when the component is perfect. Numbers do not have that problem.

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

Cheap, exact, no external dependency. Compare the built component set against the entry
`plan.py` produced for it:

- variant count equals `plan.variants`
- variant property names and their option sets match `plan.variantAxes`
- every entry in `plan.properties` exists with the right type — `TEXT`, `BOOLEAN`,
  `INSTANCE_SWAP`
- no property exists that the plan did not ask for

This catches the most common failure by a wide margin: `combineAsVariants` silently
producing a different matrix than intended.

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
anonymous example address — see `usage.examples` in `references/model.md`. Compare the
Figma node's numbers against the browser's computed styles for the same instance at the
same breakpoint:

| Compare | Figma side | Browser side |
|---|---|---|
| width | `absoluteBoundingBox.width` | computed `width` |
| padding | `paddingTop/Right/Bottom/Left` | computed padding |
| gap | `itemSpacing` | computed `gap` or measured child offset |
| text size and line height | `fontSize`, `lineHeight` | computed `font-size`, `line-height` |
| colour | `fills[0].color` converted to hex | computed `color` / `background-color` |

That is eight to a dozen numbers per component, all exact, all comparable without a human.
The AHRI pilot did exactly this by hand for two components — Figma rendered 553 wide with a
473-wide body against a live measurement of 473.3 — and the value was obvious. The only
change here is that it stops being manual.

**Tolerance is one pixel.** Anything larger is either a real defect or a token that was
never captured, and both deserve a report rather than a rounding rule.

Record a `fidelity: "unverified"` verdict honestly when no anonymous example exists. Four of
the fourteen AHRI components are token-derived rather than measured, and pretending
otherwise is worse than saying so.

## What the screenshot is for

It goes in the build record so a human can glance at a contact sheet after a batch run and
catch the class of error numbers miss: a layer in the wrong z-order, text overflowing its
frame, a variant that is structurally correct and visually absurd. It is evidence, not a
gate. Nothing blocks on it.

## Where results go

Into `builds/<component-id>.json`, alongside the node identifiers. That file is both the
verification record and the idempotency key — see `references/build-records.md`.

## Documentation assertions

Structure is not documentation. Assert all four, per component:

- `documentationLinks.length > 0` — otherwise nothing leads from the Assets panel to the card
- a documentation card exists whose name contains the machine name
- the card's breakpoint frames share one scale — compare each frame's width against its
  labelled pixel width; the ratios must be equal across the row
- frames named `shot:*` contain an image fill. A named `shot:` frame with a flat fill is a
  placeholder claiming to be a capture, and is worse than an honest `scale:` frame
