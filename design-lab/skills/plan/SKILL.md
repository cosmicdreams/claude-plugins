---
name: plan
description: >
  Convert validated components.json into a durable, reviewable Figma build plan with properties,
  variant arithmetic, flags, and explicit refusals. Run before any Figma mutation. Not for
  extraction (design-lab:inventory).
---

# Plan the build

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.ts plan --project <artifact-directory>
```

Read `references/variant-policy.md` and `references/defaults.md`. The script applies defaults; the model reviews only flagged ambiguity and source-specific exceptions. A spacing choice that changes magnitude is usually a variable; one that changes sides may be structural. A long enum with no token family is manual review, not an automatic variant axis.

`plan.json` is the renderer contract. It records all component ids, property treatments, variant axes and counts, defects, flags, and `build`/`refuse` verdicts. Above `maxVariants`, refuse and state the arithmetic; never truncate the matrix.

Summarise the proposed scope, flags, refusals, and total variant count before external mutation. Persist approval through `workflow.ts approve --from-preflight`, which follows the person's preflight choice: build the plan as proposed, or stop for their review. Flags keep the treatment the plan proposes. Within `design-lab:run`, a plan that would change what the person asked for (a different component source, or a scope they did not request) is a genuine blocker; name the change and wait for direction.

Review the variable collection count too: prefer one shared Core collection with slash groups. Require a concrete independent mode, publishing, or ownership reason for each additional collection. A large token inventory is not a reason.
