---
name: capture
description: >
  Measure and photograph inventoried components on a running site at documented breakpoints.
  Produces source-fidelity measurements and element-scoped screenshots for Figma components and
  cards. Not for discovering components (design-lab:inventory) or counting usage
  (design-lab:usage).
---

# Capture rendered components

Capture records two things per component from one config: measurements (box model, type, fills, borders, and declared versus computed values) and element-scoped PNGs. Both use the same config and named states, so the picture and the measurements describe the same render.

## Configure

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold_configs.ts components.json \
  --out components/ --theme-root <theme-root> \
  --site-url https://example.ddev.site --canonical-base-url https://www.example.org
```

Resolve every stub the scaffolder reports. `path` comes from the first available usage example; `verificationUrl` uses the local site URL and `linkUrl` uses the canonical base URL. `rootSelector` must select the component's real rendered root; a Drupal bundle class is invalid when its template does not print attributes.

Config shape:

```json
{"component":"FAQ","componentId":"faq","machineName":"faq","path":"/help/faq",
 "verificationUrl":"https://example.ddev.site/help/faq",
 "linkUrl":"https://www.example.org/help/faq",
 "rootSelector":".faq","anchorText":null,"mustContain":null,"nth":0,
 "states":[{"name":"default"},{"name":"open","setup":"..."}]}
```

## Run

Measurements and screenshots close DataGrail cookie preferences through its close button, including its shadow DOM, and wait until the panel is hidden. Cookies and local storage carry forward between breakpoints within one component; a final check before each capture catches late panels. A panel that cannot close fails that capture. Other vendors can use `"cookiePreferences":{"bannerSelector":"#consent","closeSelector":".close","timeout":5000}` in the component config. To accept once within that script instead, use DataGrail's `"closeSelector":"button.accept_all"`. Use `"cookiePreferences":false` when capturing the cookie panel itself. This setting must be identical for measurement and screenshots.

Run the full capture after `design-lab:init` installs the pinned Playwright packages and Chromium in the shared cache. The command works from any directory, scaffolds configs, measures each eligible component, takes desktop/tablet/mobile screenshots, assembles evidence, and registers it in the workspace:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/capture_all.ts \
  --project .design-lab --site-url https://example.ddev.site \
  --canonical-base-url https://www.example.org \
  --theme-root docroot/themes/custom/example
```

Capture, including the selector check, uses that shared installation. Keep the same absolute `DESIGN_LAB_CACHE` when overriding the default cache location; no project-local Playwright installation is needed.

Capture is incremental. Each component's outcome is written to `capture/records/` as soon as it finishes, together with the hash of the config it came from; a later run skips every component whose record is complete and whose config is unchanged, and rebuilds the evidence from all current records. Never delete records to "start clean"; use `--fresh` with `--only` for the components that need redoing.

- `--check` runs only the selector check: one desktop page load per candidate page, reporting matches, visible matches and height. It takes about a second per component. Run it first, and fix every failure before the full capture.
- `--only <id>[,<id>]` captures just those components, so one fix is verified in under a minute.
- `--max-pages` (default 3) bounds how many verified example pages are tried per component.
- `--no-check` skips the check; the check loads desktop width only, so use this for a component that is drawn only at narrower widths.

Progress prints one line per component with its time and the estimated time left; quote that estimate, not a guess.

A component found only inside an inactive tab or closed panel is drawn by showing its hidden ancestors (marked `data-design-lab-revealed` on the page); the selector check and the component's record say `revealed`. With Twig debug on (`development_settings.twig_debug`), usage prefers the bundle's own template suggestion over an embedded component's `data-component-id`, because one component is often embedded by several bundles. Keep Twig debug on for the whole capture: components located by template marker cannot be found without it. Turn on `twig_debug` only, never `twig_cache_disable`: debug comments are compiled into the Twig cache like any other output, and disabling the cache makes every uncached page recompile its templates (on one site, 4 to 12 seconds a page).

Child bundles are tagged during each parent's measurement (`data-design-lab-child`), and Twig debug counts, on the parent's own page, how many times each child's own template runs inside the parent's render (`capture/relationships.json`). A child that renders through its own template is built and nested as an instance; one the parent prints from field values is recorded as not rendered. A child with no example page of its own is captured from inside its parent: its subtree of the parent's measurement, the same occurrence at every width, and a crop of the parent's screenshots. A revealed element is raised to the top of the stacking order for its screenshot, so the page's other layers do not paint over it.

Every browser step has a time limit (measure 15 minutes, screenshots 30), killed with its browser: a page that never answers fails one component, and the run moves on. On a slow local site, a single component can take minutes; the progress line's estimate uses each remaining component's previous time when available, otherwise the completed components' average, adjusted for active workers. Read it rather than guessing.

When that project has a system Chromium/Chrome but no Playwright-managed browser download, set `DESIGN_LAB_BROWSER_EXECUTABLE` explicitly. For a hand-written or edited config, pass the folder of config files with `--configs` and name the component with `--only`. Measurements land in `capture/measurements/<id>.spec.json` and screenshots in `capture/shots/` inside the project folder:

```bash
export DESIGN_LAB_BROWSER_EXECUTABLE="/path/to/Chrome"
node ${CLAUDE_PLUGIN_ROOT}/scripts/capture_all.ts \
  --project .design-lab --configs components/ --only faq \
  --canonical-base-url https://www.example.org
```

Add `--check` for the selector check alone. Old releases shipped separate `measure.mjs`, `capture.mjs` and `check_selectors.mjs` scripts; they are gone, and `capture_all.ts` does all three.

Use `anchorText`, `mustContain`, or `nth` when selectors collide. Measurement and screenshots both ignore zero-height matches before disambiguation. Capture the default state at desktop, tablet, and mobile for every component. Capture additional states that materially change appearance or behavior at the same three widths. A component with no reachable selector is ineligible to be built; record `Not built — no visual evidence` and never substitute another component's capture.

Verify that captures are non-empty and unique, states agree between measurement and screenshot, and all breakpoint images use their real dimensions. Register `capture-evidence.json` before planning. Its entry for each component is the permission to create a visual master; capture is not a completion-waivable phase.
