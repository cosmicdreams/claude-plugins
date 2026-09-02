---
name: figma-component
description: >
  Build ONE named component into Figma — variants, text and slot properties, variable
  bindings, description, documentation link — then assert it and write a build record.
  Invoke as `design-lab:figma-component <machine_name>`, once per component. Not for tokens
  (design-lab:figma-foundation) or the Getting Started index (design-lab:figma-index).
---

# Build one component

Load `figma-use` and `figma-generate-library` first — both are mandatory before any
`use_figma` call.

## Input

```
design-lab:figma-component cpt_cta_banner
```

The argument is the **machine name** as it appears in `components.json`. With no argument,
list the components whose plan entry says `build` and which have no `builds/<id>.json` yet,
then stop and ask which one. Never pick for the user, and never build several because
several are missing.

**One component per invocation. This is the point of the skill, not a limitation.** A single
run over 146 components exhausts its context partway and leaves a half-built file with no
record of where it stopped. One at a time is resumable, reviewable, and can be fanned out
across parallel agents.

## Preconditions

1. `design-lab:figma-foundation` has completed. Refuse otherwise — a component built before
   its variables exist hardcodes every value it should bind.
2. The plan entry says `build`, not `refuse`. A refusal is a decision; record it and stop.
3. Read `builds/<id>.json` if it exists. Update that component; never create a second.
4. **Read the description of any component already in the file with a similar name.** A
   library with `table` and `table_row` in it will punish a guess, and a wrong machine name
   in a description is worse than none because it is quoted downstream as fact.

## Sequence

1. **Resolve the target page** from the usage tier — one page per tier, not per component.
   See `references/findability.md`.
2. **Name it `<machine_name> — <Human Label>`**. Assets panel search is substring matching,
   so one name answers both `banner` and `cpt_cta`.
3. **Build the base with auto-layout, mirroring what the code actually does** — property by
   property. Where the source resolves a value through a token, bind the corresponding
   variable: fills, strokes, padding, gap, corner radius, and width to the container token
   when the component is full width. **Where the source hardcodes a literal, carry the
   literal** and record a `hardcoded-value` defect naming the property and the token it
   should have used.

   Zero hardcoded fills is **not** the goal, and chasing it is the failure mode this step
   exists to prevent. A component that binds a variable the code does not use is a different
   component from the one on the site: the defect a designer was best placed to spot has been
   erased, and the next sync compares two things that were never the same. See
   `references/library-standard.md` section 1 — the file is a seed of ground truth, and
   improving a component on the way in destroys the signal it exists to carry.
4. **Give every text node a TEXT property.** This is the step most often skipped and the one
   that decides whether the component gets used. A text node with no property cannot be
   edited on an instance, so a designer detaches the instance to change one word, and a
   detached instance no longer tracks the library. Five of the seven components built on
   PNCB before this rule was written had none.
5. **Give every slot an INSTANCE_SWAP property**, and compose the slot from **real instances
   of the components it accepts** where those exist. A table containing three actual
   `table_row` instances shows the relationship the configuration describes; three static
   rows only look like it.
6. **Create variants** from `plan.variantAxes`, then position them — `combineAsVariants`
   stacks everything at the origin.
7. **Place the default variant first.** Figma uses the first variant as the instance
   default; get this wrong and the library previews as blank. See `references/defaults.md`.
8. **Write the description**: machine name, source path, usage counts, the fields, and —
   explicitly — anything not measured. A component built from the field set rather than from
   a capture must say so, or its proportions will be read as measured.
9. **Set `documentationLinks`** to the component's documentation card, which sits beside it on
   the same tier page. An empty array is the commonest way a library looks finished and is
   not — it leaves nothing in the Assets panel leading a designer to the documentation.
10. **Assert**, per `references/verification.md`.
11. **Write `builds/<id>.json`**, per `references/build-records.md`, including
    `figma.documentationCardId` — the index hyperlinks every row to it.
12. **Refresh the index**: `design-lab:figma-index`. It reads the record you just wrote, so
    the Getting Started page stops saying this component is unbuilt.

## Property traps, all of them hit in practice

**A colliding property name is silently renamed.** `addComponentProperty('Content', …)` on a
component that already has `Content` creates `Content2`. Read
`componentPropertyDefinitions` first and reuse the existing key rather than adding a
near-duplicate that a designer then has to tell apart.

**Never read `componentPropertyDefinitions` from a variant.** Narrow to the `COMPONENT_SET`,
or to a `COMPONENT` whose parent is not a set. Optional chaining does not make the getter
safe. See `references/component-patterns.md`.

**Wire the property in every variant.** A set has one property and N text nodes that must
each reference it — one per variant. Wiring only the default leaves the other variants
uneditable, which is invisible until someone switches variant.

**Load the font before touching a text node.** Any mutation on a node with an unloaded font
throws, not only `characters`.

## Record what Figma cannot do

Auto-layout direction cannot bind to a component property, so responsive direction switches
and reverse-direction toggles are unbuildable. Record them under `unsupported` with the
reason and say so in the description. A library that silently omits them reads as complete
and is not.

Where a paragraph renders values it does not author — an entity reference that pulls its
title, image and date from the referenced node — expose only what an author can actually
change, and say in the description why the rest is absent. Otherwise a designer expects
fields the content form does not have.

## Never guess a node identifier

Read them from the build record or from a returned value. A reconstructed identifier is a
plausible string pointing at an unrelated node, and the corruption is hard to trace.

## Finish by verifying

Run `design-lab:verify` after a build session. It is the only step that looks at the whole
file, and it prints the completeness figure — how many of the expected components exist —
which no single build can know.
