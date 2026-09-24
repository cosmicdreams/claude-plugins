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
  --ddev-root <running-ddev-project-root> [--ddev-project <name>] \
  [--base-url https://project.ddev.site]
```

For `drupal-db`, it reads current/default-language Paragraphs, Layout Builder sections, block configuration, and
paragraph block fields; writes a validated `usage.json`; and atomically enriches
`components.json`. `placements` means directly authored at a page-level host.
`structuralRefs` means the instance renders because a containing component renders. Never add
the two together. A zero-placement component with structural references is Structural Only, not
a retirement candidate.

For `canvas-db`, it reads published Canvas pages on their current revision and Canvas content
templates. Top-level page components and template nodes count as placements; nested page
components count as structural references. Template nodes retain the node bundle and source
configuration file. Aliases for Canvas pages supply example candidates. The active theme's Twig
templates and component files are scanned for literal SDC includes, embeds, and sources; file and
line references keep theme-rendered components out of Retirement Candidates. References in page,
html, or region templates are treated as global presence.

With `--base-url`, the workflow also fetches Canvas aliases and a deterministic sample of node
aliases, up to 60 public paths. It counts `data-component-id="<provider>:<name>"` in rendered
HTML, records page and instance counts and three example paths, and fills empty database example
candidates. Self-signed HTTPS certificates are accepted for local DDEV. A standalone scan is
available through `scripts/find_rendered_components.py <components.json> --ddev-root <root>
--base-url <url> --output <rendered.json>`.

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

## Published-page copy and composition

For a running public site, `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/extract_voice.py --project <artifact-directory> --base-url <url>` writes `voice.json`; add `--max-pages N` to cap sampled aliases. `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/extract_compositions.py --project <artifact-directory> --base-url <url>` writes `compositions.json` with top-level rendered component order per page. Both reuse the deterministic public alias scan and include the homepage. Read [voice report guidance](../../references/voice.md) before turning observed copy patterns into writing guidance.
