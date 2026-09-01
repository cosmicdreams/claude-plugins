---
name: detect
description: >
  Probe a repository and report which design-lab strategies apply across the three
  independent plug points — component source, token source, usage source. Run this first;
  every other design-lab skill needs its answer. Not for extracting components
  (design-lab:inventory).
---

# Detect design-lab strategies

## Step zero: look for an existing answer

Before probing for strategies, look for work that already exists — an existing Figma file,
and existing tooling in the repository.

```bash
find . -maxdepth 4 -type d \( -name "*component*librar*" -o -name "*design*system*" \) \
     -not -path "*/node_modules/*"
ls build/ analysis-reports/ 2>/dev/null
```

On Schusterman this finds `scripts/component-library/` — a complete working pipeline — and
`build/component-library/usage.json`, holding real placement counts from 2,448 production
canvases. Extraction that ignores them reproduces them badly: the page crawl saw `cpt_text`
26 times where the canvases show 871. Read `references/prior-art.md` before continuing.

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
