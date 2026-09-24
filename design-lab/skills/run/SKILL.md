---
name: run
description: >
  Build or refresh a complete Figma component library from a real codebase, beginning with
  source discovery and ending with whole-file verification. Use for end-to-end library work.
  Not for a single phase on its own — detection (design-lab:detect), extraction
  (design-lab:inventory), one component (design-lab:figma-component), or the final check
  (design-lab:verify).
---

# Run design-lab end to end

Own the whole outcome. Durable artifacts, not conversation memory, determine what is complete
and where a resumed run continues.

## Establish the project

Resolve the repository and an empty or existing target Figma file. Never mutate a reference
file the user supplied only for comparison. Before the first Figma write, load the official
Figma-use and library-generation guidance and verify that the target is writable.

Initialize one workspace per target library:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py init \
  --repo <absolute-repository-path> --workspace <artifact-directory>
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py detect --project <artifact-directory>
```

Read `detection.json`. Reconcile prior art unless the user explicitly requested an independent
scratch build; in that case keep comparison artifacts hidden until the build is frozen.

The detector recommends an authoring vocabulary over a lower-level rendering vocabulary. Use
the recommendation when repository evidence agrees. Ask one narrow question only when two
choices would materially change the inventory. Persist any override:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py select --project <artifact-directory> \
  --component <strategy> --token <strategy> [--usage <strategy>]
```

## Produce the review boundary

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py extract --project <artifact-directory>
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py usage --project <artifact-directory> \
  --ddev-root <running-ddev-project-root> [--ddev-project <name>]
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py variables --project <artifact-directory>
Run `design-lab:capture` and register `capture-evidence.json`.
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py plan --project <artifact-directory>
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py validate --project <artifact-directory>
```

Usage is a plan prerequisite whenever detection finds a credible source. The deterministic
Drupal extractor records direct placements and nested structural instances separately and
merges them into canonical `components.json`. Do not substitute an ad-hoc query. If the
source genuinely cannot be made available, stop for explicit degraded approval:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py select --project <artifact-directory> \
  --usage none --degraded-reason "<why the detected source cannot be used>" \
  --by "<human decider>"
```

That waiver requires a named human decision and means Untiered output. Never invent
High/Medium/Low labels from configuration references or silently continue because DDEV was
initially stopped. Capture is required for visual assets. A failed or unavailable capture makes
that source entity `Not built — no visual evidence`; it never authorizes a speculative master.

Review `plan.json` flags, refusals, variant arithmetic, `variable-plan.json` warnings, and
`render-evidence.json`. The rendering artifact resolves each Drupal bundle to concrete Twig,
SDC, stylesheet, root-class, and field-reference evidence; inspect those bounded paths for
visual judgment instead of launching broad repository-search agents.
Approval is required before the first external Figma mutation, but an explicit user request to
build the whole library supplies that authority when the plan remains within their scope.
Record who approved:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py approve \
  --project <artifact-directory> --by <name-or-request>
```

## Render as durable transactions

Read `references/library-standard.md` for the output contract.

1. Run `design-lab:figma-foundation` from `tokens.json` and `variable-plan.json`.
2. Run `design-lab:figma-index` once to establish the zero-built coverage baseline.
3. Build every plan entry whose verdict is `build` with `design-lab:figma-component`.
4. Refresh the index after each successful component transaction.
5. Run `design-lab:verify`; fix every open finding or obtain a human waiver.

A component is one transaction, not necessarily one model invocation. Before moving to the
next component, assert it, atomically write `builds/<id>.json`, and register that receipt with
`--kind build-record --phase components`. The phase stays `running` until valid non-failing
receipts cover every `build` verdict in the approved plan. Several straightforward components
may be completed in one session when each transaction closes independently. On resume, trust
validated build records and node identifiers; never infer progress from names or memory.

Register each durable rendering receipt; registration validates its contract before completing
the phase. Use `record` only for running, failed, or waived states:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py register --project <artifact-directory> \
  --name foundation --path <artifact-directory>/foundation.json \
  --kind foundation --phase foundation
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py register --project <artifact-directory> \
  --name index --path <artifact-directory>/index.json --kind index --phase index
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py register --project <artifact-directory> \
  --name verification --path <artifact-directory>/verify-report.json \
  --kind verify-report --phase verify
```

## Completion gate

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py validate --project <artifact-directory>
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py status --project <artifact-directory>
```

Do not call the library complete unless the manifest identifies the target Figma file, every
in-scope visual component has a passing build record backed by capture evidence or an accurate
not-built classification, and the saved whole-file
verification report has no unwaived blocker or major finding. Hand off the Figma link, coverage
counts, verification counts, unavailable evidence, and artifact directory.
