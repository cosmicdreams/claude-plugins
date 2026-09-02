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

**Do not read `p.children.length` here.** Figma loads pages on demand, so an unloaded page
reports `0` children whether it is empty or holds seventy-six frames — measured on the
America's Credit Unions file, where the Atlas page reads `0` before `setCurrentPageAsync` and
`76` after. Taking the count from this pass makes `pages-populated` fire on almost every page
of every file. The count is captured in the per-page pass below, where the page is current.

```js
const pages = [];
for (const p of figma.root.children) pages.push({id:p.id, name:p.name});

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
// Authoritative: the page is current, so this count is real. Merge it onto pages[].children.
const childCount = page.children.length;
const comps = page.findAllWithCriteria({types:['COMPONENT_SET','COMPONENT']})
  .filter(n => n.type === 'COMPONENT_SET' || n.parent.type !== 'COMPONENT_SET')
  .map(n => ({name:n.name, page:page.name, pageId:page.id, description:n.description,
              docLinks:(n.documentationLinks||[]).length,
              // How many nodes in this component bind at least one variable. `bindings-match-
              // source` compares this against what the source actually declares: a component
              // that binds where the code hardcodes has tidied away the defect the file
              // exists to carry. See references/library-standard.md section 1.
              boundVariableCount: n.findAll(x => x.boundVariables &&
                  Object.keys(x.boundVariables).length > 0).length}));
// `pageId` is what `documentation-adjacent` compares: a card on another page from its
// component is the drift this standard exists to prevent, and only the ids can show it.
const DEFAULT_LAYER = /^(Frame|Group|Rectangle|Ellipse|Text|Vector|Line|Polygon|Star|Component|Slice)( \d+)?$/;
// Figma node proxies THROW on an unknown property rather than returning undefined, so
// `n.findAll ? … : …` is not a safe guard — it raises TypeError on a TEXT node. Test the
// node type instead. This cost one failed run against the live PNCB file.
const CONTAINER = new Set(['FRAME','GROUP','INSTANCE','COMPONENT','COMPONENT_SET','SECTION']);
const cards = page.findAll(n => / — documentation$/.test(n.name)).map(n => {
  const kids = CONTAINER.has(n.type) ? n.findAll(x => true) : [];
  const fields = kids.filter(x => /^Fields$/i.test(x.name) ||
                                  (x.type === 'TEXT' && /^FIELDS\b/.test(x.characters)));
  // A fields *table* has structure under it. A preformatted text blob with glyphs faking a
  // tree is only TEXT, and that is what `fields-are-tables` fails.
  const hasTable = kids.some(x => /^Table$/i.test(x.name)) ||
      fields.some(f => CONTAINER.has(f.type) && f.findAll(x => x.type === 'FRAME').length > 0);
  return {name:n.name, pageId:page.id,
          defaultNamedLayers: kids.filter(x => DEFAULT_LAYER.test(x.name)).length,
          hasFields: fields.length > 0, hasFieldsTable: hasTable};
});
// Return childCount with the rest; a page with no entry is reported as unmeasured, not empty.
const frames = page.findAll(n => n.type==='FRAME' && /^(shot|scale):/.test(n.name))
  .map(n => ({name:n.name, width:Math.round(n.width), height:Math.round(n.height),
              hasImage: Array.isArray(n.fills) && n.fills.some(f=>f.type==='IMAGE'),
              // the pixel width written in the caption beside it, for the scale check
              labelWidth: (() => { const t = n.parent && n.parent.findAll(x=>x.type==='TEXT')
                  .map(x=>x.characters).join(' ');
                const m = t && t.match(/(\d+)\s*[×x]\s*\d+\s*px/); return m ? +m[1] : null; })()}));
return {components:comps, cards, breakpointFrames:frames};
```

And one more for the Getting Started page, which two checks read as text:

```js
const page = await figma.getNodeByIdAsync(GETTING_STARTED_PAGE_ID);
await figma.setCurrentPageAsync(page);
// Take the whole SECTION, not the matching line. Matching on text alone returns the
// heading — "Known gaps — read before trusting a card" — and nothing under it, so
// `known-gaps-current` would compare the report against a title and fail every time.
const section = s => {
  const head = page.findAll(x => x.type === 'TEXT' && new RegExp(s, 'i').test(x.characters))[0];
  if (!head) return null;
  const box = head.parent && head.parent.findAll ? head.parent : page;
  return box.findAll(x => x.type === 'TEXT').map(x => x.characters).join('\n');
};
return {gettingStarted: {knownGapsText: section('known gaps'),
                         thresholdsText: section('high use\\s*—|threshold')}};
```

`knownGapsText` is `null` when the section is absent, which is itself a finding — a file that
tells a reader nothing is unresolved, when things are, is worse than one that says nothing.

Merge the results into one `state.json`.

## 2. Run the checks

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/verify.py \
    --state state.json --components components.json --tokens tokens.json \
    --index index.json --builds builds --brand <Brand> \
    --waivers waivers.json --theme-root docroot/themes/custom/<theme> \
    --shots-dir reports/figma-spec/shots \
    --measurements reports/figma-spec/measurements.json \
    --out verify-report.json
```

Exit status is 1 while anything is open, so this gates a handoff.

**Always pass `--out`.** The report is the receipt, `verify-report-exists` is a blocker
without it, and `design-lab:figma-index` regenerates the Known gaps section from that file.
Passing `--brand` and `--index` likewise: without them `collection-naming` cannot tell a
prefixed collection from an unprefixed one, and `tier-thresholds-stated` cannot tell whether
the thresholds were overridden.

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

Defined by `references/library-standard.md` section 11. The two must never disagree — if you
add a check here, add it there in the same change.

| Check | Severity | Catches |
|---|---|---|
| `foundation-exists` | blocker | components built before variables, hardcoding every value |
| `code-syntax-resolves` | blocker | Dev Mode names that exist nowhere in the codebase |
| `components-built` | blocker | the plan said build, the file does not have it |
| `component-naming` | blocker | not `machine_name — Human Label`, so one audience's search matches nothing |
| `component-description` | blocker | a description carrying no searchable payload |
| `documentation-links` | blocker | nothing leads from the Assets panel to the documentation |
| `documentation-adjacent` | blocker | a card on a different page from its component |
| `layers-named` | blocker | a layer still called `Frame`, invisible to Find |
| `mode-naming` | blocker | `Mode 1` or `Default` — nobody named the mode |
| `no-scratch-pages` | blocker | a working surface or a typographic divider that shipped |
| `standard-version-stamped` | blocker | no `standardVersion` in the artifacts or build records |
| `verify-report-exists` | blocker | a verify run that kept no receipt |
| `bindings-match-source` | blocker | Figma tidying away a hardcoded value the code actually has |
| `variable-scoped` | major | `ALL_SCOPES`, so a font stack shows in the radius picker |
| `code-syntax-set` | major | Dev Mode showing a bare number, with no description saying why |
| `modes-earn-themselves` | major | modes whose values never differ |
| `collection-naming` | major | unprefixed collections, or one domain split across two |
| `documentation-cards` | major | a component with no card |
| `documentation-cards-unique` | major | one card name used twice, so one component is undocumented |
| `fields-are-tables` | major | a field list faked with glyphs instead of a table |
| `two-usage-numbers` | major | placements and structural references collapsed into one |
| `tier-thresholds-stated` | major | thresholds overridden without the reason recorded |
| `known-gaps-current` | major | Known gaps that understates the latest report |
| `pages-populated` | major | an empty page, which reads as a section with nothing in it |
| `shot-frames-have-images` | major | a placeholder named like a capture |
| `breakpoints-share-scale` | major | per-frame scaling, which hides responsive behaviour |
| `captures-unique` | major | two components whose selectors resolve to one element |

## Do not report a pass you did not run

`code-syntax-resolves` degrades to a `minor` "not checked" finding when `--theme-root` is
absent, rather than passing. A check that did not run is not a check that passed, and a
report that conflates the two is how this all went wrong in the first place.
