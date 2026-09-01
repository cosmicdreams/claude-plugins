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

### 2. Bindings are real

For every node in the component, assert that visual properties resolve through
`boundVariables` rather than raw values:

- fills and strokes bind to a colour variable
- padding, gap and corner radius bind to a spacing or radius variable
- text nodes bind their size and line height to a type variable

Exceptions must be declared in the plan, not discovered at assertion time. Intentionally
fixed geometry exists — icon pixel-grid sizes, hairline dividers — and it is fine, but it
has to be named in advance or the assertion cannot tell it apart from a mistake.

The AHRI build reported 810 variable bindings across 14 components. Without this assertion
that number is a claim; with it, it is a measurement.

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
