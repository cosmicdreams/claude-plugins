---
name: figma-foundation
description: >
  Explain, rebuild or diagnose the library's pages, variables and Foundations pages (Color,
  Typography, Spacing & Layout, Elevation & Shape, Brand Voice & Language). Run as part of
  design-lab:run; use alone to refresh foundations after tokens or published copy change. Not
  for components (design-lab:figma-component).
---

# Foundations

Built by fixed templates from the artifacts: `render/pages.js` (page list and order),
`render/variables.js` (collections, modes, scopes and code syntax from `variable-plan.json`),
`render/foundation.js` (the specimen pages) and `render/voice.js` (Brand Voice & Language from
`voice.json`). The model relays the steps; it never lays anything out.

## What decides each page

- A Foundations page exists only when its source has values: colour and type tokens from the
  stylesheets, spacing and shape tokens when declared, the voice page when the published pages
  could be read. An omitted page is named under Known gaps.
- Type sizes the stylesheets do not declare as tokens appear on the Typography page as a
  **measured** scale from the built components — labelled as measured, never turned into
  variables.
- Brand Voice & Language states only what `scripts/extract_voice.py` measured: evidence tiles,
  observed and watch rows with their denominators, vocabulary, mechanics and published
  inconsistencies. Nothing is taken from a brand document and no language model writes it.

## Refresh

Re-run `design-lab:run`'s render section; the foundation steps are idempotent and replace
their own page content. After tokens change, run `workflow.py variables` first so
`variable-plan.json` is current. After copy changes, re-run `extract_voice.py`.
