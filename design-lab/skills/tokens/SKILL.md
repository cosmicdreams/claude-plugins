---
name: tokens
description: >
  Extract source-backed color, spacing, typography, and other design tokens into validated
  tokens.json with breakpoint values, provenance, and real code identifiers. Run before the
  Figma foundation; not for component extraction (design-lab:inventory).
---

# Extract tokens

Use the selected token strategy from detection:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py extract \
  --project <artifact-directory> --kind tokens
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py variables --project <artifact-directory>
```

Read `references/tokens-and-variables.md` when reviewing the result. Prefer authored loaded
configuration/custom properties to recovered source maps and measurement. Measurement may
validate a token but must not silently replace a configured value.

`codeName` is the identifier that really exists in the codebase: a custom property, Sass
variable, Site Studio class, or another source-native identity. Never synthesize one. Preserve
the value's provenance and leave a documented null where no code identity exists.

Breakpoint declarations cascade. Type scaling is per role; `observable: false` is unknown and
requires measurement or an explicit gap. Scan `unclassified` for missed token families, but do
not turn layout declarations into Figma variables merely to empty that list.

The workflow validates and atomically replaces `tokens.json`, then generates the deduplicated
`variable-plan.json`. Resolve its warnings before `design-lab:figma-foundation`.
