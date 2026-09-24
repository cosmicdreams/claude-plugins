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
  --repo <absolute-repository-path> --workspace <artifact-directory>
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py detect --project <artifact-directory>
```

For an isolated probe, `scripts/detect.py <repo>` emits the same detection document to stdout.

Read `priorArt` before extraction. Reconcile existing conventions and generated artifacts unless
the user explicitly requested an independent scratch build. See `references/prior-art.md`.

Component, token, and usage sources are independent. The recommendation prefers the system an
author places over its rendering primitives: Drupal block-content + paragraph bundles outrank
the SDCs that render them. A loaded authored token layer outranks recoverable compiled sources.

Use the recommendation when evidence agrees. Ask only when competing sources would materially
change the inventory and repository evidence cannot resolve them. Persist an override with
`workflow.py select`; do not leave the decision in conversation memory.

Check `notes` for ignored empty config directories, generated assets, unloaded token candidates,
and unavailable extractors before continuing to `design-lab:inventory` and `design-lab:tokens`.
