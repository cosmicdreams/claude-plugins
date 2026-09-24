---
name: figma-foundation
description: >
  Create and verify a Figma file's pages and variable foundation from validated tokens.json
  and variable-plan.json. Run once before components; not for component construction
  (design-lab:figma-component).
---

# Build the Figma foundation

Load the official Figma-use and library-generation guidance before calling `use_figma`.
Confirm the target file is writable and is not a read-only comparison artifact.

## Preconditions

- `tokens.json` and `variable-plan.json` validate.
- The project manifest records an approved build plan.
- Read `variable-plan.json.warnings`; unresolved values are findings, not variable names.
- Read `references/tokens-and-variables.md` and `references/library-standard.md` sections 3
  and 6. Those references are the contract; do not reproduce a remembered template.

When the variable plan is missing, generate and register it through the workflow front door:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/workflow.py variables --project <artifact-directory>
```

## Transaction

1. Create or reconcile the standard page list in the specified order. Omit an unsupported
   Foundations domain and record the gap; never publish an empty Foundations page.
2. Create or update the collection strategy in `variable-plan.json`. Prefer one brand-prefixed
   collection with slash-delimited groups when all tokens share one mode set and owner. Split a
   collection only for a recorded mode, publishing, ownership, or lifecycle boundary. Resolve
   existing collections by stored identifiers first, then exact name; never duplicate one.
3. Create only the modes in `variable-plan.json`. Single-mode is `Value`; responsive modes
   include their measured role and width. `typeScaling.observable: false` is unknown, not
   evidence for a single mode.
4. Create primitives from raw values and semantic variables as aliases. Scope every variable
   explicitly. Leading ratios and motion remain unscoped because Figma has no safe property
   scope for them.
5. Set WEB code syntax only when `codeName` exists and the Figma value matches the source
   value. Use `var(--name)` for CSS custom properties. Never synthesize a code identifier.
   Explain an intentional blank in the variable description.
6. Store returned collection, mode, variable, and page identifiers in the project artifacts.

## Assertions

Read the variables back and assert:

- every planned variable exists exactly once;
- collection strategy and mode names conform to the standard;
- no variable retains `ALL_SCOPES`;
- values match every planned mode;
- aliases point to existing primitives;
- every non-null code name has exact WEB syntax;
- no empty Foundations page exists.

Record counts and failures in the manifest. A failing foundation does not permit component
construction.
