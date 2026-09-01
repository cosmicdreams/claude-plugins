# Variant policy

The single decision that determines whether a component library is usable or unusable.
Get it wrong and one component needs 880 variants. These are **defaults, not laws** -
every project can override them, and the planner always shows its working.

## Treatments

| Treatment | Figma mechanism | Use when |
|---|---|---|
| `variant` | variant axis on the set | a designer visually picks between the options |
| `variable` | bound variable on a property | the option only selects a design token value |
| `boolean` | boolean component property | two states, expressed as layer visibility |
| `text` | text component property | free or rich text |
| `swap` | instance-swap property | a slot or drop zone |
| `unsupported` | nothing | Figma cannot express it (see below) |

## Defaults by field kind and token family

| kind | tokenFamily | default | why |
|---|---|---|---|
| enum | `spacing` | **variable** | the entire source of combinatorial blowup |
| enum | `color-scheme` | variant | visually distinct, and the thing designers pick first |
| enum | `layout` | variant | changes structure, not a value |
| enum | none, 2 options | boolean | a toggle in disguise |
| enum | none, 3-6 options | variant | genuine visual choice |
| enum | none, >6 options | **flag for review** | probably tokens in disguise |
| richtext, text | — | text | |
| boolean | — | boolean | |
| media, color | — | left to the designer | no useful Figma property type |
| slot | — | swap | |

## The judgement call this cannot make for you

A spacing enum can vary by **magnitude** (small / medium / large) or by **which sides**
are padded (top / bottom / left-right / equal), and Site Studio enums routinely vary by
both. Magnitude is cleanly a bound variable. Which-sides is structural, and a single bound
variable cannot express "no horizontal padding".

Worked example of the inconsistency this produces, from the AHRI build:

- `cpt_text.padding-around-text` - 3 options - was built as a **variant axis**, giving
  Theme x Padding = 12 variants. Defensible: only three options, and the designer wants
  to see them side by side.
- `cpt_cta_banner.inside-banner-padding` - 11 options - was built as a **bound variable**.
  Also defensible: as a variant axis it would have produced 880 combinations.

Same field family, opposite treatment, both reasonable. There is no clean automatic rule.
So the planner defaults spacing to `variable`, and **flags any spacing enum whose options
vary by side** so a human decides with the variant arithmetic in front of them.

## What Figma cannot express

Record these as `unsupported` with a reason rather than silently dropping them.

- **Auto-layout direction cannot bind to a component property.** Blocks any per-breakpoint
  row/column switch (`cpt_link` tablet-layout and phone-layout) and any reverse-direction
  toggle (`cpt_split_container` column-direction). Representing them doubles the set.
- **Variables cannot drive layout mode**, so responsive direction is variants or nothing.
- Boolean properties bind only to layer visibility, so anything else two-state needs a
  dedicated layer to toggle.

## Hard stop

If the product of proposed variant axes exceeds `maxVariants` (default 64), refuse and
report. `cpt_4_column_layout` carries 59 select fields - roughly 10^49 naive combinations.
Components like that are layout engines, not components, and want auto-layout plus
variable modes instead of a variant set.
