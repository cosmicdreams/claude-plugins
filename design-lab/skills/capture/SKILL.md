---
name: capture
description: >
  Measure and photograph inventoried components on a running site at documented breakpoints.
  Produces source-fidelity measurements and element-scoped screenshots for Figma components and
  cards. Not for discovering components (design-lab:inventory) or counting usage
  (design-lab:usage).
---

# Capture rendered components

`measure.mjs` records box model, type, fills, borders, and declared versus computed values.
`capture.mjs` records element-scoped PNGs. Use the same config and named states for both so the
picture and measurements describe the same render.

## Configure

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold_configs.py components.json \
  --out components/ --theme-root <theme-root> \
  --canonical-base-url https://www.example.org
```

Resolve every stub the scaffolder reports. `verificationUrl` must come from verified usage
evidence and may use DDEV; `path` is root-relative and `linkUrl` uses the canonical base URL.
`rootSelector` must select the component's real rendered root; a Drupal bundle class is invalid
when its template does not print attributes.

Config shape:

```json
{"component":"FAQ","machineName":"faq","path":"/help/faq",
 "verificationUrl":"https://example.ddev.site/help/faq",
 "linkUrl":"https://www.example.org/help/faq",
 "rootSelector":".faq","anchorText":null,"mustContain":null,"nth":0,
 "states":[{"name":"default"},{"name":"open","setup":"..."}]}
```

## Run

Playwright resolves from the current working directory. Run from a project that provides it.
When that project has a system Chromium/Chrome but no Playwright-managed browser download,
set `DESIGN_LAB_BROWSER_EXECUTABLE` explicitly:

```bash
export DESIGN_LAB_BROWSER_EXECUTABLE="/path/to/Chrome"
node ${CLAUDE_PLUGIN_ROOT}/scripts/measure.mjs --config components/faq.json --out measurements/
node ${CLAUDE_PLUGIN_ROOT}/scripts/capture.mjs --configs components/ --out shots/
```

Use `anchorText`, `mustContain`, or `nth` when selectors collide. Both scripts ignore zero-height
matches before disambiguation. Capture the default state at desktop, tablet, and mobile for every
component. Capture additional states that materially change appearance or behavior at the same
three widths. A component with no reachable selector is ineligible to be built; record
`Not built — no visual evidence` and never substitute another component's capture.

Verify that captures are non-empty and unique, states agree between measurement and screenshot,
and all breakpoint images use their real dimensions. Register `capture-evidence.json` before
planning. Its entry for each component is the permission to create a visual master; capture is
not a completion-waivable phase.
