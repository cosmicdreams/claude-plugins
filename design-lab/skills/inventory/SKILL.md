---
name: inventory
description: >
  Extract source components, fields, options, slots, relationships, and source defects into a
  validated components.json. Run after detection; not for deciding the Figma representation
  (design-lab:plan).
---

# Inventory components

Use the strategy persisted in the project manifest:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py extract \
  --project <artifact-directory> --kind components
```

Supported authoring sources are Site Studio, Paragraphs, Single Directory Components (SDCs),
Drupal Canvas, and the
combined Drupal `block_content` + Paragraphs vocabulary. The combined strategy qualifies ids
such as `block:accordion` and `paragraph:accordion`; never collapse them because their machine
names match.

`references/model.md` is the semantic model. Source widget names remain provenance and must not
replace its closed field kinds. Entity-reference-revisions fields targeting Paragraphs become
slots, not ordinary reference fields. Enum options must retain their declared order, default,
source, and token family because planning depends on them.

Extraction is also source lint. Preserve dangling storage/bundle references, unmapped field
types, missing enum options, and conditional defects in each component. Do not repair the
source while inventorying it.

The command validates and atomically replaces `components.json`, then records its hash and count
in `project.json`. A validation failure preserves the previous artifact and blocks planning.
