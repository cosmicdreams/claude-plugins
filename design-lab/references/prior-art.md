# Prior art

**Look for an existing answer before extracting anything.** This document exists because
design-lab was run against Schusterman while both a Figma file and a complete working
toolchain already existed, and every difference between them was design-lab being worse.

The `figma-generate-library` skill opens with Phase 0 DISCOVERY for exactly this reason.
Skipping it is not a shortcut; it is how you produce a second, contradictory design system.

## What to look for, in this order

### 1. An existing Figma file

Read it before creating anything, even if you intend to build somewhere else. What it
encodes is a set of decisions someone already argued about:

- **page structure** — the information architecture, and the strongest signal in the file
- **variable collections, modes and code syntax** — the naming convention already agreed
- **component naming** — match it rather than imposing a new scheme
- **the Cover page** — usually states the method, the data source and the generation date

A file whose pages are all empty is not an empty file. Schusterman Components 2026 had zero
variables and zero components, and its page list was still the most valuable thing found all
day: components organised by **usage tier**, with `Structural Only` and
`Retirement Candidates` as first-class categories. No amount of extraction produces that.

### 2. Existing tooling in the repository

Search for it. A Cover page that says "Regenerate with `scripts/component-library/`" is
telling you there is a pipeline, and on Schusterman there was: inventory, foundations, usage
counting, page list, instance map, Figma payload and a Playwright screenshot harness, all
working, all committed.

```bash
find . -maxdepth 4 -type d \( -name "*component*librar*" -o -name "*design*system*" \) \
     -not -path "*/node_modules/*"
ls build/ analysis-reports/ 2>/dev/null
```

Generated artifacts matter as much as the scripts. `build/component-library/usage.json`
carried real placement counts; reproducing them badly was pure loss.

### 3. Reconcile, then report the gap

Print a gap analysis before writing: what exists in code but not Figma, what exists in Figma
but not code, and every conflict with its resolution. Adopt the existing convention unless
there is a stated reason to break it.

## What this cost on Schusterman

| Question | design-lab, greenfield | The existing answer |
|---|---|---|
| `cpt_text` placements | 26, from a 250-page crawl | **871**, from 2,448 production canvases |
| colour palette | 11 hexes named `card-fake-button` | **43** named colours with Sass variables |
| font families | unresolved `$coh-font-serif` | **Greta Text**, from `cohesion_font_stack` |
| spacing scale | 23 deduped component ramps | `$spacer-xxs..xxxl`, a real 4-96 ramp |
| tiers | thirds of the ranked distribution | absolute thresholds, plus two more tiers |
| organisation | invented category pages | usage-tier pages already under review |

Every row on the left is work that was thrown away.

## The general rule

Extraction answers "what does the code say". It does not answer "what has this team already
decided", and on a mature project that second question has a written answer somewhere. Find
it first. When the two disagree, the code is the authority on values and the existing file is
the authority on organisation and naming.
