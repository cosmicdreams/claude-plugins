---
name: capture
description: >
  Measure and photograph each component on a running site — box model and typography per
  node, plus element-scoped screenshots, at every breakpoint. Feeds the documentation cards
  and the Figma build. Run after design-lab:inventory. Not for deciding which components
  exist (design-lab:inventory) or where they are used (design-lab:usage).
---

# Capture components from a running site

This answers "what does each component actually look like", which is a different question
from "which components exist" (`design-lab:inventory`) and "where are they used"
(`design-lab:usage`). Both of those read configuration. This one needs the site running.

Two scripts, one config format:

| Script | Emits | Used by |
|---|---|---|
| `measure.mjs` | box model, typography, fills, borders per node per breakpoint | the Figma build |
| `capture.mjs` | element-scoped PNG per breakpoint per state | the documentation cards |

`measure.mjs` deliberately produces no images — everything it records can become a native
Figma node with bound variables. `capture.mjs` produces only images. A card needs both.

## 1. Scaffold the configs

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold_configs.py components.json \
    --out components/ --theme-root docroot/themes/custom/<theme>
```

**Read what it prints.** It writes a stub per component and lists the ones that will produce
nothing until a human fills them in. On PNCB four components had no config at all, so four
components had no measurements and no screenshots — including `table_row` at 116 placements,
and nothing reported it until `design-lab:verify` counted.

Two fields it cannot derive:

- **`url`** — which page renders a component is a content fact, not a configuration one. Run
  `design-lab:usage` first for verified addresses, or fill them in by hand.
- **`rootSelector`**, often. It reads the component's own Twig template and tells you where
  the answer came from. `.paragraph--type--NAME` only works where the template prints
  `{{ attributes }}`; a component with its own template usually emits no bundle class. PNCB's
  `table_row` opens with a bare `<tr>`, so no selector is derivable and a structural one
  (`.c-table tbody tr`) has to be written. The scaffolder says so rather than guessing.

## 2. Measure, then capture

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/measure.mjs --config components/faq.json --out spec/
node ${CLAUDE_PLUGIN_ROOT}/scripts/capture.mjs --configs components/ --out shots/ \
     [--only faq,accordion] [--viewports "Desktop:1400x1200,Tablet:800x1200,Mobile:375x1200"]
```

Run from a directory where `playwright` resolves — the plugin ships none, because a browser
binary has no business inside a plugin. `npm i -D playwright && npx playwright install
chromium` if the project has none.

## The config

```jsonc
{
  "component": "Frequently Asked Questions",
  "machineName": "faq",
  "url": "https://<site>/node/531",
  "rootSelector": ".paragraph--type--faq",
  "anchorText": "…",      // optional: disambiguate by text content
  "mustContain": ".foo",  // optional: disambiguate by a descendant
  "nth": 0,               // optional: which match, after filtering
  "states": [{ "name": "default" },
             { "name": "open", "setup": "document.querySelectorAll('input.trigger').forEach(i=>i.checked=true)" }]
}
```

`states[].setup` runs in the page and is shared by both scripts, so a component that must be
opened to be visible opens the same way when measured and when photographed.

## Three traps, all of which have produced wrong output

**Take the first match with real height, not `.first()`.** Several pages hold both an empty
and a populated instance of one component, and `.first()` reliably grabs the empty one. Both
scripts filter on height, then apply `anchorText` / `mustContain` / `nth`.

**Two components can share a selector, and the failure is invisible.** On PNCB `cta_grid`,
`hl_hl_news` and `multicolored_three_up_component` all resolve to the same element, as do
`text_editor` and `full_width_row` — five components, two pictures, and a directory listing
that looks complete. `design-lab:verify` checks this by checksum (`captures-unique`); run it
after capturing. The fix is a disambiguator in the config, not a new selector.

**Do not expand something whose measurement records it collapsed.** Opening every accordion
before capture produced a 6131px image beside a caption reading 1871px, because the
measurement was of the collapsed state. Expand only components that are invisible closed, and
express it as a named state so the two scripts agree.

## Then

`design-lab:figma-component <machine_name>` to build, `design-lab:figma-atlas` for the cards,
`design-lab:verify` to check the whole file — including that no two captures are identical.
