---
name: plan
description: >
  Turn components.json into a reviewable build proposal — variant axes, properties, the
  variant arithmetic, and a hard refusal for components that would explode. Always run and
  show this before writing anything into Figma. Not for extraction (design-lab:inventory).
---

# Plan the build

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/plan.py components.json --report
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/plan.py components.json --only cpt_text,cpt_cta_banner
```

## This step exists to be argued with

The variant-versus-property split is judgement, and it decides whether a component needs
8 variants or 880. Show the proposal to a human before building. Defaults live in
`references/variant-policy.md` and are meant to be overridden per project.

Pay attention to `flags`. A spacing enum whose options vary by **which sides** are padded
cannot be cleanly expressed as one bound variable, and the policy cannot decide it for you.
On AHRI the same field family was reasonably built both ways: a 3-option padding field
became a variant axis, an 11-option one became a variable.

## The hard stop

Anything above `maxVariants` (default 64) is refused. On AHRI that is 12 of 146 components,
including four layout components whose naive counts run past 10^47. Those are layout
engines, not components — build them as auto-layout with variable modes, never a variant set.

Refusal is a feature. Report what was refused and why; never silently truncate.
