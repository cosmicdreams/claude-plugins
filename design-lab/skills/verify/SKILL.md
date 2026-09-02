---
name: verify
description: >
  Check a built Figma library against references/library-standard.md and resolve every gap as
  either a fix or a recorded waiver. Run after design-lab:figma-index, and again whenever the
  library is handed to anyone. Not for building (design-lab:figma-component) or extraction
  (design-lab:inventory).
---

# Verify the library

Every other skill reports on its own step. None of them looks at the whole, so a library can
pass every step and still be half a library. That is not hypothetical — it is what this
plugin produced on PNCB:

| What was wrong | What reported success |
|---|---|
| Four Foundations pages empty | nothing checks pages |
| 36 of 43 components never built | `figma-component`, seven times |
| Every component missing `documentationLinks` | `figma-component` step 8, unasserted |
| 16 semantic variables naming CSS custom properties that exist nowhere | `figma-foundation` |
| A spacing collection with 3 modes, 14 of 16 variables identical across them | `figma-foundation` |
| Two pairs of components sharing one screenshot | the capture harness |

## The rule

**An unmet expectation resolves to a fix or a recorded waiver. Never to silence.**

A waiver is a human decision. Do not waive anything yourself, and do not treat "the user did
not mention it" as consent. Ask, then write down who decided, when, and why. A recorded
waiver is also what stops the same argument happening on every future run.

## 1. Dump the file state

One read-only `use_figma` call. It collects only what the checks need.

```js
const pages = [];
for (const p of figma.root.children) pages.push({id:p.id, name:p.name, children:p.children.length});

const colls = [];
for (const c of await figma.variables.getLocalVariableCollectionsAsync()) {
  const vars = [];
  for (const id of c.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (v) vars.push({name:v.name, scopes:v.scopes,
                      web:(v.codeSyntax && v.codeSyntax.WEB) || null,
                      valuesByMode:v.valuesByMode});
  }
  colls.push({name:c.name, modes:c.modes.map(m=>m.name), variables:vars});
}
return {pages, collections: colls};
```

Then **one call per page, emitted in parallel** (see `figma-use`: never switch pages in a
loop), each returning that page's components, documentation cards and breakpoint frames:

```js
const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);
const comps = page.findAllWithCriteria({types:['COMPONENT_SET','COMPONENT']})
  .filter(n => n.type === 'COMPONENT_SET' || n.parent.type !== 'COMPONENT_SET')
  .map(n => ({name:n.name, page:page.name, description:n.description,
              docLinks:(n.documentationLinks||[]).length}));
const cards = page.findAll(n => / — documentation$/.test(n.name)).map(n => ({name:n.name}));
const frames = page.findAll(n => n.type==='FRAME' && /^(shot|scale):/.test(n.name))
  .map(n => ({name:n.name, width:Math.round(n.width), height:Math.round(n.height),
              hasImage: Array.isArray(n.fills) && n.fills.some(f=>f.type==='IMAGE'),
              // the pixel width written in the caption beside it, for the scale check
              labelWidth: (() => { const t = n.parent && n.parent.findAll(x=>x.type==='TEXT')
                  .map(x=>x.characters).join(' ');
                const m = t && t.match(/(\d+)\s*[×x]\s*\d+\s*px/); return m ? +m[1] : null; })()}));
return {components:comps, cards, breakpointFrames:frames};
```

Merge the results into one `state.json`.

## 2. Run the checks

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/verify.py \
    --state state.json --components components.json --tokens tokens.json \
    --waivers waivers.json --theme-root docroot/themes/custom/<theme> \
    --shots-dir reports/figma-spec/shots
```

Exit status is 1 while anything is open, so this gates a handoff.

**Always pass `--theme-root`.** Without it the highest-value check is skipped:
`code-syntax-resolves` greps every code syntax against the actual codebase. A Dev Mode name
that resolves to nothing is worse than no name at all — a developer copies it, searches, and
finds nothing. It is the check that caught all sixteen PNCB semantic variables.

## 3. Resolve every open finding

For each, exactly one of:

- **Fix it.** Preferred whenever the fix is mechanical — a missing code syntax, an
  unset scope, an absent documentation link.
- **Record the reason on the object.** `code-syntax-set` treats a variable with no code
  syntax as resolved when its description *addresses the absence* — "no custom property
  holds this value", "stale", "not set here". An unrelated note does not count, however
  long: the first version of this check accepted any description and passed ten variables
  whose descriptions were leftovers from an earlier build. Sometimes the
  codebase genuinely has no name for a value, and writing that on the variable puts the
  answer where the next person reads it rather than in a side file.
- **Ask, then waive.** Use `AskUserQuestion`. State the check, what is missing, and what is
  lost by skipping it. If they decline, append to `waivers.json`:

```jsonc
{"waivers": [
  {"check": "pages-populated",
   "scope": "file",
   "reason": "Internal Only Canvas and Structural Only are being deleted, not filled",
   "decidedBy": "Chris Weber",
   "date": "2026-09-01"}
]}
```

`scope` matches the finding's scope, or `*` for every instance of that check. Prefer a
narrow scope: `*` silences the check permanently, including for gaps nobody has seen yet.

## The checks

| Check | Severity | Catches |
|---|---|---|
| `foundation-exists` | blocker | components built before variables, hardcoding every value |
| `code-syntax-resolves` | blocker | Dev Mode names that exist nowhere in the codebase |
| `components-built` | blocker | the plan said build, the file does not have it |
| `variable-scoped` | major | `ALL_SCOPES`, so a font stack shows in the radius picker |
| `code-syntax-set` | major | Dev Mode showing a bare number, with no description saying why |
| `modes-earn-themselves` | major | modes whose values never differ |
| `documentation-links` | major | nothing leads from the Assets panel to the documentation |
| `documentation-cards` | major | a component with no card |
| `pages-populated` | major | an empty page, which reads as a section with nothing in it |
| `shot-frames-have-images` | major | a placeholder named like a capture |
| `breakpoints-share-scale` | major | per-frame scaling, which hides responsive behaviour |
| `captures-unique` | major | two components whose selectors resolve to one element |

## Do not report a pass you did not run

`code-syntax-resolves` degrades to a `minor` "not checked" finding when `--theme-root` is
absent, rather than passing. A check that did not run is not a check that passed, and a
report that conflates the two is how this all went wrong in the first place.
