---
name: usage
description: >
  Measure where source components are actually placed and attach verified examples, placement
  counts, structural references, and usage tiers to components.json. Run after inventory; not
  for visual capture (design-lab:capture).
---

# Measure component usage

Prefer an existing database-backed placement inventory discovered as prior art. It can traverse
published content and structural references more completely than a public crawl. Record its
commit/date, exclusions, and coverage.

For a detected Drupal database, use the deterministic workflow command:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py usage --project <artifact-directory> \
  --ddev-root <running-ddev-project-root> [--ddev-project <name>]
```

It reads current/default-language Paragraphs, Layout Builder sections, block configuration, and
paragraph block fields; writes a validated `usage.json`; and atomically enriches
`components.json`. `placements` means directly authored at a page-level host.
`structuralRefs` means the instance renders because a containing component renders. Never add
the two together. A zero-placement component with structural references is Structural Only, not
a retirement candidate.

When crawling is the available source:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/find_examples.py <public-base-url> \
  --strategy <sitestudio|paragraphs> --components components.json --merge \
  > components.enriched.json
```

Validate the enriched artifact, then atomically promote it to the canonical `components.json`
and update the project manifest. Do not leave downstream phases reading the pre-usage file.

A verified example was fetched anonymously, returned its recorded status, contains the component
marker, and has `verifiedAt`. Site Studio definition hashes identify styled elements, not
placements; count distinct component-instance ids. Paragraph markers can undercount templates
that omit the wrapper, so an unseen component is a question, not proof of disuse.

Placements are lower bounds unless every eligible source record/page was traversed. Preserve
`pagesScanned` or database population, measurement date, structural references, and unavailable
or gated examples. If no credible usage source exists, explicitly select
`--usage none --degraded-reason <reason> --by <human-decider>` and use the standard Untiered
page. If detection found a source, planning stops until usage is measured or that human-approved
degraded waiver exists.
