# Tokens and Figma variables

The Figma variable is not the token. It is a *representation* of the token, and the link
back to the real one is a field called **code syntax**. Getting that field right is what
makes the library consistent with the code; getting it wrong produces a Figma file whose
colours happen to match and whose names mean nothing to a developer.

## Code syntax is the whole answer

Every Figma variable carries a per-platform code syntax string:

```javascript
v.setVariableCodeSyntax('WEB',     'var(--sfp-color-brand-blue)');
v.setVariableCodeSyntax('ANDROID', 'sfpColorBrandBlue');
v.setVariableCodeSyntax('iOS',     'Color.brandBlue');
```

Three rules, all of which are easy to get wrong:

1. **The `var()` wrapper is required for `WEB`.** Setting `--sfp-color-brand-blue` without
   it makes Dev Mode show a raw hex value instead of the variable reference, which defeats
   the entire point.
2. **Never derive the code syntax from the Figma name.** If the codebase has the real
   custom property name, use it verbatim. Derivation is only a fallback for tokens that
   have no code identity at all.
3. **Vendor prefixes live in the code syntax, never in the Figma name.** Figma name
   `color/brand/blue`; code syntax `var(--sfp-color-brand-blue)`.

## The two identity systems run in parallel

| | Figma variable name | Code syntax |
|---|---|---|
| audience | designers, in the Variables panel | developers, in Dev Mode and generated code |
| separator | `/` | `-` for custom properties |
| case | lowercase | whatever the codebase uses |
| namespace | implicit, by collection | explicit prefix |

They are allowed to disagree, and in mature systems they usually do. What is not allowed is
for the code syntax to be a guess.

## This is why the model needs `codeName`

`tokens.json` records both sides so the round trip is checkable and drift is detectable:

```jsonc
{
  "name": "color/brand/blue",
  "codeName": "--sfp-color-brand-blue",
  "hex": "#005CB9",
  "provenance": { "kind": "config", "ref": "cohesion_custom_style.a56b4c76" }
}
```

`codeName` is **not always a custom property**, and pretending it is breaks two of the three
sites this plugin has been verified against. What goes in it depends on where the tokens
actually live:

| Token source | `codeName` holds | Example |
|---|---|---|
| `css-custom-properties` | the custom property, verbatim | `--sfp-color-brand-blue` |
| `sass-sourcemap` | the original Sass variable | `$brand-blue` |
| `sitestudio-styles` | the generated class or the Site Studio variable | `.coh-style-color-scheme-light-blue-black` |
| `tailwind` | the scale key path | `theme.colors.brand.blue` |
| none recoverable | `null`, plus a note | — |

**Do not synthesise a plausible custom property for a site that has none.** AHRI and
Schusterman are Site Studio sites: their tokens are `cohesion_custom_style` configuration
entities and generated classes, not authored custom properties. PNCB's real tokens come out
of a Sass source map, while the stylesheet the theme actually loads declares only twelve
custom properties. Inventing `--brand-blue` for any of these three puts a name in Dev Mode
that appears nowhere in the codebase, and a developer who searches for it finds nothing.
`null` with a recorded reason is the honest answer and it is also the more useful one,
because it names a real gap in the codebase's token layer.

## Collections, modes and scopes

Structure follows what the extraction found, not a template.

- **Primitives** — raw values, one mode, scope `[]` so they stay out of the picker.
- **Semantic** — aliases into primitives, never raw values. Re-theming is then one edit at
  the primitive layer.
- **Spacing** — one mode per breakpoint where spacing genuinely scales.
- **Type** — mode count follows the extraction, and **scaling is a per-role fact**. Do not
  generalise from one role. The AHRI pilot measured body text (20/32 at 1440, 905 and 400
  alike), concluded "type does not scale", and built a single-mode type collection. The
  configuration says otherwise: 13 of 43 AHRI font-size tokens scale, including Heading 2
  at 48/48/42/36 and every button size. That collection is under-specified, and its
  headings are wrong at tablet and mobile. Schusterman is the same shape - 8 of 65.

  So: give the type collection breakpoint modes whenever **any** role scales, and let the
  non-scaling roles carry identical values across the modes. One mode is correct only when
  `typeScaling.noneScale` is true.

**Set scopes on every variable.** Leaving `ALL_SCOPES` means a spacing token appears in the
colour picker, which is how a designer ends up binding the wrong thing. Background fills get
`FRAME_FILL, SHAPE_FILL`; text gets `TEXT_FILL`; borders get `STROKE_COLOR`; spacing gets
`GAP`; radii get `CORNER_RADIUS`.

## Variables come first

Components bind to variables, so no token means no component. `design-lab:figma-foundation`
runs to completion before `design-lab:figma-component` runs once, and the component skill
refuses to start if the foundation is missing or incomplete.
