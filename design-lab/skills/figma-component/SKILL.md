---
name: figma-component
description: >
  Build, rebuild or diagnose ONE component in the Figma library: its responsive master, its
  documentation block, its live captures and its visual comparison. Invoke as
  `design-lab:figma-component <component-id>`. Not for foundations (design-lab:figma-foundation),
  the Getting Started page (design-lab:figma-index), or a whole library (design-lab:run).
---

# One component

Every component is built by fixed code from its measurements, never drawn by hand. This skill relays those steps for one component and reads what came back.

## What gets built

- **One responsive master.** `src/responsive.ts` merges the desktop, tablet and mobile measurements into one tree; `scripts/render/build_responsive.ts` builds it. Values that change with width are variables in the shared `<Brand> Core` collection. There is exactly one Figma component per source component: no per-viewport copies, no breakpoint variants.
- **Its block** (`scripts/render/component_block.ts`): the documentation panel, then the master at desktop beside instances of it resized to tablet and mobile with their Breakpoint mode set, then the live captures in the same columns.
- **A visual comparison** (`scripts/figma_compare.ts`) of each width against its capture, from one screenshot of the block's specimen.

## Build or rebuild one component

The library must already exist (built by `design-lab:run`). Initialise a subset build in the same workspace and relay it exactly as `references/relay.md` describes:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/figma_build.ts init --project <W> --file-key <key> \
  --site-url <local-site-url> --canonical-base-url <public-url> --only <component-id>
```

The subset keeps the full library manifest, untouched receipts and existing master/variant IDs. It also rebuilds dependent parents, refreshes coverage, and invalidates earlier verification and benchmark claims. A changed component/set shape or variant identity requires a fresh-file build; never delete the existing master to get past that refusal. The templates replace the documentation block while retaining its master. Re-run `design-lab:figma-index` afterwards so the index points at the new nodes.

## Diagnose a failing comparison

Read `W/figma/results/compare_<id>.json` and the screenshot beside it in `W/figma/compare/`. Crop the failing width's pair (the geometry is in the block result) and look at it. Then fix the cause in the code, not in the file:

| Symptom | Where the fix belongs |
| --- | --- |
| Text wraps where the site does not | single-line detection in `src/spec-to-tree.ts` |
| An element the site hides is drawn | visibility in `src/spec-to-tree.ts` (`visible`) / `src/capture/walk.ts` |
| Items in the wrong place at one width | layout inference or slot flow in `responsive.ts` |
| A box is the wrong height | sizing in `scripts/render/build_responsive.ts` |
| A lazy image missing or different | the image wait in `src/capture/browser.ts` |

Never repair a component by editing the Figma file. A hand fix is gone on the next run and makes two runs differ, which is the one thing this pipeline exists to prevent.
