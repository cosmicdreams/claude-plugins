---
name: figma-index
description: >
  Build or refresh the Figma Getting Started page from the component inventory, build records,
  verification report, and provenance. Run before components for a coverage baseline and after
  each component transaction; not for component construction (design-lab:figma-component).
---

# Refresh Getting Started

Read `references/library-standard.md` section 8. The page is a table of contents and coverage
report, not a substitute for the adjacent component documentation cards.

Generate its model deterministically:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/index_rows.py \
  <artifact-directory>/components.json --builds <artifact-directory>/builds \
  [--high 50] [--medium 10] > <artifact-directory>/index.json
```

Resolve every reported problem before rendering:

- Missing usage produces the standard Untiered structure and an explicit evidence gap.
- A machine-name collision keeps qualified source ids distinct in component/card names.
- A built row without a recorded link target is an invalid build record, not a guessed link.

Create `Getting Started` if absent; otherwise replace its content in place. Render the
standard sections in order: header, coverage, organization and thresholds, card guide, full
index, current known gaps, provenance and exact regeneration commands.

The index contains every discovered source entity, including schema-only, subcomponent,
retirement, refusals, failures, and unattempted entries. Render columns in this order:
`Placements`, `Component`, `Tier`, `Type`, `Status`, `Documentation`. Sort placements descending
within tier and keep the table visually scannable with compact rows and restrained copy. Name
the container `Index` and every row `row: <qualified-id>`. For built rows, link Component to the
recorded component/component-set node and Documentation to the card. Status is never the link.
Leave an unavailable destination visibly unlinked.

Return and record the page id, row count, generation time, thresholds, and index artifact hash.
The rendered row count must equal `components.json`; verify checks both JSON and canvas state.
