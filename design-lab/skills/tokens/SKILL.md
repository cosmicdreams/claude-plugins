---
name: tokens
description: >
  Extract the design tokens — colour, spacing, type, per breakpoint, each with the code
  identifier it has in the codebase — into tokens.json. Run after design-lab:detect names a
  token source, and before design-lab:figma-foundation. Not for components
  (design-lab:inventory).
---

# Extract tokens

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/extract_tokens_sitestudio.py <repo-root> > tokens.json
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/extract_tokens_sourcemap.py  <repo-root> > tokens.json
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/extract_tokens_cssvars.py    <repo-root> > tokens.json
```

## Prefer authored custom properties to either of the others

When a theme declares its tokens as CSS custom properties, that is the best source available
and it is not close. The other two recover *whatever variables the stylesheets happen to
declare*: a Sass source map yields `$nth` and `$visual-grid` next to `$periwinkle`, with no
statement of which is a design decision. A `:root` block is the design decision, written
down. `--color-text` and `--color-surface` arrive already carrying the semantic layer, which
is why `plan_variables.py` can derive Semantic for this strategy and cannot for the others.

Two traps it handles, both of which have bitten this plugin before:

- **Only stylesheets a `*.libraries.yml` actually loads.** PNCB's real sheet declares 96
  properties; unloaded scaffolding under `components/incoming/` carries 127 Catppuccin and
  Tailwind names. The excluded files are listed in `source.ignoredNotLoaded` - read it.
- **`core/` and `contrib/` are pruned.** Drupal core's Claro and Olivero declare their own
  `:root` blocks. Without pruning, PNCB returns 1,023 tokens of which 283 are
  `--admin-color-*`; with it, 94, all the client's.

Token source is independent of component source — a Single Directory Component site has no
tokens in configuration at all. Take the source from `design-lab:detect`, not from the
component strategy.

## Prefer configuration to measurement

One custom style entity gives every breakpoint of a value at once and names the palette
entry. A single rendered instance conflates sources: on AHRI a text component rendered 40px
horizontal padding that looked like its padding field but was actually its colour scheme
applying `padding-equal: $spacing-small`.

## The palette is not in the custom styles

`extract_tokens_sitestudio.py` reads four config families, and the order is the whole point:

| Family | Gives |
|---|---|
| `cohesion_website_settings.cohesion_color.*` | the **palette** — named colours, Sass variable, tags, `inuse` |
| `cohesion_website_settings.cohesion_font_stack.*` | font families, with `$coh-font-*` **resolved** |
| `cohesion_website_settings.cohesion_scss_variable.*` | the spacer scale |
| `cohesion_custom_styles.cohesion_custom_style.*` | the component-scoped layer |

An earlier version read only the last one. Schusterman's 172 custom styles collapsed to 11
distinct hexes with names like "Card fake link with icon", because a custom style says how
one component looks — it is not the palette. The palette is 43 named colours. The same
mistake made font families unrecoverable as raw `$coh-font-serif`, which
`cohesion_font_stack` resolves to **Greta Text**.

Verified: AHRI and Schusterman both. Check `source.entities` in the output — if `colors` is
0, the site keeps its palette somewhere else and that is worth knowing before you build.

## Read the output carefully

**The sourcemap extractor resolves `lighten()` and `darken()`.** Sass colour functions are
evaluated against the HSL lightness channel, so `lighten($periwinkle-dark, 10)` resolves to
`#7c92e5` rather than staying a literal string in the `unknown` family. This matters because
an unresolved function reads as "this colour has no provenance" when its provenance is in
fact exact — PNCB's `primary-hover` and `primary-link-hover` were both recorded as having no
configuration source before this landed.

**`codeName` is the token's identity in the codebase** — the Site Studio `class_name`, the
Sass variable, the custom property. It becomes the Figma variable's code syntax. A `null`
means the codebase genuinely has no name for that value; never invent one. See
`references/tokens-and-variables.md`.

**Breakpoints cascade downward.** A value declared only at `xl` applies at every smaller
size. Reading breakpoints as independent produces holes that look like missing tokens.

**`typeScaling` is per role, and generalising from one role is a known error.** The AHRI
pilot measured body text at 20/32 across all breakpoints and concluded type does not scale;
13 of 43 font-size tokens do, Heading 2 among them at 48/48/42/36. Check
`typeScaling.noneScale` before giving the type collection a single mode.

**`unclassified` is mostly not tokens.** It collects `display`, `flex-*`, `width`,
`position` and similar layout declarations — real style rules with no Figma variable
equivalent. Scan it for anything that looks like a colour or a spacing ramp the classifier
missed, then ignore the rest.

## Verified against

| Site | Entities | Colour | Spacing | Type | Font sizes that scale |
|---|---|---|---|---|---|
| AHRI | 129 | 70 | 163 | 123 | 13 of 43 |
| Schusterman | 172 | 57 | 115 | 224 | 8 of 65 |

## Next

`design-lab:figma-foundation`.
