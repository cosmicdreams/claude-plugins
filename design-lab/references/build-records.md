# Build records

One file per component, written by `design-lab:figma-component`, at
`builds/<component-id>.json`. It is the reason a 146-component library can be built across
many sessions by many agents without anyone remembering anything.

It does three jobs at once, and all three matter:

1. **Idempotency key.** Re-running a component must update the existing one, not create a
   second. Name lookup alone is not enough — a rename orphans the original silently — so the
   record stores node identifiers.
2. **Resume point.** Context runs out. A batch dies halfway. The set of records on disk is
   the answer to "what is already done", and it survives everything.
3. **Verification evidence.** The assertion results from `references/verification.md` live
   here, so "built" is a claim with a receipt attached.

## Shape

```jsonc
{
  "id": "cpt_cta_banner",
  "figma": {
    "fileKey": "YnlrCKNjSJXCEGiO24qf67",
    "pageId": "12:34",
    "pageName": "Marketing",
    "componentSetId": "12:56",
    "variantIds": { "Theme=Default, Alignment=Left": "12:57" }
  },
  "built": {
    "variants": 8,
    "variantAxes": [ { "property": "Theme", "values": ["Default", "..."] } ],
    "properties": [ { "name": "Title", "type": "TEXT" } ],
    "bindings": 94
  },
  "deferred": [
    { "field": "inside-banner-padding",
      "reason": "11 options; bound to pad/* variables rather than a variant axis",
      "policy": "variant-policy.md spacing default" }
  ],
  "unsupported": [
    { "field": "column-direction",
      "reason": "auto-layout direction cannot bind to a component property" }
  ],
  "assertions": {
    "structure": { "verdict": "pass" },
    "bindings":  { "verdict": "pass", "unbound": [] },
    "fidelity":  { "verdict": "pass", "against": "https://www.ahrinet.org/certification",
                   "breakpoint": 1440,
                   "compared": [ { "property": "paddingTop", "figma": 32, "live": 32 } ] }
  },
  "screenshot": "builds/screenshots/cpt_cta_banner.png",
  "sourceRef": "config/sync/cohesion_elements.cohesion_component.cpt_cta_banner.yml",
  "sourceHash": "sha256:...",
  "builtAt": "2026-09-01T00:00:00Z",
  "toolVersion": "design-lab 0.2.0"
}
```

## `sourceHash` is what makes drift detectable

Hash the source configuration entity at build time. On a later run, a changed hash means the
component moved underneath the Figma representation — which is precisely the question the
planned `design-lab:drift` skill exists to answer, and it cannot be answered without a
recorded baseline. Record it even before that skill exists.

## Failure is a record too

A component that fails an assertion still gets a file, with the failing verdict. Deleting the
record on failure loses the one piece of information worth keeping: that this component was
attempted, and why it did not work. `verdict: "refuse"` from the planner gets a record as
well — the twelve AHRI components above `maxVariants` should be visible as deliberate
refusals rather than as absences.

## Never guess a node identifier

Read identifiers from the record or from a returned value. Reconstructing one from memory
produces a plausible string that points at an unrelated node, and the resulting corruption is
hard to trace. If the record is missing, re-scan the file by name and rebuild the record
before mutating anything.
