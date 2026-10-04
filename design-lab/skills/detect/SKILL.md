---
name: detect
description: >
  Detect prior design-system work and the independent component, token, and usage sources in a
  repository. Run before extraction; not for extracting components (design-lab:inventory) or
  building Figma (design-lab:figma-component).
---

# Detect sources

For an end-to-end run, initialize and detect through the stateful front door:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py init \
  --repo <absolute-repository-path>
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py detect --project <artifact-directory>
```

`init` prints the run folder it created by the person's convention; that folder is `<artifact-directory>`.

For an isolated probe, `scripts/detect.py <repo>` emits the same detection document to stdout.

Read `priorArt` before extraction. Reconcile existing conventions and generated artifacts unless the user explicitly requested an independent scratch build. See `references/prior-art.md`.

Component, token, and usage sources are independent. The recommendation prefers the system an author places over its rendering primitives: Drupal block-content + paragraph bundles outrank the SDCs that render them. On a Site Studio site, Site Studio outranks a smaller block and paragraph vocabulary beside it: editors build those pages with Site Studio. A loaded authored token layer outranks recoverable compiled sources. Canvas registrations outrank raw Single Directory Components (SDCs) where Canvas is present; the matching usage strategy is `canvas-db`.

Use the recommendation when evidence agrees. Within `design-lab:run`, the recommendation is stated at preflight, and the person's answer there settles it; ask only there, and only when competing sources would materially change the inventory and repository evidence cannot resolve them. Persist an override with `workflow.py select`; do not leave the decision in conversation memory.

Site Studio's configuration export is read from the folder the site's settings declare (`$settings['site_studio_sync']`, else `$settings['config_sync_directory']`), recorded as the decision `sitestudioConfig`. When `detection.json`'s `siteStudio.problem` says the settings name no readable folder, find it in the repository (the folder holding `cohesion_*.yml`) and record it with `workflow.py select --sitestudio-config <folder>`; ask the person only when two folders hold different Site Studio exports. Custom components in the site's own modules and themes are found without it.

Check `notes` for ignored empty config directories, generated assets, unloaded token candidates, and unavailable extractors before continuing to `design-lab:inventory` and `design-lab:tokens`.
