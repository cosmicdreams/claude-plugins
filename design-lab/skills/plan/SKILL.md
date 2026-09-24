---
name: plan
description: >
  Convert validated components.json into a durable, reviewable Figma build plan with properties,
  variant arithmetic, flags, and explicit refusals. Run before any Figma mutation. Not for
  extraction (design-lab:inventory).
---

# Plan the build

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py plan --project <artifact-directory>
```

Read `references/variant-policy.md` and `references/defaults.md`. The script applies defaults;
the model reviews only flagged ambiguity and source-specific exceptions. A spacing choice that
changes magnitude is usually a variable; one that changes sides may be structural. A long enum
with no token family is manual review, not an automatic variant axis.

`plan.json` is the renderer contract. It records all component ids, property treatments,
variant axes and counts, defects, flags, and `build`/`refuse` verdicts. Above `maxVariants`, refuse
and state the arithmetic; never truncate the matrix.

Show the proposed scope, flags, refusals, and total variant count before external mutation.
Persist approval through `workflow.py approve`. An explicit request to build the entire library
is approval when the generated plan stays within that request; a material interpretation change
still requires direction.
