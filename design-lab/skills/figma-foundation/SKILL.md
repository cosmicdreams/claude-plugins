---
name: figma-foundation
description: >
  Create the Figma variable collections, modes, scopes and code syntax from tokens.json —
  the foundation every component binds to. Runs once per file and must complete before
  design-lab:figma-component runs at all. Not for building components (design-lab:figma-component).
---

# Build the variable foundation

Load the `figma-use` and `figma-generate-library` skills first. Both are mandatory before
any `use_figma` call; skipping them causes hard-to-debug failures.

Components bind to variables, so **no token means no component**. This skill runs to
completion before `design-lab:figma-component` runs once.

## Input

`tokens.json` per `references/model.md`. Read `references/tokens-and-variables.md` before
changing anything here — it carries the rules that make the result consistent with the code.

## What gets created

| Collection | Modes | Scope |
|---|---|---|
| Primitives | 1 | `[]` — hidden from pickers |
| Semantic | one per theme, aliased into primitives, never raw values | by role |
| Spacing | one per breakpoint where spacing genuinely scales | `GAP`, padding |
| Type | modes whenever **any** role scales | `FONT_SIZE`, `LINE_HEIGHT` |

Read `typeScaling` from `tokens.json` and do not generalise from one role. The AHRI pilot
measured body text at 20/32 across all breakpoints and built a single-mode type collection;
the configuration shows 13 of 43 font-size tokens actually scale, Heading 2 among them at
48/48/42/36. Give type breakpoint modes unless `typeScaling.noneScale` is true, and let the
roles that do not scale repeat their value across modes.

## The three rules that are easy to get wrong

**Set code syntax on every variable**, from the token's `codeName`, never derived from the
Figma name. Web syntax requires the `var()` wrapper: `var(--sfp-color-brand-blue)`, not
`--sfp-color-brand-blue`. Without the wrapper Dev Mode shows a raw hex value and the whole
point is lost.

**Never invent a code name.** A Site Studio site has no authored custom properties; its
`codeName` is a generated class or `null`. Synthesising `--brand-blue` puts a name in Dev
Mode that appears nowhere in the codebase.

**Never leave `ALL_SCOPES`.** A spacing token that shows up in the colour picker is how a
designer binds the wrong thing.

## Verify before handing off

Assert every token in `tokens.json` exists, every variable has a scope other than
`ALL_SCOPES`, and every variable with a non-null `codeName` has web code syntax set. Report
the counts. `design-lab:figma-component` refuses to start if this has not passed.
