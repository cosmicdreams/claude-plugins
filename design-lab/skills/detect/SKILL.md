---
name: detect
description: >
  Probe a repository and report which design-lab strategies apply across the three
  independent plug points — component source, token source, usage source. Run this first;
  every other design-lab skill needs its answer. Not for extracting components
  (design-lab:inventory).
---

# Detect design-lab strategies

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/detect.py <repo-root>
```

Returns JSON: `componentSources`, `tokenSources`, `usageSources`, `recommended`, `notes`.

## Read the output carefully

**Never assume `config/sync`.** The detector probes `config/sync`, then `config/default`,
then `config`. Schusterman uses `config/default`; looking only in `config/sync` finds zero
components on a site with 101 of them.

**Never trust a raw `*.component.yml` count.** Drupal core and contrib ship their own
Single Directory Components. The detector prunes `core/`, `contrib/`, `vendor/` and
`node_modules/`. On PNCB a naive count returns 51 where only 13 are the client's; on
Schusterman it returns 26 where **none** are.

**More than one component source can be present.** Do not silently pick the first. Ask
which one the design system actually lives in.

## Next

`design-lab:inventory` with the chosen component source.
