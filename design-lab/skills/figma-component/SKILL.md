---
name: figma-component
description: >
  Build or update one named Figma component transaction from validated design-lab artifacts,
  including properties, variants, its adjacent documentation card, assertions, and build
  record. Not for foundations (design-lab:figma-foundation) or whole-library orchestration
  (design-lab:run).
---

# Build one component transaction

Load the official Figma-use and library-generation guidance before `use_figma`.

## Input and preconditions

Accept a component `id` from `components.json`; qualified ids such as `block:accordion` are
distinct from `paragraph:accordion`. With no id, list unbuilt eligible entries and ask which
one unless an end-to-end run already authorized processing the queue.

Require:

- a passing foundation phase and approved `plan.json`;
- a `build` verdict for this id;
- validated `components.json`, `tokens.json`, and `plan.json`;
- validated `capture-evidence.json` with a unique selector, default-state image, and portable
  example path for this id;
- the existing `builds/<id>.json`, when present, so this run updates rather than duplicates.

Read `references/library-standard.md` sections 1, 4, and 5, plus
`references/build-records.md`, `references/defaults.md`, and `references/verification.md`.

## Transaction

1. Resolve the tier/untiered page and any prior node by recorded id. Similar names are
   evidence to inspect, never evidence that two source components are the same.
2. Place the captured desktop, tablet, and mobile default-state images beside the construction area and inspect them before
   creating layers. Build the source-faithful base with auto-layout. Bind a variable where the code uses that
   token; preserve and report a literal where the code hardcodes it. Do not idealize defects.
   The publishable master is the rendered interface, not a diagram of authoring fields.
   Field anatomy belongs on the adjacent documentation card. If rendering evidence is too
   weak to construct the interface, fail the transaction or refuse it at plan time; never
   substitute a generic white frame with `field:`, `caption:`, or `placeholder:` layers and
   call that source-faithful. Match the visible boundary, hierarchy, content density, typography,
   spacing, color, border, image treatment, and responsive behavior shown by the capture.
3. Build dependencies before parents. Expose every author-editable text node as a TEXT property
   and each modeled slot as an INSTANCE_SWAP property using real accepted component instances.
   If source configuration permits a nested component but the current renderer drops it,
   document that mismatch and do not invent it in the visible master. The publishable root is a
   `COMPONENT` or `COMPONENT_SET` and must never have an image fill.
4. Build the approved variant matrix as a `COMPONENT_SET`; position variants and put the
   evidence-backed default first. Responsive layout direction is a variant or an explicit
   unsupported field—it cannot be variable-bound.
5. Write the structured searchable description and set its documentation link.
6. Build the standard documentation card adjacent to the component: Head, When to use,
   source-complete Anatomy, Relationships, the desktop/tablet/mobile Breakpoint evidence trio,
   Configuration, clickable Example, and actionable Notes. Interactive components add state
   rows after the default trio. The visible example label is root-relative and links to the
   canonical URL.
7. Compare Figma screenshots of the native component against the live capture at desktop,
   tablet, and mobile. Fix visible mismatches before continuing. Assert the transaction, then atomically write `builds/<id>.json` with returned node ids,
   source hash, standard version, per-breakpoint evidence and comparison results, documented
   field/relationship coverage, native-node type, root image-fill check, nested-instance
   coverage, and assertion results. Register the valid receipt;
   the workflow derives component-phase completion from full approved-plan coverage:

   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py register \
     --project <artifact-directory> --name "build:<id>" \
     --path "<artifact-directory>/builds/<id>.json" \
     --kind build-record --phase components
   ```

   Until every planned build has a valid non-failing receipt, the phase remains `running`.
   `assertions` is non-empty and every entry must explicitly pass (`true`, `{"pass": true}`,
   or `{"verdict": "pass"}`). `not-run`, `skipped`, an empty object, and missing evidence are
   failures, not neutral states.
8. Refresh `design-lab:figma-index` only after the record is valid.

## Figma traps

- Read `componentPropertyDefinitions` before adding a property; Figma silently suffixes a
  collision. Reuse the existing key and wire it in every variant.
- Read property definitions only from a top-level component or component set, not a variant.
- Load each font before any text mutation.
- Never reconstruct a node id. If a record is missing, scan by exact source-backed identity
  and rebuild the record before mutation.

A failed assertion still produces a failure record. Do not proceed to another component until
this transaction is durably closed.
