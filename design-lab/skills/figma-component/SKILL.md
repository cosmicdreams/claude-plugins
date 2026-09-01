---
name: figma-component
description: >
  Build ONE component into Figma from components.json and the plan — variants, properties,
  variable bindings, description, then assert the result and write a build record. Invoke
  once per component. Not for tokens (design-lab:figma-foundation) or the index page
  (design-lab:figma-atlas).
---

# Build one component

Load `figma-use` and `figma-generate-library` first — both are mandatory before any
`use_figma` call.

**One component per invocation. This is the point of the skill, not a limitation.** A single
run that tries to build 146 components exhausts its context partway and leaves a half-built
file with no record of where it stopped. One at a time is resumable, reviewable, and can be
fanned out across parallel agents.

## Preconditions

1. `design-lab:figma-foundation` has completed. Refuse to start otherwise — a component
   built before its variables exist hardcodes every value it should bind.
2. The component's plan entry says `build`, not `refuse`. A refusal is a decision; record it
   and stop.
3. Read `builds/<id>.json` if it exists. Update the existing component; never create a
   second.

## Sequence

1. **Resolve the target page** from `category` — one page per category, not per component.
   146 pages is its own navigation failure. See `references/findability.md`.
2. **Name it `<machine_name> — <Human Label>`**, for example
   `cpt_cta_banner — Call To Action Banner`. Assets panel search is substring matching, so
   this single name answers both `banner` and `cpt_cta`, and leading with the machine name
   sorts the `cpt_` family together. See `references/findability.md`.
3. **Build the base** with auto-layout, binding every visual property to a variable.
4. **Create variants** from `plan.variantAxes`, then position them — `combineAsVariants`
   stacks everything at the origin.
5. **Place the default variant first.** Figma uses the first variant as the instance
   default; get this wrong and the library previews as blank. See `references/defaults.md`.
6. **Add properties** from `plan.properties` — text, boolean, instance swap.
7. **Write the description**: machine name, source reference, verified example address,
   deferred fields, and any defects the inventory found. This is what a developer reads in
   Dev Mode.
8. **Set documentation links** to the verified example address, when one exists.
9. **Assert**, per `references/verification.md` — structure, bindings, fidelity.
10. **Write `builds/<id>.json`**, per `references/build-records.md`, including the
    screenshot and the source hash.

## Record what Figma cannot do

Auto-layout direction cannot bind to a component property, so responsive direction switches
and reverse-direction toggles are unbuildable. Record them under `unsupported` with the
reason and say so in the description. A library that silently omits them reads as complete
and is not.

## Never guess a node identifier

Read them from the build record or from a returned value. A reconstructed identifier is a
plausible string pointing at an unrelated node, and the corruption is hard to trace.
