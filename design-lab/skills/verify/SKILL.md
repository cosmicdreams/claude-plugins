---
name: verify
description: >
  Verify an entire built Figma library against the versioned design-lab standard, fixing every
  blocker or major finding. Run before handoff; not for extraction (design-lab:inventory) or
  component construction (design-lab:figma-component).
---

# Verify the whole library

The check set and severities live in `references/library-standard.md` section 11. Do not
recreate them from memory. An unmet expectation resolves to a fix or an accurate not-built
classification. Visual evidence and master fidelity cannot be waived while an asset is built.

## Capture read-only state

Use the shipped scripts as the exact `use_figma` payloads:

1. `scripts/figma_dump_root.js` once.
2. `scripts/figma_dump_page.js` once per page, replacing `PAGE_ID`; emit page calls in
   parallel. Figma pages load on demand, so root-level child counts are not authoritative.
3. `scripts/figma_dump_getting_started.js` for the Getting Started page.

Merge the returned pages, collections, components, tagged component blocks (`cards`),
breakpoint frames, and Getting Started data into `state.json`. The page dump records the
block and panel names, section names, variant names, and image-filled capture rectangles.
These calls are read-only.

## Run the gate

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/verify.py \
  --state state.json --components components.json --tokens tokens.json \
  --render-evidence render-evidence.json \
  --capture-evidence capture-evidence.json \
  --index index.json --builds builds --brand <Brand> --waivers waivers.json \
  --theme-root <theme-root> --shots-dir <shots-dir> \
  --measurements measurements.json --plan plan.json --out verify-report.json
```

Pass every available evidence input. Deterministic Sass render evidence is enough to block a
component that consumes tokens but binds nothing; captures add reverse/per-property fidelity.
A skipped check reports `not checked`; it never passes.
Always save the report. Exit status 1 means the handoff remains gated.

For each open finding:

- fix mechanical drift and rerun the affected assertion;
- when no code identifier genuinely exists, explain that exact absence on the variable;
- reclassify a source entity as not built when evidence cannot support a trustworthy asset;
- ask before waiving a non-visual finding, recording check, narrow scope, reason, decider, and date.

After fixes, recapture affected Figma state and rerun the full gate. Record report hash,
coverage, severity counts, unavailable checks, and target file in the project manifest. Do not
call the library complete while any unwaived blocker or major remains. Also report objective
quality measures: built assets with capture evidence, passing visual comparisons, portable live
links, index-link correctness, duplicate captures, and collection count with its justification.
