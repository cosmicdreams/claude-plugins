---
name: inventory
description: >
  Extract every component, field, option, slot and source defect from a codebase into
  components.json, the universal model that every other design-lab skill reads. Run after
  design-lab:detect. Not for deciding how to build them (design-lab:plan).
---

# Inventory components

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/extract_sitestudio.py <repo-root> > components.json
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/extract_sdc.py        <repo-root> > components.json
```

Shape is defined by `references/model.md`. Read it before changing anything — extractors
must not leak source-specific vocabulary past their own boundary.

## What it also finds

Extraction doubles as a source lint. Both of these were confirmed by hand on AHRI before
being automated:

- **`dangling-field-ref`** — a style or show-condition references a field uuid that is no
  longer in the component form, surviving only in `meta.fieldHistory`. The bound style
  silently never applies.
- **`duplicate-show-condition`** — two conditional fields sharing an identical condition,
  which is nearly always a copy-paste slip. On AHRI, a container's dark-background text
  colour tested `tags include 'Light'`.

Report these even when the caller only asked about Figma. They have value for people who
never open a design tool.

## tokenFamily is the load-bearing field

Enum options whose values are style classes get classified: `spacing`, `color-scheme`,
`layout`, `color`. This drives the whole variant decision — see
`references/variant-policy.md`. Classifying on the `coh-style-` prefix alone is wrong: it
demotes theme and column choices, which are genuine variant axes, into bound variables.
