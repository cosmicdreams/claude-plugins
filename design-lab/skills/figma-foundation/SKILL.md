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

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/plan_variables.py tokens.json > variable-plan.json
```

Raw extraction is not a variable plan. Site Studio custom styles are component-scoped, so
Schusterman's 172 entities yield 57 colour rows that collapse to **11 distinct hexes** and
115 spacing rows that collapse to 23 ramps. One variable per row produces a picker nobody
can use. `plan_variables.py` deduplicates by value, names each group from the contributing
style that best describes it, and keeps every contributing class as code syntax.

Read its `warnings` before building. On Schusterman it refused to create three font-family
variables whose values were unresolved Sass variables (`$coh-font-serif`) — a Figma font
called `$coh-font-serif` matches no installed font and no codebase identifier.

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

**`noneScale` has three states, not two.** `true` means nothing scales, `false` means
something does, and `null` with `observable: false` means the token source cannot answer.
A Sass source map is the third case: it records each variable once, with no CSS property
and no media query attached, so per-role scaling is not derivable from it at all. Treating
that `null` as "nothing scales" builds a single-mode Type collection on no evidence — read
`typeScaling.reason` and either measure the rendered type ramp or say plainly that the
modes are unknown.

## The three rules that are easy to get wrong

**Set code syntax on every variable**, from the token's `codeName`, never derived from the
Figma name. Web syntax requires the `var()` wrapper: `var(--sfp-color-brand-blue)`, not
`--sfp-color-brand-blue`. Without the wrapper Dev Mode shows a raw hex value and the whole
point is lost.

**Never invent a code name.** A Site Studio site has no authored custom properties; its
`codeName` is a generated class or `null`. Synthesising `--brand-blue` puts a name in Dev
Mode that appears nowhere in the codebase.

**Unitless line-height ratios cannot be line-height variables.** CSS line-height is legally
either a length (`32px`) or a ratio (`1.25`), and Figma has no ratio-typed line-height
variable — binding 1.25 makes Figma read 1.25 **pixels** and collapse every line of text.
The planner splits them into `type/leading-ratio/*` with no scope so they cannot be bound by
accident. Schusterman has two.

**Never leave `ALL_SCOPES`.** A spacing token that shows up in the colour picker is how a
designer binds the wrong thing.

## Code syntax must survive being copied

Set code syntax only where the Figma value **matches the code value**. Mapping a variable to
a custom property that holds a different number produces a name that resolves, looks correct
in Dev Mode, and is wrong — the worst of the three outcomes. On PNCB only 1 of 6 radius
variables and 6 of 16 spacing variables matched the authored CSS; the rest were built from a
different ramp and were left with no code name rather than pointed at an approximation.

Where no code name exists, **say why on the variable**. A blank code syntax with a
description reading "no custom property holds this value, recorded deliberately" is a
decision. A blank with nothing is an oversight, and `design-lab:verify` treats the two
differently — it accepts a description that addresses the absence and flags one that does
not. An unrelated note does not count.

## Collections that only exist because the code says so

Emit what the token source actually declares, not a fixed template. `plan_variables.py`
produces `LeadingRatio`, `Motion`, `Radius`, `FontWeight` and `LetterSpacing` when the source
has them.

`LeadingRatio` carries **no scopes at all**, deliberately. CSS line-height is legally a
length or a unitless ratio; Figma has no ratio-typed line-height variable, so binding 1.56
makes Figma read 1.56 **pixels** and collapse every line of text. Empty scopes make that
mistake impossible rather than merely discouraged. `Motion` is unscoped for a duller reason:
Figma has no duration scope, so the values are stored for reference only.

## Verify before handing off

Assert every token in `tokens.json` exists, every variable has a scope other than
`ALL_SCOPES`, and every variable with a non-null `codeName` has web code syntax set. Report
the counts. `design-lab:figma-component` refuses to start if this has not passed.
