---
name: figma-index
description: >
  Rebuild the Getting Started page — coverage, how the file is organised, what each component
  block shows, the linked index, known gaps, changelog and provenance — from the recorded
  build. Run after any component is built or rebuilt. Not for building components
  (design-lab:figma-component) or the final conformance run (design-lab:verify).
---

# Getting Started

Built by `render/getting_started.js` from `figma_build.py`'s recorded results, so it always
matches what is actually in the file. It holds no state of its own and is rebuilt whole.

- **Index**: every source component, in tier order and then by placements. A built component's
  name links to its master and "Open" jumps to its block. A component that was not built links
  to nothing and says why.
- **Known gaps**: every component not built with its reason, every omitted Foundations page,
  missing fonts, and anything measured rather than tokenised.
- **Provenance**: the source commit, the site the captures came from, the standard version and
  the renderer runtime, then the commands to regenerate.

To refresh after rebuilding one component, re-run the `getting-started` step of the build:
remove it from `done` in `W/figma/state.json`, then relay `next` once.
